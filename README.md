# HerdSync

A modular, local-first synchronization toolkit designed for static Next.js applications (`output: 'export'`). Persist application state locally in IndexedDB and synchronize seamlessly across remote CouchDB servers or directly between browsers via WebRTC.

---

## Workspace Packages

| Package                                                       | Version | Description                                                                                                |
| :------------------------------------------------------------ | :------ | :--------------------------------------------------------------------------------------------------------- |
| [`@onebuffalolabs/herd-sync`](./packages/core)                | `0.1.0` | Core client-side database provider, reactive `useHerdDoc` hook, CouchDB sync adapter, and conflict engine. |
| [`@onebuffalolabs/adapter-webrtc`](./packages/adapter-webrtc) | `0.1.0` | Zero-backend peer-to-peer sync adapter using WebRTC data channels and QR-code signaling.                   |
| `playground`                                                  | `0.1.0` | Reference Next.js 15 playground verifying persistence, replication, and camera scanning.                   |

---

## Quick Start

Install the core package in your Next.js application:

```bash
pnpm add @onebuffalolabs/herd-sync

```

Wrap your application tree in `HerdSyncProvider` and read/write reactive documents using `useHerdDoc`:

```tsx
"use client";

import { HerdSyncProvider, useHerdDoc, type HerdDoc } from "@onebuffalolabs/herd-sync";

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

# Run full pre-publish verification gate
pnpm verify

```

---

## Releases and Deployment

Publishing to the public npm registry is scoped under the `@onebuffalolabs` organization.

### 1. Version Bumping

Run from the root directory to advance workspace versions:

```bash
# Patch release (e.g., 0.1.0 -> 0.1.1)
pnpm --filter @onebuffalolabs/herd-sync --filter @onebuffalolabs/adapter-webrtc exec npm version patch

# Minor release (e.g., 0.1.0 -> 0.2.0)
pnpm --filter @onebuffalolabs/herd-sync --filter @onebuffalolabs/adapter-webrtc exec npm version minor

```

### 2. Publishing to npm

The `pnpm release` script executes the complete verification suite (`format:check`, `lint`, `test`, `build`) before publishing:

```bash
# Log in to npm (must belong to onebuffalolabs organization)
npm login

# Run full verification pipeline and publish
pnpm release

```

---

> HerdSync is an open-source initiative developed and maintained by [OneBuffaloLabs.com](https://onebuffalolabs.com).
