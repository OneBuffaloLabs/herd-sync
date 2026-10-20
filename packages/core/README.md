# @onebuffalolabs/herd-sync

Core local-first state and database synchronization engine for HerdSync. Provides dynamic client-side PouchDB initialization, reactive React hooks, bi-directional CouchDB synchronization, and pluggable conflict resolution.

---

## Installation

```bash
pnpm add @onebuffalolabs/herd-sync

```

### Static Next.js Configuration (`output: 'export'`)

When using HerdSync inside static Next.js applications, configure `next.config.mjs` to transpile the package and stub node-specific server fallbacks:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  transpilePackages: ["@onebuffalolabs/herd-sync"],
  images: {
    unoptimized: true
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        events: false,
        buffer: false,
        stream: false
      };
    }
    return config;
  }
};

export default nextConfig;
```

---

## Components & Hooks

### `HerdSyncProvider`

Initializes the browser database and orchestrates background replication tasks.

```tsx
import { HerdSyncProvider } from "@onebuffalolabs/herd-sync";

<HerdSyncProvider
  live="{true}"
  name="my_local_db"
  remoteUrl="[https://couchdb.example.com/my_remote_db](https://couchdb.example.com/my_remote_db)"
  retry="{true}"
>
  {children}
</HerdSyncProvider>;
```

### `useHerdDoc(id, initialDoc?)`

Binds a single document to reactive React state. Subscribes to live local and remote database changes automatically.

```tsx
const { doc, loading, error, save, remove } = useHerdDoc<TaskDoc>("task_123", {
  title: "Default Title",
  completed: false
});
```

- `doc`: Current document object (`T | null`).
- `loading`: `true` while the document is initially being resolved from local storage.
- `error`: Non-null if an IndexedDB read/write failure occurs.
- `save(patch)`: Persists updates, generates an updated ISO `updatedAt` timestamp, and writes the current `_rev`.
- `remove()`: Marks the document as deleted and purges it locally.

### Conflict Resolution

Resolve divergent PouchDB revision branches using `resolveDocConflicts` with built-in strategies (`resolveLWW`, `createArrayMergeResolver`) or custom domain handlers:

```typescript
import { resolveDocConflicts, resolveLWW } from "@onebuffalolabs/herd-sync";

await resolveDocConflicts(db, "task_123", {
  resolver: resolveLWW
});
```

---

## Document Requirements

All documents must adhere to `HerdDoc`:

```typescript
export interface HerdDoc {
  _id: string;
  _rev?: string;
  _deleted?: boolean;
  updatedAt?: string;
  [key: string]: unknown;
}
```

> **Important:** Do not prefix custom fields with leading underscores (e.g., use `updatedAt`, not `_updatedAt`). CouchDB reserves leading underscores for database metadata.
