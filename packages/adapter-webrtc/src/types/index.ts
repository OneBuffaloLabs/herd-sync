// --- Types ---
import type { HerdDoc } from "@onebuffalolabs/herd-sync";

/**
 * Payload envelope for WebRTC data channel replication messages.
 */
export interface SyncPayload<T extends HerdDoc = HerdDoc> {
  type: "SYNC_BATCH" | "SYNC_UPDATE" | "PEER_HELLO";
  docs?: T[];
  doc?: T;
  peerId?: string;
}

/**
 * Step progression for the interactive QR signaling modal.
 */
export type SyncStep =
  | "SELECT"
  | "HOST_SHOW_QR"
  | "HOST_SCAN_QR"
  | "JOIN_SCAN_QR"
  | "JOIN_SHOW_QR"
  | "CONNECTED";

/**
 * Persisted metadata for a previously paired WebRTC peer.
 */
export interface PairedPeerRecord {
  peerId: string;
  role: "host" | "join";
  pairedAt: string;
  lastConnectedAt: string;
}

/**
 * Configuration options for WebRTCAdapter.
 */
export interface WebRTCAdapterOptions {
  storageKey?: string;
  iceServers?: RTCIceServer[];
}

/**
 * Parsed frame from an animated chunked QR stream.
 */
export interface QRChunk {
  index: number;
  total: number;
  data: string;
}
