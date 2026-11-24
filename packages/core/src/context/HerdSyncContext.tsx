"use client";

// --- React ---
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

// --- Vendor ---
import type PouchDB from "pouchdb-browser";

// --- Adapters & Session ---
import { CouchDBAdapter } from "@/adapters/couchdb";
import {
  applyConflictResolution,
  getDocumentConflictContext,
  processDatabaseConflicts
} from "@/conflicts/resolver";
import { IdleSessionController } from "@/session/IdleSessionController";

// --- Types ---
import type {
  ConflictContext,
  CouchDBAdapterOptions,
  HerdDoc,
  HerdSyncStatus,
  OnConflictHandler,
  PouchDBCtor,
  SyncAdapter
} from "@/types";

const IDLE_PEER_STATUS: HerdSyncStatus = {
  state: "idle",
  lastSyncedAt: null,
  pendingPushes: 0,
  error: null,
  disconnectReason: null
};

/**
 * React Context value shape for HerdSync.
 */
export interface HerdSyncContextValue<T extends HerdDoc = HerdDoc> {
  db: PouchDB.Database<T> | null;
  status: HerdSyncStatus;
  adapter: CouchDBAdapter<T> | null;
  peerAdapter: SyncAdapter | null;
  peerStatus: HerdSyncStatus;
  setPeerAdapter: (adapter: SyncAdapter | null) => void;
  conflicts: ConflictContext<T>[];
  conflictCount: number;
  resolveConflict: (docId: string, resolver: OnConflictHandler<T>) => Promise<void>;
  syncNow: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const HerdSyncContext = createContext<HerdSyncContextValue<HerdDoc> | null>(null);

/**
 * Props for the HerdSyncProvider component.
 */
export interface HerdSyncProviderProps<T extends HerdDoc = HerdDoc> extends CouchDBAdapterOptions {
  name: string;
  createPeerAdapter?: (db: PouchDB.Database<T>) => SyncAdapter;
  onConflict?: OnConflictHandler<T>;
  idleTimeoutMs?: number | null;
  children: React.ReactNode;
}

/**
 * Top-level provider establishing the local PouchDB instance, sync adapters,
 * generic conflict handling, and configurable inactivity timeout.
 */
export function HerdSyncProvider<T extends HerdDoc = HerdDoc>({
  name,
  remoteUrl,
  auth,
  live = true,
  retry = true,
  backOffMultiplier,
  initialBackOffMs,
  maxBackOffMs,
  createPeerAdapter,
  onConflict,
  idleTimeoutMs,
  children
}: HerdSyncProviderProps<T>) {
  const [db, setDb] = useState<PouchDB.Database<T> | null>(null);
  const [status, setStatus] = useState<HerdSyncStatus>({
    state: "uninitialized",
    lastSyncedAt: null,
    pendingPushes: 0,
    error: null,
    disconnectReason: null
  });
  const [peerAdapter, setPeerAdapterState] = useState<SyncAdapter | null>(null);
  const [peerStatus, setPeerStatus] = useState<HerdSyncStatus>(IDLE_PEER_STATUS);
  const [conflicts, setConflicts] = useState<ConflictContext<T>[]>([]);

  const adapterRef = useRef<CouchDBAdapter<T> | null>(null);
  const activeDbRef = useRef<PouchDB.Database<T> | null>(null);
  const peerAdapterRef = useRef<SyncAdapter | null>(null);
  const peerUnsubscribeRef = useRef<(() => void) | null>(null);
  const idleControllerRef = useRef<IdleSessionController | null>(null);
  const createPeerAdapterRef = useRef(createPeerAdapter);
  createPeerAdapterRef.current = createPeerAdapter;
  const onConflictRef = useRef(onConflict);
  onConflictRef.current = onConflict;

  const serializedAuth = JSON.stringify(auth);

  const handleDisconnectWithReason = useCallback(async (reason: "idle" | "manual") => {
    idleControllerRef.current?.stop();

    if (adapterRef.current) {
      await adapterRef.current.stop(reason);
    } else {
      setStatus((prev) => ({ ...prev, state: "disconnected", disconnectReason: reason }));
    }

    if (peerAdapterRef.current) {
      await peerAdapterRef.current.stop();
      setPeerStatus((prev) => ({ ...prev, state: "disconnected", disconnectReason: reason }));
    }
  }, []);

  useEffect(() => {
    const controller = new IdleSessionController({
      idleTimeoutMs,
      onIdleTimeout: () => handleDisconnectWithReason("idle")
    });
    idleControllerRef.current = controller;
    controller.start();

    return () => {
      controller.stop();
      if (idleControllerRef.current === controller) {
        idleControllerRef.current = null;
      }
    };
  }, [idleTimeoutMs, handleDisconnectWithReason]);

  const attachPeerAdapter = useCallback((nextAdapter: SyncAdapter | null) => {
    if (peerUnsubscribeRef.current) {
      peerUnsubscribeRef.current();
      peerUnsubscribeRef.current = null;
    }

    peerAdapterRef.current = nextAdapter;
    setPeerAdapterState(nextAdapter);

    if (nextAdapter) {
      peerUnsubscribeRef.current = nextAdapter.subscribe((nextStatus) => {
        setPeerStatus(nextStatus);
        if (nextStatus.state === "connected" || nextStatus.state === "syncing") {
          idleControllerRef.current?.recordActivity();
        }
      });
    } else {
      setPeerStatus(IDLE_PEER_STATUS);
    }
  }, []);

  const refreshConflicts = useCallback(async (targetDb: PouchDB.Database<T>, docIds?: string[]) => {
    const unresolved = await processDatabaseConflicts<T>(targetDb, {
      docIds,
      onConflict: onConflictRef.current
    });

    if (!docIds) {
      setConflicts(unresolved);
      return;
    }

    setConflicts((prev) => {
      const scannedSet = new Set(docIds);
      const remaining = prev.filter((item) => !scannedSet.has(item.docId));
      return [...remaining, ...unresolved];
    });
  }, []);

  useEffect(() => {
    let isDisposed = false;

    async function initializeDatabase() {
      if (typeof window === "undefined") return;

      const PouchDBModule = await import("pouchdb-browser");
      const Ctor = (PouchDBModule.default || PouchDBModule) as unknown as PouchDBCtor<T>;

      if (isDisposed) return;

      const localDb = new Ctor(name);
      activeDbRef.current = localDb;
      setDb(localDb);

      const adapter = new CouchDBAdapter<T>(localDb, {
        remoteUrl,
        auth,
        live,
        retry,
        backOffMultiplier,
        initialBackOffMs,
        maxBackOffMs
      });

      adapterRef.current = adapter;
      const unsubscribe = adapter.subscribe((nextStatus) => {
        setStatus(nextStatus);
        if (nextStatus.state === "connected" || nextStatus.state === "syncing") {
          idleControllerRef.current?.recordActivity();
        }
      });
      void adapter.start();

      if (createPeerAdapterRef.current) {
        const createdPeer = createPeerAdapterRef.current(localDb);
        attachPeerAdapter(createdPeer);
        void createdPeer.start();
      }

      void refreshConflicts(localDb);

      const changesFeed = localDb
        .changes<T>({
          since: "now",
          live: true,
          include_docs: true,
          conflicts: true
        })
        .on("change", (change) => {
          idleControllerRef.current?.recordActivity();
          const docWithConflicts = change.doc as (T & { _conflicts?: string[] }) | undefined;
          if (docWithConflicts?._conflicts && docWithConflicts._conflicts.length > 0) {
            void refreshConflicts(localDb, [change.id]);
          }
        });

      return () => {
        changesFeed.cancel();
        unsubscribe();
        void adapter.stop();
        if (peerUnsubscribeRef.current) {
          peerUnsubscribeRef.current();
          peerUnsubscribeRef.current = null;
        }
        if (peerAdapterRef.current) {
          void peerAdapterRef.current.stop();
          peerAdapterRef.current = null;
        }
        setPeerAdapterState(null);
        setPeerStatus(IDLE_PEER_STATUS);
        setConflicts([]);
        void localDb.close();
        adapterRef.current = null;
        activeDbRef.current = null;
        setDb(null);
      };
    }

    const cleanupPromise = initializeDatabase();

    return () => {
      isDisposed = true;
      void cleanupPromise.then((cleanup) => {
        if (cleanup) cleanup();
      });
    };
  }, [
    name,
    remoteUrl,
    serializedAuth,
    live,
    retry,
    backOffMultiplier,
    initialBackOffMs,
    maxBackOffMs,
    attachPeerAdapter,
    refreshConflicts
  ]);

  const syncNow = useCallback(async () => {
    idleControllerRef.current?.recordActivity();
    if (adapterRef.current?.syncNow) {
      await adapterRef.current.syncNow();
    }
    if (peerAdapterRef.current?.syncNow) {
      await peerAdapterRef.current.syncNow();
    }
    if (activeDbRef.current) {
      await refreshConflicts(activeDbRef.current);
    }
  }, [refreshConflicts]);

  const disconnect = useCallback(async () => {
    await handleDisconnectWithReason("manual");
  }, [handleDisconnectWithReason]);

  const resolveConflict = useCallback(
    async (docId: string, resolver: OnConflictHandler<T>) => {
      const targetDb = activeDbRef.current;
      if (!targetDb) return;

      const context = await getDocumentConflictContext<T>(targetDb, docId);
      if (context) {
        await applyConflictResolution(targetDb, context, resolver);
      }
      setConflicts((prev) => prev.filter((item) => item.docId !== docId));
    },
    []
  );

  const contextValue = useMemo(
    (): HerdSyncContextValue<T> => ({
      db,
      status,
      adapter: adapterRef.current,
      peerAdapter,
      peerStatus,
      setPeerAdapter: attachPeerAdapter,
      conflicts,
      conflictCount: conflicts.length,
      resolveConflict,
      syncNow,
      disconnect
    }),
    [
      db,
      status,
      peerAdapter,
      peerStatus,
      attachPeerAdapter,
      conflicts,
      resolveConflict,
      syncNow,
      disconnect
    ]
  );

  return (
    <HerdSyncContext.Provider value={contextValue as unknown as HerdSyncContextValue<HerdDoc>}>
      {children}
    </HerdSyncContext.Provider>
  );
}

/**
 * Hook to access the current database instance, replication status, conflict state, and session controls.
 */
export function useHerdSync<T extends HerdDoc = HerdDoc>(): HerdSyncContextValue<T> {
  const context = useContext(HerdSyncContext);
  if (!context) {
    throw new Error("useHerdSync must be used within a HerdSyncProvider");
  }
  return context as unknown as HerdSyncContextValue<T>;
}
