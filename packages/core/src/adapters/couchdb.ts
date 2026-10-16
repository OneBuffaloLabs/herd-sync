// --- Vendor ---
import type PouchDB from "pouchdb-browser";

// --- Types ---
import { CouchDBAdapterOptions, HerdDoc, HerdSyncStatus, PouchDBCtor, SyncAdapter } from "@/types";

/**
 * Internal shape to safely extract change replication metadata.
 */
interface ReplicationChangePayload {
  pending?: number;
}

/**
 * PouchDB-to-CouchDB synchronization adapter supporting bi-directional replication and auto-retry backoff.
 */
export class CouchDBAdapter<T extends HerdDoc = HerdDoc> implements SyncAdapter {
  private localDb: PouchDB.Database<T>;
  private remoteDb: PouchDB.Database<T> | null = null;
  private syncHandler: PouchDB.Replication.Sync<T> | null = null;
  private options: CouchDBAdapterOptions;
  private status: HerdSyncStatus = {
    state: "uninitialized",
    lastSyncedAt: null,
    pendingPushes: 0,
    error: null
  };
  private listeners: Set<(status: HerdSyncStatus) => void> = new Set();

  constructor(localDb: PouchDB.Database<T>, options: CouchDBAdapterOptions = {}) {
    this.localDb = localDb;
    this.options = options;
    this.status.state = options.remoteUrl ? "idle" : "uninitialized";
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

  public async start(): Promise<void> {
    if (!this.options.remoteUrl || typeof window === "undefined") {
      this.updateStatus({ state: "idle" });
      return;
    }

    if (this.syncHandler) {
      return;
    }

    this.updateStatus({ state: "connecting", error: null });

    const remoteOptions: PouchDB.Configuration.RemoteDatabaseConfiguration = {
      skip_setup: true
    };

    if (this.options.auth?.username && this.options.auth?.password) {
      remoteOptions.auth = {
        username: this.options.auth.username,
        password: this.options.auth.password
      };
    } else if (this.options.auth?.bearerToken) {
      const token = this.options.auth.bearerToken;
      remoteOptions.fetch = (
        url: string | URL | Request,
        opts?: RequestInit
      ): Promise<Response> => {
        const headers = new Headers(opts?.headers);
        headers.set("Authorization", `Bearer ${token}`);
        return fetch(url, { ...opts, headers });
      };
    }

    try {
      const PouchDBModule = await import("pouchdb-browser");
      const Ctor = (PouchDBModule.default || PouchDBModule) as unknown as PouchDBCtor<T>;
      this.remoteDb = new Ctor(this.options.remoteUrl, remoteOptions);
    } catch (err: unknown) {
      this.updateStatus({
        state: "error",
        error: err instanceof Error ? err.message : String(err)
      });
      return;
    }

    const initialBackOff = this.options.initialBackOffMs ?? 1000;
    const maxBackOff = this.options.maxBackOffMs ?? 30000;
    const multiplier = this.options.backOffMultiplier ?? 2;

    this.syncHandler = this.localDb
      .sync(this.remoteDb, {
        live: this.options.live ?? true,
        retry: this.options.retry ?? true,
        back_off_function: (delay: number) => {
          if (delay === 0) return initialBackOff;
          return Math.min(delay * multiplier, maxBackOff);
        }
      })
      .on("change", (info: PouchDB.Replication.SyncResult<T>) => {
        const payload = info.change as unknown as ReplicationChangePayload;
        this.updateStatus({
          state: "syncing",
          lastSyncedAt: new Date().toISOString(),
          pendingPushes: typeof payload?.pending === "number" ? payload.pending : 0
        });
      })
      .on("paused", (err?: unknown) => {
        if (err) {
          const pauseError = err as Error;
          this.updateStatus({
            state: "paused",
            error: pauseError.message || "Sync paused due to connection interruption"
          });
        } else {
          this.updateStatus({
            state: "connected",
            error: null,
            lastSyncedAt: new Date().toISOString()
          });
        }
      })
      .on("active", () => {
        this.updateStatus({ state: "syncing", error: null });
      })
      .on("denied", (err: unknown) => {
        const deniedError = err as Error;
        this.updateStatus({
          state: "denied",
          error: deniedError.message || "Database access denied"
        });
      })
      .on("error", (err: unknown) => {
        const syncError = err as Error;
        this.updateStatus({
          state: "error",
          error: syncError.message || "Replication error encountered"
        });
      });
  }

  public async stop(): Promise<void> {
    if (this.syncHandler) {
      this.syncHandler.cancel();
      this.syncHandler = null;
    }
    if (this.remoteDb) {
      await this.remoteDb.close();
      this.remoteDb = null;
    }
    this.updateStatus({ state: "idle" });
  }
}
