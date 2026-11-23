// Web FileAdapter on the File System Access API (requirements 3, F-01 to F-05).
// File I/O is the only environment-specific part; a desktop build will provide another adapter.
import { decodeUtf8, encodeUtf8 } from '@mend/core'

export interface OpenedFile {
  readonly name: string
  /** Decoded with fatal UTF-8, without the BOM. */
  readonly source: string
  readonly hasBom: boolean
  /** File timestamp when it was read or last written by Mend (F-05). */
  readonly lastModified: number
  /** null when the browser gave no handle (e.g. some drops): saving then always asks for a location. */
  readonly handle: FileSystemFileHandle | null
}

export type FileErrorCode =
  | 'invalid-utf8'
  | 'not-a-file'
  | 'permission-denied'
  | 'read-failed'
  | 'write-failed'
  | 'unsupported'

/** A failure the UI explains in its own words (lib/messages.ts). `cause` keeps the original error. */
export class FileError extends Error {
  constructor(
    readonly code: FileErrorCode,
    message: string,
    readonly fileName?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'FileError'
  }
}

export interface FileAdapter {
  /** Shows the open picker. Resolves null when the user cancels. */
  readonly open: () => Promise<OpenedFile | null>
  /** Opens a handle (drop or recent files), asking for read permission if needed. */
  readonly openHandle: (handle: FileSystemFileHandle) => Promise<OpenedFile>
  /** Opens a plain File without a handle (fallback for drops). */
  readonly openFile: (file: File) => Promise<OpenedFile>
  /** F-05: true when the file on disk changed after it was opened or saved. */
  readonly modifiedOnDisk: (file: OpenedFile) => Promise<boolean>
  /** F-02: overwrites the file. Only verified sources may be passed. */
  readonly save: (file: OpenedFile, source: string) => Promise<OpenedFile>
  /** F-03: asks for a new location. Resolves null when the user cancels. */
  readonly saveAs: (file: OpenedFile, source: string) => Promise<OpenedFile | null>
}

/** S-04: called after every successful write (future Git history). Empty in the MVP. */
export type AfterSaveHook = (
  oldSource: string,
  newSource: string,
  meta: { readonly name: string },
) => Promise<void>

const HTML_TYPES: FilePickerAcceptType[] = [
  { description: 'HTML', accept: { 'text/html': ['.html', '.htm'] } },
]

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'

const describe = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error)

async function decodeFile(file: File, handle: FileSystemFileHandle | null): Promise<OpenedFile> {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch (error: unknown) {
    throw new FileError(
      'read-failed',
      `Could not read ${file.name}: ${describe(error)}`,
      file.name,
      {
        cause: error,
      },
    )
  }
  const decoded = decodeUtf8(bytes)
  if (!decoded.ok) throw new FileError('invalid-utf8', decoded.error.message, file.name)
  return {
    name: file.name,
    source: decoded.source,
    hasBom: decoded.hasBom,
    lastModified: file.lastModified,
    handle,
  }
}

async function ensurePermission(
  handle: FileSystemHandle,
  mode: FileSystemPermissionMode,
): Promise<void> {
  if ((await handle.queryPermission({ mode })) === 'granted') return
  if ((await handle.requestPermission({ mode })) !== 'granted') {
    throw new FileError(
      'permission-denied',
      `Permission "${mode}" was not granted for ${handle.name}`,
      handle.name,
    )
  }
}

async function write(
  handle: FileSystemFileHandle,
  file: OpenedFile,
  source: string,
): Promise<OpenedFile> {
  await ensurePermission(handle, 'readwrite')
  try {
    // createWritable writes to a temporary file and replaces the original on close.
    const stream = await handle.createWritable()
    try {
      await stream.write(encodeUtf8(source, file.hasBom))
      await stream.close()
    } catch (error: unknown) {
      await stream.abort().catch((abortError: unknown) => {
        console.error('Mend: could not abort the write stream', abortError)
      })
      throw error
    }
    const written = await handle.getFile()
    return { ...file, name: written.name, source, lastModified: written.lastModified, handle }
  } catch (error: unknown) {
    throw new FileError(
      'write-failed',
      `Could not write ${handle.name}: ${describe(error)}`,
      handle.name,
      {
        cause: error,
      },
    )
  }
}

export function createWebFileAdapter(win: Window = window): FileAdapter {
  const openHandle = async (handle: FileSystemFileHandle): Promise<OpenedFile> => {
    await ensurePermission(handle, 'read')
    let file: File
    try {
      file = await handle.getFile()
    } catch (error: unknown) {
      throw new FileError(
        'read-failed',
        `Could not read ${handle.name}: ${describe(error)}`,
        handle.name,
        {
          cause: error,
        },
      )
    }
    return decodeFile(file, handle)
  }

  const saveAs = async (file: OpenedFile, source: string): Promise<OpenedFile | null> => {
    if (!win.showSaveFilePicker)
      throw new FileError('unsupported', 'showSaveFilePicker is not available')
    let handle: FileSystemFileHandle
    try {
      handle = await win.showSaveFilePicker({
        suggestedName: file.name,
        types: HTML_TYPES,
        ...(file.handle ? { startIn: file.handle } : {}),
      })
    } catch (error: unknown) {
      if (isAbort(error)) return null
      throw error
    }
    return write(handle, file, source)
  }

  return {
    open: async () => {
      if (!win.showOpenFilePicker)
        throw new FileError('unsupported', 'showOpenFilePicker is not available')
      let handles: FileSystemFileHandle[]
      try {
        handles = await win.showOpenFilePicker({ types: HTML_TYPES, multiple: false })
      } catch (error: unknown) {
        if (isAbort(error)) return null
        throw error
      }
      const [handle] = handles
      return handle ? openHandle(handle) : null
    },
    openHandle,
    openFile: (file) => decodeFile(file, null),
    modifiedOnDisk: async (file) => {
      if (!file.handle) return false
      try {
        const current = await file.handle.getFile()
        return current.lastModified !== file.lastModified
      } catch (error: unknown) {
        throw new FileError(
          'read-failed',
          `Could not check ${file.name} before saving: ${describe(error)}`,
          file.name,
          { cause: error },
        )
      }
    },
    save: async (file, source) => {
      if (!file.handle) throw new FileError('unsupported', 'This file has no handle; use saveAs')
      return write(file.handle, file, source)
    },
    saveAs,
  }
}
