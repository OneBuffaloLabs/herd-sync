"use client";

// --- React ---
import { useCallback, useEffect, useRef, useState } from "react";

// --- Vendor ---
import type PouchDB from "pouchdb-browser";

// --- Context ---
import { useHerdSync } from "@/context/HerdSyncContext";

// --- Types ---
import { HerdDoc } from "@/types";

/**
 * Return signature of the useHerdDoc reactive hook.
 */
export interface UseHerdDocReturn<T extends HerdDoc> {
  doc: T | null;
  loading: boolean;
  error: Error | null;
  save: (patch: Record<string, unknown>) => Promise<T>;
  remove: () => Promise<void>;
}

/**
 * Reactive document hook keeping local state synchronized with PouchDB changes.
 */
export function useHerdDoc<T extends HerdDoc>(
  id: string,
  initialDoc?: Partial<T>
): UseHerdDocReturn<T> {
  const { db } = useHerdSync<T>();
  const [doc, setDoc] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef<boolean>(true);

  const fetchDoc = useCallback(async () => {
    if (!db || !id) return;

    try {
      const fetched = await db.get(id);
      if (isMounted.current) {
        setDoc(fetched);
        setError(null);
        setLoading(false);
      }
    } catch (err: unknown) {
      const pouchErr = err as { status?: number };
      if (pouchErr.status === 404) {
        if (initialDoc && isMounted.current) {
          const fallbackDoc = {
            ...initialDoc,
            _id: id,
            updatedAt: new Date().toISOString()
          } as T;
          setDoc(fallbackDoc);
        } else if (isMounted.current) {
          setDoc(null);
        }
        if (isMounted.current) {
          setError(null);
        }
      } else if (isMounted.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }

      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [db, id, initialDoc]);

  useEffect(() => {
    isMounted.current = true;
    void fetchDoc();

    if (!db || !id) return;

    const changes = db
      .changes<T>({
        since: "now",
        live: true,
        include_docs: true,
        doc_ids: [id]
      })
      .on("change", (change: PouchDB.Core.ChangesResponseChange<T>) => {
        if (!isMounted.current) return;
        if (change.deleted) {
          setDoc(null);
        } else if (change.doc) {
          setDoc(change.doc);
        }
      });

    return () => {
      isMounted.current = false;
      changes.cancel();
    };
  }, [db, id, fetchDoc]);

  const save = useCallback(
    async (patch: Record<string, unknown>): Promise<T> => {
      if (!db) {
        throw new Error("Database not initialized");
      }

      let currentRev: string | undefined = doc?._rev;
      try {
        const latest = await db.get(id);
        currentRev = latest._rev;
      } catch (err: unknown) {
        const pouchErr = err as { status?: number };
        if (pouchErr.status !== 404) {
          throw err instanceof Error ? err : new Error(String(err));
        }
      }

      const updatedDoc = {
        ...(doc || {}),
        ...patch,
        _id: id,
        _rev: currentRev,
        updatedAt: new Date().toISOString()
      } as T;

      const response = await db.put(updatedDoc);
      const savedDoc = { ...updatedDoc, _rev: response.rev };
      setDoc(savedDoc);
      return savedDoc;
    },
    [db, id, doc]
  );

  const remove = useCallback(async (): Promise<void> => {
    if (!db) {
      throw new Error("Database not initialized");
    }
    if (!doc?._rev) {
      return;
    }

    await db.remove(id, doc._rev);
    setDoc(null);
  }, [db, id, doc]);

  return { doc, loading, error, save, remove };
}
