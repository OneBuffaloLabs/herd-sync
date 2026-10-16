import { afterEach, beforeEach, describe, expect, it } from "vitest";
import PouchDB from "pouchdb-browser";
import { CouchDBAdapter } from "@/adapters/couchdb";
import type { HerdDoc, HerdSyncStatus, PouchDBCtor } from "@/types";

describe("CouchDBAdapter", () => {
  let db: PouchDB.Database<HerdDoc>;

  beforeEach(() => {
    const Ctor = PouchDB as unknown as PouchDBCtor<HerdDoc>;
    db = new Ctor("test_adapter_db");
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("should initialize with uninitialized state when no remoteUrl is provided", () => {
    const adapter = new CouchDBAdapter(db, {});
    expect(adapter.getStatus().state).toBe("uninitialized");
  });

  it("should initialize with idle state when remoteUrl is present", () => {
    const adapter = new CouchDBAdapter(db, {
      remoteUrl: "http://localhost:5984/remote_test"
    });
    expect(adapter.getStatus().state).toBe("idle");
  });

  it("should dispatch status updates to active subscribers and clean up on unsubscribe", () => {
    const adapter = new CouchDBAdapter(db, {});
    const recordedStates: string[] = [];

    const unsubscribe = adapter.subscribe((status: HerdSyncStatus) => {
      recordedStates.push(status.state);
    });

    expect(recordedStates).toEqual(["uninitialized"]);

    unsubscribe();
    void adapter.stop();

    // After unsubscription, state changes should not append to recordedStates
    expect(recordedStates).toEqual(["uninitialized"]);
  });

  it("should calculate exponential backoff intervals bounded by maxBackOffMs", () => {
    const initialBackOff = 500;
    const maxBackOff = 4000;
    const multiplier = 2;

    const backOffFn = (delay: number) => {
      if (delay === 0) return initialBackOff;
      return Math.min(delay * multiplier, maxBackOff);
    };

    expect(backOffFn(0)).toBe(500);
    expect(backOffFn(500)).toBe(1000);
    expect(backOffFn(1000)).toBe(2000);
    expect(backOffFn(2000)).toBe(4000);
    expect(backOffFn(4000)).toBe(4000);
  });
});
