"use client";

import { useEffect, useState } from "react";
import { initHerdSync, HerdSyncStatus } from "@onebuffalo/herd-sync";

export default function PlaygroundPage() {
  const [syncState, setSyncState] = useState<HerdSyncStatus | null>(null);

  useEffect(() => {
    const state = initHerdSync({ dbName: "playground_test_db" });
    setSyncState(state);
  }, []);

  return (
    <main>
      <h1>HerdSync Static Playground</h1>
      <p>Testing static export bundle resolution for @onebuffalo/herd-sync.</p>
      <div
        style={{
          padding: "1rem",
          border: "1px solid #ccc",
          borderRadius: "8px",
        }}
      >
        <strong>Sync State:</strong>
        <pre>{JSON.stringify(syncState, null, 2)}</pre>
      </div>
    </main>
  );
}
