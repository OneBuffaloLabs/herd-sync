// --- Vendor ---
import type PouchDB from "pouchdb-browser";

// --- Types ---
import type {
  ConflictContext,
  ConflictResolutionOptions,
  ConflictResolutionResult,
  ConflictResolver,
  HerdDoc,
  OnConflictHandler
} from "@/types";

// --- Strategies ---
import { resolveLWW } from "@/conflicts/strategies";

/**
 * Executes a promise with an enforced timeout.
 */
async function withTimeout<T>(promise: Promise<T> | T, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Conflict resolution timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Inspects a document for divergent revision branches, runs the configured resolver,
 * writes the winning revision, and marks losing branches as deleted.
 */
export async function resolveDocConflicts<T extends HerdDoc>(
  db: PouchDB.Database<T>,
  docId: string,
  options?: ConflictResolutionOptions<T>
): Promise<ConflictResolutionResult<T> | null> {
  const resolver: ConflictResolver<T> = options?.resolver ?? resolveLWW;
  const timeoutMs = options?.timeoutMs ?? 5000;

  // 1. Fetch document including conflict metadata
  let winningDoc: (T & { _conflicts?: string[] }) | null = null;
  try {
    winningDoc = (await db.get(docId, { conflicts: true })) as T & { _conflicts?: string[] };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404) return null;
    throw err;
  }

  if (!winningDoc._conflicts || winningDoc._conflicts.length === 0) {
    return null;
  }

  const conflictRevs = [...winningDoc._conflicts];
  let currentWinner: T = winningDoc;
  const purgedRevisions: string[] = [];

  // 2. Resolve sequentially against each conflicting revision
  for (const conflictRev of conflictRevs) {
    let conflictingDoc: T | null = null;
    try {
      conflictingDoc = await db.get(docId, { rev: conflictRev });
    } catch {
      continue;
    }

    try {
      const resolved = await withTimeout(resolver(currentWinner, conflictingDoc), timeoutMs);
      currentWinner = {
        ...resolved,
        _id: docId,
        _rev: currentWinner._rev
      };
      purgedRevisions.push(conflictRev);
    } catch {
      // Fall back to LWW on timeout or handler crash
      currentWinner = resolveLWW(currentWinner, conflictingDoc);
      purgedRevisions.push(conflictRev);
    }
  }

  // 3. Prepare bulk operations: update winner and mark loser revisions deleted
  const deletionDocs = purgedRevisions.map((rev) => ({
    _id: docId,
    _rev: rev,
    _deleted: true
  }));

  const docsToCommit = [
    {
      ...currentWinner,
      _id: docId,
      updatedAt: currentWinner.updatedAt || new Date().toISOString()
    },
    ...deletionDocs
  ];

  await db.bulkDocs(docsToCommit as unknown as T[]);

  const freshDoc = await db.get(docId);

  return {
    resolvedDoc: freshDoc,
    purgedRevisions
  };
}

interface OpenRevEntry<T> {
  ok?: T & { _id: string; _rev: string };
}

/**
 * Inspects a single document for `_conflicts` using `open_revs: "all"` and builds a generic `ConflictContext`.
 * Returns `null` if the document does not exist or has no conflicting revisions.
 */
export async function getDocumentConflictContext<T extends Record<string, unknown>>(
  db: PouchDB.Database<T>,
  docId: string
): Promise<ConflictContext<T> | null> {
  let winningDoc: (T & { _id: string; _rev: string; _conflicts?: string[] }) | null = null;
  try {
    winningDoc = (await db.get(docId, { conflicts: true })) as T & {
      _id: string;
      _rev: string;
      _conflicts?: string[];
    };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404) return null;
    throw err;
  }

  const conflictingRevs = winningDoc._conflicts ?? [];
  if (conflictingRevs.length === 0) {
    return null;
  }

  const openRevsResult = (await db.get(docId, {
    open_revs: "all"
  })) as unknown as OpenRevEntry<T>[];

  const okDocs = openRevsResult
    .map((entry) => entry.ok)
    .filter((doc): doc is T & { _id: string; _rev: string } => Boolean(doc));

  const remoteDoc =
    okDocs.find((doc) => doc._rev !== winningDoc._rev && conflictingRevs.includes(doc._rev)) ??
    ((await db.get(docId, { rev: conflictingRevs[0] })) as T & { _id: string; _rev: string });

  const cleanLocal = { ...winningDoc };
  delete (cleanLocal as { _conflicts?: string[] })._conflicts;

  return {
    docId,
    localDoc: cleanLocal,
    remoteDoc,
    conflictingRevs: [...conflictingRevs]
  };
}

/**
 * Resolves a `ConflictContext` using the provided async `onConflict` handler,
 * writes the resolved document, and prunes all losing `_rev` branches via `bulkDocs`.
 */
export async function applyConflictResolution<T extends Record<string, unknown>>(
  db: PouchDB.Database<T>,
  conflict: ConflictContext<T>,
  onConflict: OnConflictHandler<T>
): Promise<string[]> {
  const resolved = await onConflict(conflict);

  const deletionDocs = conflict.conflictingRevs.map((rev) => ({
    _id: conflict.docId,
    _rev: rev,
    _deleted: true
  }));

  const winnerDoc = {
    ...resolved,
    _id: conflict.docId,
    _rev: conflict.localDoc._rev
  };

  await db.bulkDocs([winnerDoc, ...deletionDocs] as unknown as T[]);
  return [...conflict.conflictingRevs];
}

/**
 * Scans either the given `docIds` or all documents in `db` for `_conflicts`.
 * When `onConflict` is provided, resolves and prunes each conflict; otherwise returns unresolved conflicts.
 */
export async function processDatabaseConflicts<T extends Record<string, unknown>>(
  db: PouchDB.Database<T>,
  options?: {
    docIds?: string[];
    onConflict?: OnConflictHandler<T>;
  }
): Promise<ConflictContext<T>[]> {
  let targetIds: string[];

  if (options?.docIds) {
    targetIds = Array.from(new Set(options.docIds));
  } else {
    const all = await db.allDocs({ include_docs: false, conflicts: true });
    targetIds = all.rows.map((row) => row.id);
  }

  const unresolved: ConflictContext<T>[] = [];

  for (const docId of targetIds) {
    const context = await getDocumentConflictContext<T>(db, docId);
    if (!context) continue;

    if (options?.onConflict) {
      await applyConflictResolution(db, context, options.onConflict);
    } else {
      unresolved.push(context);
    }
  }

  return unresolved;
}
