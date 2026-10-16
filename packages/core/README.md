# @onebuffalo/herd-sync

Core local-first state and database synchronization engine for HerdSync. Provides dynamic client-side PouchDB initialization, reactive React hooks, and bi-directional CouchDB synchronization.

---

## Installation

```bash
pnpm add @onebuffalo/herd-sync

```

---

## Components & Hooks

### `HerdSyncProvider`

Initializes the browser database and orchestrates background replication tasks.

```tsx
import { HerdSyncProvider } from "@onebuffalo/herd-sync";

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
