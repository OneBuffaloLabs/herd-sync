// --- Types ---
import type { HerdDoc } from "@onebuffalo/herd-sync";

/**
 * Payload envelope for WebRTC data channel replication messages.
 */
export interface SyncPayload<T extends HerdDoc = HerdDoc> {
  type: "SYNC_BATCH" | "SYNC_UPDATE";
  docs?: T[];
  doc?: T;
}

/**
 * Step progression for the interactive QR signaling modal.
 */
export type SyncStep =
  "SELECT" | "HOST_SHOW_QR" | "HOST_SCAN_QR" | "JOIN_SCAN_QR" | "JOIN_SHOW_QR" | "CONNECTED";
