import { afterEach, beforeEach, describe, expect, it } from "vitest";
import PouchDB from "pouchdb-browser";
import type { HerdDoc, PouchDBCtor } from "@onebuffalolabs/herd-sync";
import { WebRTCAdapter } from "@/WebRTCAdapter";

interface ItemDoc extends HerdDoc {
  name: string;
}

describe("WebRTCAdapter Conflict Resolution & Ingestion", () => {
  let db: PouchDB.Database<ItemDoc>;
  let adapter: WebRTCAdapter<ItemDoc>;

  beforeEach(() => {
    const Ctor = PouchDB as unknown as PouchDBCtor<ItemDoc>;
    db = new Ctor("test_webrtc_db");
    adapter = new WebRTCAdapter<ItemDoc>(db);
  });

  afterEach(async () => {
    await adapter.stop();
    await db.destroy();
  });

  it("should initialize in idle state", () => {
    expect(adapter.getStatus().state).toBe("idle");
  });

  it("should preserve newer local revision when incoming doc has older updatedAt timestamp", async () => {
    const initialDoc: ItemDoc = {
      _id: "conflict_item",
      name: "Local Newer Version",
      updatedAt: "2026-10-16T12:00:00.000Z"
    };
    await db.put(initialDoc);

    const olderIncomingDoc: ItemDoc = {
      _id: "conflict_item",
      name: "Stale Remote Version",
      updatedAt: "2026-10-16T11:00:00.000Z"
    };

    // Simulate handleIncomingPayload through reflection
    // @ts-expect-error - testing private handleIncomingPayload directly
    await adapter.handleIncomingPayload({
      type: "SYNC_UPDATE",
      doc: olderIncomingDoc
    });

    const currentDoc = await db.get("conflict_item");
    expect(currentDoc.name).toBe("Local Newer Version");
  });

  it("should overwrite local document when incoming doc has newer updatedAt timestamp", async () => {
    const initialDoc: ItemDoc = {
      _id: "conflict_item_2",
      name: "Old Local",
      updatedAt: "2026-10-16T10:00:00.000Z"
    };
    await db.put(initialDoc);

    const newerIncomingDoc: ItemDoc = {
      _id: "conflict_item_2",
      name: "Newer Remote Winner",
      updatedAt: "2026-10-16T14:00:00.000Z"
    };

    // @ts-expect-error - testing private handleIncomingPayload directly
    await adapter.handleIncomingPayload({
      type: "SYNC_UPDATE",
      doc: newerIncomingDoc
    });

    const currentDoc = await db.get("conflict_item_2");
    expect(currentDoc.name).toBe("Newer Remote Winner");
  });
});
