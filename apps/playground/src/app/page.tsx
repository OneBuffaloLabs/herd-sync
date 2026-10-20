"use client";

// --- React ---
import { useEffect, useRef, useState } from "react";

// --- WebRTC ---
import { SyncModal, WebRTCAdapter } from "@onebuffalolabs/adapter-webrtc";

// --- HerdSync ---
import { HerdDoc, HerdSyncProvider, useHerdDoc, useHerdSync } from "@onebuffalolabs/herd-sync";

interface TaskDoc extends HerdDoc {
  title: string;
  completed: boolean;
}

function PlaygroundInner() {
  const { db, status } = useHerdSync();
  const { doc, save, loading } = useHerdDoc<TaskDoc>("test_task_1", {
    title: "Initial Local Task",
    completed: false
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [webrtcStatus, setWebrtcStatus] = useState("idle");
  const webrtcAdapterRef = useRef<WebRTCAdapter | null>(null);

  useEffect(() => {
    if (!db) return;
    const adapter = new WebRTCAdapter(db);
    webrtcAdapterRef.current = adapter;
    const unsubscribe = adapter.subscribe((s) => setWebrtcStatus(s.state));

    return () => {
      unsubscribe();
      void adapter.stop();
    };
  }, [db]);

  const handleToggle = (): void => {
    void save({
      title: `Task updated at ${new Date().toLocaleTimeString()}`,
      completed: !doc?.completed
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <section style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: "8px" }}>
        <h2>Live Sync State</h2>
        <p>
          <strong>CouchDB Sync State:</strong> {status.state}
        </p>
        <p>
          <strong>WebRTC P2P State:</strong> {webrtcStatus}
        </p>
        <p>
          <strong>Pending Replications:</strong> {status.pendingPushes}
        </p>
        <p>
          <strong>Last Sync Timestamp:</strong> {status.lastSyncedAt || "Never"}
        </p>
        {status.error && (
          <p style={{ color: "#d32f2f" }}>
            <strong>Error:</strong> {status.error}
          </p>
        )}
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          style={{ padding: "0.5rem 1rem", marginTop: "0.5rem", cursor: "pointer" }}
        >
          Open P2P QR Sync Modal
        </button>
      </section>

      <section style={{ border: "1px solid #ccc", padding: "1rem", borderRadius: "8px" }}>
        <h2>Reactive Document (useHerdDoc)</h2>
        {loading ? (
          <p>Loading document from local storage...</p>
        ) : (
          <div>
            <pre style={{ background: "#f4f4f4", padding: "1rem", borderRadius: "4px" }}>
              {JSON.stringify(doc, null, 2)}
            </pre>
            <button
              type="button"
              onClick={handleToggle}
              style={{ padding: "0.5rem 1rem", cursor: "pointer", marginTop: "0.5rem" }}
            >
              Toggle &amp; Save Document
            </button>
          </div>
        )}
      </section>

      {isModalOpen && webrtcAdapterRef.current && (
        <SyncModal adapter={webrtcAdapterRef.current} onClose={() => setIsModalOpen(false)} />
      )}
    </div>
  );
}

export default function Page() {
  const [remoteUrl, setRemoteUrl] = useState("");

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>HerdSync Local-First Playground</h1>
      <p>Testing PouchDB client-side persistence, CouchDB sync, and P2P WebRTC.</p>

      <div style={{ marginBottom: "1.5rem" }}>
        <label htmlFor="remote-url-input" style={{ display: "block", marginBottom: "0.5rem" }}>
          Remote CouchDB URL (optional):
        </label>
        <input
          id="remote-url-input"
          type="text"
          value={remoteUrl}
          onChange={(e) => setRemoteUrl(e.target.value)}
          placeholder="http://127.0.0.1:5984/playground_remote"
          style={{ width: "100%", maxWidth: "500px", padding: "0.5rem" }}
        />
      </div>

      <HerdSyncProvider name="playground_tasks_db" remoteUrl={remoteUrl || undefined}>
        <PlaygroundInner />
      </HerdSyncProvider>
    </main>
  );
}
