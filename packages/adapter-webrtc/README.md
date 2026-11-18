# @onebuffalolabs/adapter-webrtc

Zero-backend peer-to-peer replication adapter for HerdSync using WebRTC data channels and QR-code signaling.

---

## Installation

```bash
pnpm add @onebuffalolabs/adapter-webrtc @onebuffalolabs/herd-sync

```

---

## Usage

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useHerdSync } from "@onebuffalolabs/herd-sync";
import { WebRTCAdapter, SyncModal } from "@onebuffalolabs/adapter-webrtc";

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

## Pairing Options

`SyncModal` prunes non-data-channel SDP lines and redundant ICE candidates before encoding so QR codes stay sparse and scan quickly. When a camera isn&apos;t handy, users can also pair using:

- **Copyable Snippet**: Copy and paste the compressed pairing text directly.
- **Shareable `#pair=` Link**: Copy the `#pair=...` URL or send it with the **Email** (`mailto:`), **Text** (`sms:`), or native **Share** button.

If your app checks `window.location.hash.includes("pair=")` on load and opens `SyncModal`, `SyncModal` will automatically read the `#pair=` payload and start joining. You can also pass `initialPairingPayload` directly as a prop.

---

## Conflict Resolution

WebRTC data streams synchronize without a central authority using Last-Write-Wins (LWW) conflict resolution. Whenever an incoming payload is received, the adapter compares the ISO 8601 string in `updatedAt` against the local revision. The record with the newer timestamp takes precedence.
