# HerdSync

A modular, local-first synchronization toolkit designed for static Next.js applications (`output: 'export'`). Persist application state locally in IndexedDB and synchronize seamlessly across remote CouchDB servers or directly between browsers via WebRTC.

---

## Workspace Packages

| Package                                                   | Version | Description                                                                               |
| :-------------------------------------------------------- | :------ | :---------------------------------------------------------------------------------------- |
| [`@onebuffalo/herd-sync`](./packages/core)                | `0.1.0` | Core client-side database provider, reactive `useHerdDoc` hook, and CouchDB sync adapter. |
| [`@onebuffalo/adapter-webrtc`](./packages/adapter-webrtc) | `0.1.0` | Zero-backend peer-to-peer sync adapter using WebRTC data channels and QR-code signaling.  |
| `playground`                                              | `0.1.0` | Reference Next.js 15 playground verifying persistence, replication, and camera scanning.  |

---

## Quick Start

Install the core package in your Next.js application:

```bash
pnpm add @onebuffalo/herd-sync

```

Wrap your application in `HerdSyncProvider` and read/write reactive documents using `useHerdDoc`:

```tsx
"use client";

import { HerdSyncProvider, useHerdDoc, type HerdDoc } from "@onebuffalo/herd-sync";

interface Note extends HerdDoc {
  body: string;
}

function NoteEditor() {
  const { doc, save } = useHerdDoc<Note>("daily_note", { body: "" });

  return <textarea value={doc?.body || ""} onChange={(e) => void save({ body: e.target.value })} />;
}

export default function App() {
  return (
    <HerdSyncProvider name="notes_db">
      <NoteEditor />
    </HerdSyncProvider>
  );
}
```

Detailed hook documentation, configuration flags, and WebRTC integration guides can be found in each package directory:

- [Core Sync Engine Documentation](https://www.google.com/search?q=./packages/core/README.md)
- [WebRTC P2P Adapter Documentation](https://www.google.com/search?q=./packages/adapter-webrtc/README.md)

---

## Monorepo Development

HerdSync is built with Turborepo, pnpm workspaces, TypeScript, and Vitest.

```bash
# Install workspace dependencies
pnpm install

# Build all packages and the static Next.js playground
pnpm build

# Start local dev server in watch mode
pnpm dev

# Execute Vitest test suites (PouchDB lifecycle, backoff, WebRTC LWW)
pnpm test

# Run ESLint v9 Flat Config across packages
pnpm lint

# Check formatting
pnpm format:check

```

---

HerdSync is an open-source initiative developed and maintained by [OneBuffaloLabs.com](https://onebuffalolabs.com).
