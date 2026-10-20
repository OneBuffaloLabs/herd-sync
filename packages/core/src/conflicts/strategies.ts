// --- Types ---
import type { ConflictResolver, HerdDoc } from "@/types";

/**
 * Extracts a numeric epoch timestamp from standard document timestamp fields.
 */
function getDocumentTimestamp(doc: HerdDoc): number {
  const candidate =
    doc.updatedAt ?? (typeof doc.createdAt === "string" ? doc.createdAt : undefined);
  if (typeof candidate !== "string") {
    return 0;
  }

  const parsed = new Date(candidate).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Last-Write-Wins (LWW) conflict strategy.
 * Compares updatedAt timestamps and selects the newest revision.
 * If timestamps match, deterministically compares _rev strings.
 */
export function resolveLWW<T extends HerdDoc>(localDoc: T, conflictingDoc: T): T {
  const localTime = getDocumentTimestamp(localDoc);
  const conflictingTime = getDocumentTimestamp(conflictingDoc);

  if (conflictingTime > localTime) {
    return {
      ...conflictingDoc,
      _rev: localDoc._rev,
      updatedAt: conflictingDoc.updatedAt || new Date().toISOString()
    };
  }

  if (localTime > conflictingTime) {
    return {
      ...localDoc,
      updatedAt: localDoc.updatedAt || new Date().toISOString()
    };
  }

  // Fallback to deterministic revision string comparison if timestamps match
  const winningDoc =
    (conflictingDoc._rev || "") > (localDoc._rev || "") ? conflictingDoc : localDoc;
  return {
    ...winningDoc,
    _rev: localDoc._rev,
    updatedAt: winningDoc.updatedAt || new Date().toISOString()
  };
}

/**
 * Array merge conflict strategy factory.
 * Concatenates and deduplicates array fields specified by arrayKeys while delegating other fields to LWW.
 */
export function createArrayMergeResolver<T extends HerdDoc>(
  arrayKeys: (keyof T)[]
): ConflictResolver<T> {
  return (localDoc, conflictingDoc) => {
    const baseMerged = resolveLWW(localDoc, conflictingDoc);
    const patch: Partial<T> = {};

    for (const key of arrayKeys) {
      const localArr = Array.isArray(localDoc[key]) ? (localDoc[key] as unknown[]) : [];
      const confArr = Array.isArray(conflictingDoc[key]) ? (conflictingDoc[key] as unknown[]) : [];

      const combined = Array.from(new Set([...localArr, ...confArr]));
      patch[key] = combined as unknown as T[keyof T];
    }

    return {
      ...baseMerged,
      ...patch,
      _rev: localDoc._rev,
      updatedAt: new Date().toISOString()
    };
  };
}
