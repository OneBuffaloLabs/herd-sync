import { afterEach, beforeEach, describe, expect, it } from "vitest";
import PouchDB from "pouchdb-browser";
import { resolveDocConflicts } from "@/conflicts/resolver";
import { createArrayMergeResolver, resolveLWW } from "@/conflicts/strategies";
import type { HerdDoc, PouchDBCtor } from "@/types";

interface TestNoteDoc extends HerdDoc {
  title: string;
  tags?: string[];
  content?: string;
}

describe("Conflict Resolution Engine", () => {
  let db: PouchDB.Database<TestNoteDoc>;

  beforeEach(() => {
    const Ctor = PouchDB as unknown as PouchDBCtor<TestNoteDoc>;
    db = new Ctor("test_conflicts_db");
  });

  afterEach(async () => {
    await db.destroy();
  });

  /**
   * Helper to simulate a divergent PouchDB revision branch via bulkDocs with new_edits: false.
   */
  async function createConflictBranch(
    docId: string,
    winner: TestNoteDoc,
    loser: TestNoteDoc
  ): Promise<void> {
    // 1. Establish common root revision
    const rootRes = await db.put({
      _id: docId,
      title: "Root",
      updatedAt: "2026-10-16T10:00:00.000Z"
    });

    // 2. Force divergent branch 1
    const branchA = {
      ...winner,
      _id: docId,
      _rev: `2-branchA${Math.random().toString(36).substring(2, 7)}`,
      _revisions: {
        start: 2,
        ids: [branchAId(rootRes.rev), rootRes.rev.split("-")[1]]
      }
    };

    // 3. Force divergent branch 2
    const branchB = {
      ...loser,
      _id: docId,
      _rev: `2-branchB${Math.random().toString(36).substring(2, 7)}`,
      _revisions: {
        start: 2,
        ids: [branchBId(rootRes.rev), rootRes.rev.split("-")[1]]
      }
    };

    function branchAId(_rev: string) {
      return "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    }
    function branchBId(_rev: string) {
      return "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    }

    await db.bulkDocs([branchA, branchB], { new_edits: false } as PouchDB.Core.BulkDocsOptions);
  }

  it("should return null when a document has no conflicts", async () => {
    await db.put({
      _id: "clean_doc",
      title: "Single Revision"
    });

    const result = await resolveDocConflicts(db, "clean_doc");
    expect(result).toBeNull();
  });

  it("should resolve conflicts using default LWW based on updatedAt", async () => {
    const docId = "note_conflict_lww";
    const olderBranch: TestNoteDoc = {
      _id: docId,
      title: "Older Note State",
      updatedAt: "2026-10-16T12:00:00.000Z"
    };
    const newerBranch: TestNoteDoc = {
      _id: docId,
      title: "Newer Note State",
      updatedAt: "2026-10-16T14:30:00.000Z"
    };

    await createConflictBranch(docId, newerBranch, olderBranch);

    const docBefore = await db.get(docId, { conflicts: true });
    expect(docBefore._conflicts).toBeDefined();
    expect(docBefore._conflicts?.length).toBeGreaterThan(0);

    const result = await resolveDocConflicts(db, docId, { resolver: resolveLWW });

    expect(result).not.toBeNull();
    expect(result?.resolvedDoc.title).toBe("Newer Note State");
    expect(result?.purgedRevisions.length).toBeGreaterThan(0);

    const docAfter = await db.get(docId, { conflicts: true });
    expect(docAfter._conflicts).toBeUndefined();
  });

  it("should support custom domain-specific resolvers merging properties", async () => {
    const docId = "custom_merge_doc";
    const localBranch: TestNoteDoc = {
      _id: docId,
      title: "Document Title",
      content: "Important paragraph from local.",
      updatedAt: "2026-10-16T12:00:00.000Z"
    };
    const remoteBranch: TestNoteDoc = {
      _id: docId,
      title: "Document Title",
      tags: ["urgent", "review"],
      updatedAt: "2026-10-16T12:05:00.000Z"
    };

    await createConflictBranch(docId, localBranch, remoteBranch);

    const customMergeResolver = (local: TestNoteDoc, remote: TestNoteDoc): TestNoteDoc => ({
      ...local,
      ...remote,
      content: local.content || remote.content,
      tags: Array.from(new Set([...(local.tags || []), ...(remote.tags || [])]))
    });

    const result = await resolveDocConflicts(db, docId, { resolver: customMergeResolver });

    expect(result).not.toBeNull();
    expect(result?.resolvedDoc.content).toBe("Important paragraph from local.");
    expect(result?.resolvedDoc.tags).toEqual(["urgent", "review"]);

    const docAfter = await db.get(docId, { conflicts: true });
    expect(docAfter._conflicts).toBeUndefined();
  });

  it("should merge arrays without duplicates using createArrayMergeResolver", async () => {
    const docId = "array_merge_doc";
    const branchA: TestNoteDoc = {
      _id: docId,
      title: "Team Project",
      tags: ["alpha", "beta"],
      updatedAt: "2026-10-16T10:00:00.000Z"
    };
    const branchB: TestNoteDoc = {
      _id: docId,
      title: "Team Project",
      tags: ["beta", "gamma"],
      updatedAt: "2026-10-16T10:05:00.000Z"
    };

    await createConflictBranch(docId, branchA, branchB);

    const resolver = createArrayMergeResolver<TestNoteDoc>(["tags"]);
    const result = await resolveDocConflicts(db, docId, { resolver });

    expect(result).not.toBeNull();
    expect(result?.resolvedDoc.tags?.slice().sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("should fall back gracefully to LWW if a custom resolver times out", async () => {
    const docId = "timeout_doc";
    const localBranch: TestNoteDoc = {
      _id: docId,
      title: "Local Safe State",
      updatedAt: "2026-10-16T15:00:00.000Z"
    };
    const remoteBranch: TestNoteDoc = {
      _id: docId,
      title: "Remote Old State",
      updatedAt: "2026-10-16T12:00:00.000Z"
    };

    await createConflictBranch(docId, localBranch, remoteBranch);

    const hangingResolver = async (): Promise<TestNoteDoc> => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { _id: docId, title: "Should Never Win" };
    };

    const result = await resolveDocConflicts(db, docId, {
      resolver: hangingResolver,
      timeoutMs: 50
    });

    expect(result).not.toBeNull();
    expect(result?.resolvedDoc.title).toBe("Local Safe State");
  });
});
