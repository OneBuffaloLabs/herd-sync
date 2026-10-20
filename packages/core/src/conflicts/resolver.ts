// --- Vendor ---
import type PouchDB from "pouchdb-browser";

// --- Types ---
import type {
  ConflictResolutionOptions,
  ConflictResolutionResult,
  ConflictResolver,
  HerdDoc
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
