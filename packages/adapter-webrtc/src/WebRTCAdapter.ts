// --- Vendor ---
import type PouchDB from "pouchdb-browser";

// --- HerdSync ---
import type { HerdDoc, HerdSyncStatus, SyncAdapter } from "@onebuffalolabs/herd-sync";

// --- Types ---
import type { SyncPayload } from "@/types";

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
        this.onOfferCreated?.(this.peerConnection.localDescription.sdp);
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
        this.onAnswerCreated?.(this.peerConnection.localDescription.sdp);
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
