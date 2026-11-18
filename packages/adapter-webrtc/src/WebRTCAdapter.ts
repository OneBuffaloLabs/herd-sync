// --- Vendor ---
import type PouchDB from "pouchdb-browser";

// --- HerdSync ---
import type { HerdDoc, HerdSyncStatus, SyncAdapter } from "@onebuffalolabs/herd-sync";

// --- Types ---
import type { SyncPayload } from "@/types";

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

  constructor(localDb: PouchDB.Database<T>) {
    this.localDb = localDb;
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

  public start(): void {
    this.updateStatus({ state: "idle" });
  }

  public async stop(): Promise<void> {
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
    this.updateStatus({ state: "idle" });
  }

  private initConnection(): void {
    this.updateStatus({ state: "connecting", error: null });
    this.peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      if (state === "disconnected" || state === "failed") {
        this.updateStatus({ state: "error", error: "WebRTC connection interrupted" });
      }
    };
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;
    this.dataChannel.onopen = () => {
      this.updateStatus({ state: "connected", error: null });
      void this.beginReplication();
    };
    this.dataChannel.onmessage = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as SyncPayload<T>;
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
          if (change.doc) {
            this.sendPayload({ type: "SYNC_UPDATE", doc: change.doc });
          }
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
      this.updateStatus({ state: "syncing", lastSyncedAt: new Date().toISOString() });
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
          await this.localDb.put(incomingDoc);
        } else {
          const localTimestamp = new Date(localDoc.updatedAt || 0).getTime();
          const incomingTimestamp = new Date(incomingDoc.updatedAt || 0).getTime();

          if (incomingTimestamp > localTimestamp) {
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
