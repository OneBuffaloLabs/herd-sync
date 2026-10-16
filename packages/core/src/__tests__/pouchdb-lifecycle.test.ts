import { afterEach, beforeEach, describe, expect, it } from "vitest";
import PouchDB from "pouchdb-browser";
import type { HerdDoc, PouchDBCtor } from "@/types";

interface TestTask extends HerdDoc {
  title: string;
  completed: boolean;
}

describe("PouchDB Document Lifecycle", () => {
  let db: PouchDB.Database<TestTask>;
  const dbName = "test_lifecycle_db";

  beforeEach(() => {
    const Ctor = PouchDB as unknown as PouchDBCtor<TestTask>;
    db = new Ctor(dbName);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("should create, read, and assign revision to a document", async () => {
    const initialDoc: TestTask = {
      _id: "task_1",
      title: "Write Vitest Suite",
      completed: false,
      updatedAt: new Date().toISOString()
    };

    const putRes = await db.put(initialDoc);
    expect(putRes.ok).toBe(true);
    expect(putRes.rev).toBeDefined();

    const fetched = await db.get("task_1");
    expect(fetched._id).toBe("task_1");
    expect(fetched.title).toBe("Write Vitest Suite");
    expect(fetched._rev).toBe(putRes.rev);
  });

  it("should update a document when providing current revision", async () => {
    const doc: TestTask = {
      _id: "task_2",
      title: "Draft Phase",
      completed: false,
      updatedAt: new Date().toISOString()
    };

    const putRes = await db.put(doc);
    const fetched = await db.get("task_2");

    const updatedDoc: TestTask = {
      ...fetched,
      title: "Completed Phase",
      completed: true,
      updatedAt: new Date().toISOString()
    };

    const updateRes = await db.put(updatedDoc);
    expect(updateRes.ok).toBe(true);
    expect(updateRes.rev).not.toBe(putRes.rev);

    const reFetched = await db.get("task_2");
    expect(reFetched.title).toBe("Completed Phase");
    expect(reFetched.completed).toBe(true);
  });

  it("should delete a document using _id and _rev", async () => {
    const doc: TestTask = {
      _id: "task_delete",
      title: "Disposable Document",
      completed: false
    };

    const putRes = await db.put(doc);
    const deleteRes = await db.remove(putRes.id, putRes.rev);
    expect(deleteRes.ok).toBe(true);

    await expect(db.get("task_delete")).rejects.toMatchObject({
      status: 404,
      name: "not_found"
    });
  });
});
