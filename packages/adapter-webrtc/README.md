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

## Styling (`classNames` &amp; `colors`)

Pass `classNames` for Tailwind CSS or custom classes, or `colors` for quick theme overrides:

```tsx
<SyncModal
  adapter={adapter}
  onClose={() => setOpen(false)}
  colors={{
    background: "#0f172a",
    text: "#f8fafc",
    primary: "#2563eb",
    primaryText: "#ffffff",
    border: "#334155",
    inputBackground: "#1e293b"
  }}
  classNames={{
    dialog: "shadow-2xl border border-slate-700",
    primaryButton: "rounded-lg font-medium hover:opacity-90",
    secondaryButton: "rounded-lg border border-slate-600 text-sm"
  }}
/>
```

Available `classNames` slots: `overlay`, `dialog`, `heading`, `text`, `primaryButton`, `secondaryButton`, `input`, `qrContainer`, `closeButton`, `errorText`, and `successHeading`.

Available `colors` tokens: `overlay`, `background`, `text`, `border`, `primary`, `primaryText`, `secondary`, `secondaryText`, `inputBackground`, `qrBackground`, `qrForeground`, `success`, and `error`.

Every key element also has a stable `herd-sync-*` ID (such as `#herd-sync-overlay`, `#herd-sync-dialog`, `#herd-sync-qr-container`, `#herd-sync-qr-snippet`, `#herd-sync-email-input`, `#herd-sync-paste-snippet`, and `#herd-sync-close-btn`) if you prefer targeting them directly in CSS.

---

## Conflict Resolution

WebRTC data streams synchronize without a central authority using Last-Write-Wins (LWW) conflict resolution. Whenever an incoming payload is received, the adapter compares the ISO 8601 string in `updatedAt` against the local revision. The record with the newer timestamp takes precedence.
