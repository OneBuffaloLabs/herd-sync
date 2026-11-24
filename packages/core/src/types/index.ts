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
  | "uninitialized"
  | "idle"
  | "connecting"
  | "connected"
  | "syncing"
  | "paused"
  | "disconnected"
  | "error"
  | "denied";

/**
 * Reason why a sync session transitioned to a disconnected state.
 */
export type DisconnectReason = "idle" | "manual" | "peer_closed";

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
  disconnectReason?: DisconnectReason | null;
}

/**
 * Contract implemented by HerdSync storage adapters.
 */
export interface SyncAdapter {
  start(): void | Promise<void>;
  stop(): Promise<void>;
  syncNow?(): Promise<void>;
  getStatus(): HerdSyncStatus;
  subscribe(callback: (status: HerdSyncStatus) => void): () => void;
}

/**
 * Context passed to a host-supplied `onConflict` handler when a document has divergent revisions.
 */
export interface ConflictContext<T extends Record<string, unknown> = Record<string, unknown>> {
  docId: string;
  localDoc: T & { _id: string; _rev: string };
  remoteDoc: T & { _id: string; _rev: string };
  conflictingRevs: string[];
}

/**
 * Async host-supplied conflict resolver invoked when a replicated document has `_conflicts`.
 */
export type OnConflictHandler<T extends Record<string, unknown> = Record<string, unknown>> = (
  conflict: ConflictContext<T>
) => Promise<T>;

/**
 * Signature for pluggable conflict resolution functions.
 */
export type ConflictResolver<T extends HerdDoc = HerdDoc> = (
  localDoc: T,
  conflictingDoc: T
) => T | Promise<T>;

/**
 * Result report after resolving a document's conflicting revisions.
 */
export interface ConflictResolutionResult<T extends HerdDoc = HerdDoc> {
  resolvedDoc: T;
  purgedRevisions: string[];
}

/**
 * Options for configuring the conflict resolution runner.
 */
export interface ConflictResolutionOptions<T extends HerdDoc = HerdDoc> {
  resolver?: ConflictResolver<T>;
  timeoutMs?: number;
}
