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

// --- Adapters ---
import { CouchDBAdapter } from "@/adapters/couchdb";

// --- Types ---
import {
  CouchDBAdapterOptions,
  HerdDoc,
  HerdSyncStatus,
  PouchDBCtor,
  SyncAdapter
} from "@/types";

const IDLE_PEER_STATUS: HerdSyncStatus = {
  state: "idle",
  lastSyncedAt: null,
  pendingPushes: 0,
  error: null
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
}

const HerdSyncContext = createContext<HerdSyncContextValue<HerdDoc> | null>(null);

/**
 * Props for the HerdSyncProvider component.
 */
export interface HerdSyncProviderProps<T extends HerdDoc = HerdDoc> extends CouchDBAdapterOptions {
  name: string;
  createPeerAdapter?: (db: PouchDB.Database<T>) => SyncAdapter;
  children: React.ReactNode;
}

/**
 * Top-level provider establishing the local PouchDB instance and remote sync adapter lifecycle.
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
  children
}: HerdSyncProviderProps<T>) {
  const [db, setDb] = useState<PouchDB.Database<T> | null>(null);
  const [status, setStatus] = useState<HerdSyncStatus>({
    state: "uninitialized",
    lastSyncedAt: null,
    pendingPushes: 0,
    error: null
  });
  const [peerAdapter, setPeerAdapterState] = useState<SyncAdapter | null>(null);
  const [peerStatus, setPeerStatus] = useState<HerdSyncStatus>(IDLE_PEER_STATUS);

  const adapterRef = useRef<CouchDBAdapter<T> | null>(null);
  const activeDbRef = useRef<PouchDB.Database<T> | null>(null);
  const peerAdapterRef = useRef<SyncAdapter | null>(null);
  const peerUnsubscribeRef = useRef<(() => void) | null>(null);
  const createPeerAdapterRef = useRef(createPeerAdapter);
  createPeerAdapterRef.current = createPeerAdapter;

  const serializedAuth = JSON.stringify(auth);

  const attachPeerAdapter = useCallback((nextAdapter: SyncAdapter | null) => {
    if (peerUnsubscribeRef.current) {
      peerUnsubscribeRef.current();
      peerUnsubscribeRef.current = null;
    }

    peerAdapterRef.current = nextAdapter;
    setPeerAdapterState(nextAdapter);

    if (nextAdapter) {
      peerUnsubscribeRef.current = nextAdapter.subscribe(setPeerStatus);
    } else {
      setPeerStatus(IDLE_PEER_STATUS);
    }
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
      const unsubscribe = adapter.subscribe(setStatus);
      void adapter.start();

      if (createPeerAdapterRef.current) {
        const createdPeer = createPeerAdapterRef.current(localDb);
        attachPeerAdapter(createdPeer);
        createdPeer.start();
      }

      return () => {
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
    attachPeerAdapter
  ]);

  const contextValue = useMemo(
    (): HerdSyncContextValue<T> => ({
      db,
      status,
      adapter: adapterRef.current,
      peerAdapter,
      peerStatus,
      setPeerAdapter: attachPeerAdapter
    }),
    [db, status, peerAdapter, peerStatus, attachPeerAdapter]
  );

  return (
    <HerdSyncContext.Provider value={contextValue as unknown as HerdSyncContextValue<HerdDoc>}>
      {children}
    </HerdSyncContext.Provider>
  );
}

/**
 * Hook to access the current database instance and replication status.
 */
export function useHerdSync<T extends HerdDoc = HerdDoc>(): HerdSyncContextValue<T> {
  const context = useContext(HerdSyncContext);
  if (!context) {
    throw new Error("useHerdSync must be used within a HerdSyncProvider");
  }
  return context as unknown as HerdSyncContextValue<T>;
}
