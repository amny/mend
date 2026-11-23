// An in-memory stand-in for the File System Access API pickers (Playwright cannot drive the native dialogs).
// installFakeFileSystem is serialized into the page by addInitScript, so it must not reference anything outside
// its own body.

export interface FakeFileSystem {
  /** Creates or replaces a file, as another app would (new timestamp). */
  readonly put: (name: string, base64: string) => void
  /** The file's bytes as base64, or null when it does not exist. */
  readonly read: (name: string) => string | null
  /** Changes the file on disk behind Mend's back (F-05). */
  readonly modifyExternally: (name: string, base64: string) => void
  readonly names: () => string[]
  /** Name returned by the next showOpenFilePicker; null makes the picker report a cancel. */
  nextOpen: string | null
  /** Name returned by the next showSaveFilePicker; null makes the picker report a cancel. */
  nextSave: string | null
  /** suggestedName passed to the last showSaveFilePicker. */
  lastSuggestedName: string | null
  /** Completed writes (createWritable + close). */
  writes: number
}

declare global {
  interface Window {
    __fakeFs: FakeFileSystem
    /** Compiled into the app only with VITE_MEND_TEST_HOOKS=1 (src/testHooks.ts). */
    __mendTestHooks?: { readonly failNextSave: () => void }
  }
}

export function installFakeFileSystem(): void {
  interface Entry {
    readonly bytes: Uint8Array
    readonly lastModified: number
  }
  const files = new Map<string, Entry>()
  const handles = new Map<string, FileSystemFileHandle>()
  let clock = 1_700_000_000_000
  const tick = (): number => (clock += 1000)

  const fromBase64 = (base64: string): Uint8Array =>
    Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const toBase64 = (bytes: Uint8Array): string => {
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return btoa(binary)
  }
  const concat = (chunks: readonly Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
    chunks.reduce((at, c) => {
      out.set(c, at)
      return at + c.length
    }, 0)
    return out
  }

  const handleFor = (name: string): FileSystemFileHandle => {
    const cached = handles.get(name)
    if (cached) return cached
    const handle = {
      kind: 'file',
      name,
      getFile: async () => {
        const entry = files.get(name)
        if (!entry) throw new DOMException(`fake fs: ${name} does not exist`, 'NotFoundError')
        return new File([entry.bytes.slice()], name, {
          type: 'text/html',
          lastModified: entry.lastModified,
        })
      },
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      isSameEntry: async (other: unknown) => other === handle,
      createWritable: async () => {
        const chunks: Uint8Array[] = []
        return {
          write: async (data: unknown) => {
            if (!(data instanceof Uint8Array)) {
              throw new TypeError('fake fs: only Uint8Array writes are supported')
            }
            chunks.push(data.slice())
          },
          close: async () => {
            files.set(name, { bytes: concat(chunks), lastModified: tick() })
            api.writes += 1
          },
          abort: async () => {},
        }
      },
    }
    const typed = handle as unknown as FileSystemFileHandle
    handles.set(name, typed)
    return typed
  }

  const cancel = (): DOMException => new DOMException('fake fs: the user cancelled', 'AbortError')

  const api: FakeFileSystem = {
    put: (name, base64) => {
      files.set(name, { bytes: fromBase64(base64), lastModified: tick() })
    },
    read: (name) => {
      const entry = files.get(name)
      return entry ? toBase64(entry.bytes) : null
    },
    modifyExternally: (name, base64) => {
      files.set(name, { bytes: fromBase64(base64), lastModified: tick() })
    },
    names: () => [...files.keys()].sort(),
    nextOpen: null,
    nextSave: null,
    lastSuggestedName: null,
    writes: 0,
  }
  window.__fakeFs = api

  Object.defineProperty(window, 'showOpenFilePicker', {
    configurable: true,
    value: async () => {
      const name = api.nextOpen
      if (name === null) throw cancel()
      return [handleFor(name)]
    },
  })
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value: async (options?: { suggestedName?: string }) => {
      api.lastSuggestedName = options?.suggestedName ?? null
      const name = api.nextSave
      if (name === null) throw cancel()
      return handleFor(name)
    },
  })
}
