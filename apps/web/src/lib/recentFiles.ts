// F-06: recently opened files, kept in IndexedDB (handles are structured-cloneable; paths are not available).

export interface RecentFile {
  readonly id: string
  readonly name: string
  readonly openedAt: number
  readonly handle: FileSystemFileHandle
}

export interface RecentFiles {
  readonly list: () => Promise<RecentFile[]>
  /** Adds or refreshes a file (deduplicated with isSameEntry). */
  readonly touch: (handle: FileSystemFileHandle) => Promise<void>
  readonly remove: (id: string) => Promise<void>
}

const DB_NAME = 'mend'
const STORE = 'recent-files'
const MAX_RECENT = 10

const request = <T>(req: IDBRequest<T>, what: string): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new Error(`Mend: IndexedDB ${what} failed`, { cause: req.error }))
  })

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  const req = factory.open(DB_NAME, 1)
  req.onupgradeneeded = () => {
    req.result.createObjectStore(STORE, { keyPath: 'id' })
  }
  return request(req, 'open')
}

const isRecentFile = (v: unknown): v is RecentFile =>
  typeof v === 'object' &&
  v !== null &&
  'id' in v &&
  'name' in v &&
  'openedAt' in v &&
  'handle' in v &&
  typeof v.id === 'string' &&
  typeof v.name === 'string' &&
  typeof v.openedAt === 'number'

export function createRecentFiles(factory: IDBFactory = indexedDB): RecentFiles {
  let db: Promise<IDBDatabase> | undefined
  const store = async (mode: IDBTransactionMode): Promise<IDBObjectStore> => {
    db ??= openDb(factory)
    return (await db).transaction(STORE, mode).objectStore(STORE)
  }

  const list = async (): Promise<RecentFile[]> => {
    const all: unknown[] = await request((await store('readonly')).getAll(), 'read')
    return all.filter(isRecentFile).sort((a, b) => b.openedAt - a.openedAt)
  }

  return {
    list,
    touch: async (handle) => {
      const existing = await list()
      const same: RecentFile[] = []
      for (const r of existing) {
        if (await r.handle.isSameEntry(handle)) same.push(r)
      }
      const keep = existing.filter((r) => !same.includes(r))
      const entry: RecentFile = {
        id: same[0]?.id ?? crypto.randomUUID(),
        name: handle.name,
        openedAt: Date.now(),
        handle,
      }
      const s = await store('readwrite')
      for (const r of same.slice(1)) await request(s.delete(r.id), 'delete')
      for (const r of keep.slice(MAX_RECENT - 1)) await request(s.delete(r.id), 'delete')
      await request(s.put(entry), 'write')
    },
    remove: async (id) => {
      await request((await store('readwrite')).delete(id), 'delete')
    },
  }
}
