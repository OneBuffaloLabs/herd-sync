# @onebuffalo/adapter-webrtc

Zero-backend peer-to-peer replication adapter for HerdSync using WebRTC data channels and QR-code signaling.

---

## Installation

```bash
pnpm add @onebuffalo/adapter-webrtc @onebuffalo/herd-sync

```

---

## Usage

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useHerdSync } from "@onebuffalo/herd-sync";
import { WebRTCAdapter, SyncModal } from "@onebuffalo/adapter-webrtc";

export function P2PSyncButton() {
  const { db } = useHerdSync();
  const [open, setOpen] = useState(false);
  const adapterRef = useRef<WebRTCAdapter null |>(null);

  useEffect(() => {
    if (!db) return;
    const adapter = new WebRTCAdapter(db);
    adapterRef.current = adapter;
    return () => {
      void adapter.stop();
    };
  }, [db]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Sync Nearby Devices
      </button>
      {open && adapterRef.current && (
        <SyncModal adapter="{adapterRef.current}" onClose="{()"> setOpen(false)}
        />
      )}
    </>
  );
}
```

---

## Conflict Resolution

WebRTC data streams synchronize without a central authority using Last-Write-Wins (LWW) conflict resolution. Whenever an incoming payload is received, the adapter compares the ISO 8601 string in `updatedAt` against the local revision. The record with the newer timestamp takes precedence.
