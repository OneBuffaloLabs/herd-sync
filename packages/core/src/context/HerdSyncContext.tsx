"use client";

// --- React ---
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

// --- Vendor ---
import type PouchDB from "pouchdb-browser";

// --- Adapters ---
import { CouchDBAdapter } from "@/adapters/couchdb";

// --- Types ---
import { CouchDBAdapterOptions, HerdDoc, HerdSyncStatus, PouchDBCtor } from "@/types";

/**
 * React Context value shape for HerdSync.
 */
export interface HerdSyncContextValue<T extends HerdDoc = HerdDoc> {
  db: PouchDB.Database<T> | null;
  status: HerdSyncStatus;
  adapter: CouchDBAdapter<T> | null;
}

const HerdSyncContext = createContext<HerdSyncContextValue<HerdDoc> | null>(null);

/**
 * Props for the HerdSyncProvider component.
 */
export interface HerdSyncProviderProps extends CouchDBAdapterOptions {
  name: string;
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
  children
}: HerdSyncProviderProps) {
  const [db, setDb] = useState<PouchDB.Database<T> | null>(null);
  const [status, setStatus] = useState<HerdSyncStatus>({
    state: "uninitialized",
    lastSyncedAt: null,
    pendingPushes: 0,
    error: null
  });

  const adapterRef = useRef<CouchDBAdapter<T> | null>(null);
  const activeDbRef = useRef<PouchDB.Database<T> | null>(null);
  const serializedAuth = JSON.stringify(auth);

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

      return () => {
        unsubscribe();
        void adapter.stop();
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
    maxBackOffMs
  ]);

  const contextValue = useMemo(
    (): HerdSyncContextValue<T> => ({
      db,
      status,
      adapter: adapterRef.current
    }),
    [db, status]
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
