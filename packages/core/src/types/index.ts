// --- Vendor ---
import type PouchDB from "pouchdb-browser";

// --- Types ---

/**
 * Shape of the dynamic PouchDB constructor function.
 */
export type PouchDBCtor<T extends HerdDoc> = new (
  name?: string,
  options?: PouchDB.Configuration.DatabaseConfiguration
) => PouchDB.Database<T>;

/**
 * Lifecycle connection state for the sync adapter.
 */
export type SyncConnectionState =
  "uninitialized" | "idle" | "connecting" | "connected" | "syncing" | "paused" | "error" | "denied";

/**
 * Base document shape managed by HerdSync.
 */
export interface HerdDoc {
  _id: string;
  _rev?: string;
  _deleted?: boolean;
  updatedAt?: string;
  [key: string]: unknown;
}

/**
 * Authentication parameters for connecting to a remote CouchDB or Cloudant instance.
 */
export interface RemoteAuthConfig {
  username?: string;
  password?: string;
  bearerToken?: string;
}

/**
 * Configuration options for initializing the CouchDB synchronization adapter.
 */
export interface CouchDBAdapterOptions {
  remoteUrl?: string;
  auth?: RemoteAuthConfig;
  live?: boolean;
  retry?: boolean;
  backOffMultiplier?: number;
  initialBackOffMs?: number;
  maxBackOffMs?: number;
}

/**
 * Live status payload emitted during synchronization events.
 */
export interface HerdSyncStatus {
  state: SyncConnectionState;
  lastSyncedAt: string | null;
  pendingPushes: number;
  error: string | null;
}

/**
 * Contract implemented by HerdSync storage adapters.
 */
export interface SyncAdapter {
  start(): void;
  stop(): Promise<void>;
  getStatus(): HerdSyncStatus;
  subscribe(callback: (status: HerdSyncStatus) => void): () => void;
}
