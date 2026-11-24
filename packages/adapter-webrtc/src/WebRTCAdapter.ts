// --- Vendor ---
import type PouchDB from "pouchdb-browser";

// --- HerdSync ---
import type { HerdDoc, HerdSyncStatus, SyncAdapter } from "@onebuffalolabs/herd-sync";

// --- Types ---
import type {
  PairedPeerRecord,
  SyncPayload,
  WebRTCAdapterOptions
} from "@/types";

const UNUSED_SDP_PREFIXES = [
  "a=rtpmap:",
  "a=fmtp:",
  "a=rtcp-fb:",
  "a=rtcp-mux",
  "a=rtcp-rsize",
  "a=extmap:",
  "a=extmap-allow-mixed",
  "a=ssrc:",
  "a=ssrc-group:",
  "a=msid:",
  "a=msid-semantic:",
  "a=end-of-candidates"
];

/**
 * Filters an SDP string to remove non-data-channel media sections, unused codec/trickle-ICE
 * attributes, and redundant ICE candidates so the resulting QR payload stays compact.
 */
export function pruneSDP(sdp: string): string {
  if (!sdp) return sdp;

  const hasTrailingNewline = sdp.endsWith("\n");
  const rawLines = sdp.split(/\r?\n/);
  if (hasTrailingNewline && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  const sessionLines: string[] = [];
  const mediaSections: { type: string; mid: string | null; lines: string[] }[] = [];
  let currentSection: { type: string; mid: string | null; lines: string[] } | null = null;

  for (const line of rawLines) {
    if (line.startsWith("m=")) {
      const mediaType = line.slice(2).split(/\s+/)[0] ?? "";
      currentSection = { type: mediaType, mid: null, lines: [line] };
      mediaSections.push(currentSection);
    } else if (currentSection) {
      if (line.startsWith("a=mid:")) {
        currentSection.mid = line.slice("a=mid:".length).trim();
      }
      currentSection.lines.push(line);
    } else {
      sessionLines.push(line);
    }
  }

  const keptSections = mediaSections.filter(
    (section) => section.type !== "audio" && section.type !== "video"
  );
  const keptMids = new Set(keptSections.map((s) => s.mid).filter((m): m is string => Boolean(m)));

  const candidateState = { hasSrflx: false };

  const filterLine = (line: string): string | null => {
    if (!line) return null;

    if (line.startsWith("a=group:BUNDLE ") && keptMids.size > 0) {
      const mids = line
        .slice("a=group:BUNDLE ".length)
        .trim()
        .split(/\s+/)
        .filter((mid) => keptMids.has(mid));
      return mids.length > 0 ? `a=group:BUNDLE ${mids.join(" ")}` : null;
    }

    if (line.startsWith("a=ice-options:")) {
      const options = line
        .slice("a=ice-options:".length)
        .trim()
        .split(/\s+/)
        .filter((opt) => opt !== "trickle");
      return options.length > 0 ? `a=ice-options:${options.join(" ")}` : null;
    }

    if (UNUSED_SDP_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      return null;
    }

    if (line.startsWith("a=candidate:")) {
      const parts = line.split(/\s+/);
      const protocol = parts[2]?.toLowerCase();
      if (protocol !== "udp") {
        return null;
      }

      const typIndex = parts.indexOf("typ");
      const candidateType = typIndex !== -1 ? parts[typIndex + 1] : undefined;

      if (candidateType === "host") {
        return line;
      }
      if (candidateType === "srflx") {
        if (candidateState.hasSrflx) {
          return null;
        }
        candidateState.hasSrflx = true;
        return line;
      }
      return null;
    }

    return line;
  };

  const resultLines: string[] = [];
  for (const line of sessionLines) {
    const filtered = filterLine(line);
    if (filtered !== null) {
      resultLines.push(filtered);
    }
  }
  for (const section of keptSections) {
    for (const line of section.lines) {
      const filtered = filterLine(line);
      if (filtered !== null) {
        resultLines.push(filtered);
      }
    }
  }

  const joined = resultLines.join("\r\n");
  return hasTrailingNewline && joined.length > 0 ? `${joined}\r\n` : joined;
}

/**
 * Zero-backend WebRTC peer synchronization adapter streaming PouchDB updates across RTCDataChannels.
 */
export class WebRTCAdapter<T extends HerdDoc = HerdDoc> implements SyncAdapter {
  public peerConnection: RTCPeerConnection | null = null;
  public dataChannel: RTCDataChannel | null = null;

  private localDb: PouchDB.Database<T>;
  private storageKey: string;
  private iceServers: RTCIceServer[];
  private currentRole: "host" | "join" | null = null;
  private activePeerId: string | null = null;
  private reconnectChannel: BroadcastChannel | null = null;
  private recentlyReceivedIds: Set<string> = new Set();
  private status: HerdSyncStatus = {
    state: "idle",
    lastSyncedAt: null,
    pendingPushes: 0,
    error: null
  };
  private listeners: Set<(status: HerdSyncStatus) => void> = new Set();
  private changesHandler: PouchDB.Core.Changes<T> | null = null;

  public onOfferCreated?: (sdp: string) => void;
  public onAnswerCreated?: (sdp: string) => void;

  constructor(localDb: PouchDB.Database<T>, options?: WebRTCAdapterOptions) {
    this.localDb = localDb;
    this.storageKey = options?.storageKey ?? `herd-sync:webrtc-peer:${localDb.name || "default"}`;
    this.iceServers = options?.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }];
  }

  public getStatus(): HerdSyncStatus {
    return { ...this.status };
  }

  public subscribe(callback: (status: HerdSyncStatus) => void): () => void {
    this.listeners.add(callback);
    callback(this.getStatus());
    return () => {
      this.listeners.delete(callback);
    };
  }

  private updateStatus(patch: Partial<HerdSyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) {
      listener(this.status);
    }
  }

  /**
   * Returns persisted metadata for the last paired peer, if available.
   */
  public getSavedPeer(): PairedPeerRecord | null {
    if (typeof window === "undefined" || !window.localStorage) return null;
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PairedPeerRecord>;
      if (!parsed.peerId || (parsed.role !== "host" && parsed.role !== "join")) {
        return null;
      }
      return {
        peerId: parsed.peerId,
        role: parsed.role,
        pairedAt: parsed.pairedAt ?? new Date().toISOString(),
        lastConnectedAt: parsed.lastConnectedAt ?? new Date().toISOString()
      };
    } catch {
      return null;
    }
  }

  /**
   * Clears the persisted peer pairing record from localStorage.
   */
  public clearSavedPeer(): void {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      window.localStorage.removeItem(this.storageKey);
    } catch {
      // Ignore storage errors in restricted environments
    }
  }

  private savePeerRecord(role: "host" | "join", peerId: string): void {
    if (typeof window === "undefined" || !window.localStorage) return;
    const existing = this.getSavedPeer();
    const now = new Date().toISOString();
    const record: PairedPeerRecord = {
      peerId,
      role,
      pairedAt: existing?.peerId === peerId ? existing.pairedAt : now,
      lastConnectedAt: now
    };
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(record));
    } catch {
      // Ignore storage quota errors
    }
  }

  private generatePeerId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `peer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  public start(): void {
    const saved = this.getSavedPeer();
    if (saved) {
      this.setupReconnectChannel(saved.peerId);
    }
    if (this.dataChannel?.readyState === "open") {
      this.updateStatus({ state: "connected" });
      return;
    }
    this.updateStatus({ state: "idle" });
  }

  private closePeerResources(): void {
    if (this.changesHandler) {
      this.changesHandler.cancel();
      this.changesHandler = null;
    }
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }

  public async stop(): Promise<void> {
    this.closePeerResources();
    if (this.reconnectChannel) {
      this.reconnectChannel.close();
      this.reconnectChannel = null;
    }
    this.updateStatus({ state: "idle" });
  }

  private setupReconnectChannel(peerId: string): void {
    if (typeof BroadcastChannel === "undefined") return;
    if (this.reconnectChannel && this.activePeerId === peerId) return;

    if (this.reconnectChannel) {
      this.reconnectChannel.close();
    }

    const channel = new BroadcastChannel(`herd-sync-reconnect:${peerId}`);
    channel.onmessage = (event: MessageEvent<{ type: string; sdp?: string }>) => {
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "RECONNECT_OFFER" && msg.sdp) {
        void this.acceptReconnectOffer(msg.sdp, channel);
      } else if (msg.type === "RECONNECT_ANSWER" && msg.sdp) {
        void this.complete(msg.sdp);
      }
    };
    this.reconnectChannel = channel;
  }

  private async acceptReconnectOffer(offerSdp: string, channel: BroadcastChannel): Promise<void> {
    this.onAnswerCreated = (answerSdp) => {
      channel.postMessage({ type: "RECONNECT_ANSWER", sdp: answerSdp });
    };
    await this.join(offerSdp);
  }

  /**
   * Attempts to re-establish a previously paired WebRTC connection without a full QR rescan.
   * Uses ICE restart on active connections or BroadcastChannel renegotiation for saved peers.
   */
  public async reconnect(): Promise<boolean> {
    if (this.dataChannel?.readyState === "open") {
      this.updateStatus({ state: "connected", error: null });
      return true;
    }

    if (this.peerConnection && this.peerConnection.signalingState !== "closed") {
      try {
        this.updateStatus({ state: "connecting", error: null });
        const offer = await this.peerConnection.createOffer({ iceRestart: true });
        await this.peerConnection.setLocalDescription(offer);
        const sdp = this.peerConnection.localDescription?.sdp;
        if (sdp && this.reconnectChannel) {
          this.reconnectChannel.postMessage({ type: "RECONNECT_OFFER", sdp: pruneSDP(sdp) });
        }
        return true;
      } catch {
        // Fall through to full re-offer via saved peer
      }
    }

    const saved = this.getSavedPeer();
    if (!saved) return false;

    this.activePeerId = saved.peerId;
    this.setupReconnectChannel(saved.peerId);

    const prevOnOffer = this.onOfferCreated;
    this.onOfferCreated = (sdp: string) => {
      this.reconnectChannel?.postMessage({ type: "RECONNECT_OFFER", sdp });
      prevOnOffer?.(sdp);
    };
    await this.host();
    return true;
  }

  private initConnection(): void {
    this.closePeerResources();
    this.updateStatus({ state: "connecting", error: null });
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      if (state === "disconnected" || state === "failed") {
        this.updateStatus({ state: "error", error: "WebRTC connection interrupted" });
      } else if (state === "connected" || state === "completed") {
        if (this.dataChannel?.readyState === "open") {
          this.updateStatus({ state: "connected", error: null });
        }
      }
    };
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;
    this.dataChannel.onopen = () => {
      const peerId = this.activePeerId ?? this.getSavedPeer()?.peerId ?? this.generatePeerId();
      this.activePeerId = peerId;
      const role = this.currentRole ?? "host";
      this.savePeerRecord(role, peerId);
      this.setupReconnectChannel(peerId);
      this.sendPayload({ type: "PEER_HELLO", peerId });
      this.updateStatus({ state: "connected", error: null });
      void this.beginReplication();
    };
    this.dataChannel.onmessage = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as SyncPayload<T>;
        if (payload.type === "PEER_HELLO" && payload.peerId) {
          this.activePeerId = payload.peerId;
          this.savePeerRecord(this.currentRole ?? "join", payload.peerId);
          this.setupReconnectChannel(payload.peerId);
          return;
        }
        void this.handleIncomingPayload(payload);
      } catch (err: unknown) {
        this.updateStatus({
          state: "error",
          error: err instanceof Error ? err.message : "Failed to parse data channel message"
        });
      }
    };
    this.dataChannel.onclose = () => {
      this.updateStatus({ state: "idle" });
    };
  }

  public async host(): Promise<void> {
    this.currentRole = "host";
    this.initConnection();
    if (!this.peerConnection) return;

    const channel = this.peerConnection.createDataChannel("herd-sync-stream");
    this.setupDataChannel(channel);

    this.peerConnection.onicecandidate = (event) => {
      if (!event.candidate && this.peerConnection?.localDescription) {
        this.onOfferCreated?.(pruneSDP(this.peerConnection.localDescription.sdp));
      }
    };

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
  }

  public async join(offerSdp: string): Promise<void> {
    this.currentRole = "join";
    this.initConnection();
    if (!this.peerConnection) return;

    this.peerConnection.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };

    this.peerConnection.onicecandidate = (event) => {
      if (!event.candidate && this.peerConnection?.localDescription) {
        this.onAnswerCreated?.(pruneSDP(this.peerConnection.localDescription.sdp));
      }
    };

    await this.peerConnection.setRemoteDescription({ type: "offer", sdp: offerSdp });
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
  }

  public async complete(answerSdp: string): Promise<void> {
    if (!this.peerConnection) return;
    await this.peerConnection.setRemoteDescription({ type: "answer", sdp: answerSdp });
  }

  private async beginReplication(): Promise<void> {
    try {
      if (this.changesHandler) {
        this.changesHandler.cancel();
        this.changesHandler = null;
      }

      const res = await this.localDb.allDocs({ include_docs: true });
      const docs = res.rows.map((r) => r.doc).filter(Boolean) as T[];

      this.sendPayload({ type: "SYNC_BATCH", docs });

      this.changesHandler = this.localDb
        .changes<T>({
          since: "now",
          live: true,
          include_docs: true
        })
        .on("change", (change) => {
          if (!change.doc) return;
          if (this.recentlyReceivedIds.has(change.doc._id)) {
            this.recentlyReceivedIds.delete(change.doc._id);
            return;
          }
          this.sendPayload({ type: "SYNC_UPDATE", doc: change.doc });
        });
    } catch (err: unknown) {
      this.updateStatus({
        state: "error",
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  private sendPayload(payload: SyncPayload<T>): void {
    if (this.dataChannel?.readyState === "open") {
      this.dataChannel.send(JSON.stringify(payload));
      if (payload.type !== "PEER_HELLO") {
        this.updateStatus({ state: "syncing", lastSyncedAt: new Date().toISOString() });
      }
    }
  }

  private async handleIncomingPayload(payload: SyncPayload<T>): Promise<void> {
    this.updateStatus({ state: "syncing" });
    const docs =
      payload.type === "SYNC_BATCH" ? payload.docs || [] : ([payload.doc].filter(Boolean) as T[]);

    for (const incomingDoc of docs) {
      try {
        let localDoc: T | null = null;
        try {
          localDoc = await this.localDb.get(incomingDoc._id);
        } catch (err: unknown) {
          const pouchErr = err as { status?: number };
          if (pouchErr.status !== 404) throw err;
        }

        if (!localDoc) {
          this.recentlyReceivedIds.add(incomingDoc._id);
          await this.localDb.put(incomingDoc);
        } else {
          const localTimestamp = new Date(localDoc.updatedAt || 0).getTime();
          const incomingTimestamp = new Date(incomingDoc.updatedAt || 0).getTime();

          if (incomingTimestamp > localTimestamp) {
            this.recentlyReceivedIds.add(incomingDoc._id);
            incomingDoc._rev = localDoc._rev;
            await this.localDb.put(incomingDoc);
          }
        }
      } catch (err: unknown) {
        this.updateStatus({
          state: "error",
          error: err instanceof Error ? err.message : "Replication conflict error"
        });
      }
    }

    this.updateStatus({ state: "connected", lastSyncedAt: new Date().toISOString() });
  }
}
