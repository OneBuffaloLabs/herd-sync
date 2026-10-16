export interface HerdSyncConfig {
  dbName: string;
  remoteUrl?: string;
}

export interface HerdSyncStatus {
  status: "idle" | "syncing" | "connected" | "error";
  lastSyncedAt: string | null;
  error?: string;
}

export function initHerdSync(config: HerdSyncConfig): HerdSyncStatus {
  return {
    status: config.remoteUrl ? "connected" : "idle",
    lastSyncedAt: new Date().toISOString(),
  };
}
