// Screens, opening files (F-01, F-06), unsaved-changes warnings (F-04) and the window title.
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactElement } from 'react'
import { Dialog } from './components/Dialog'
import { EditorScreen } from './components/EditorScreen'
import { WarningIcon } from './components/Icons'
import { StartScreen } from './components/StartScreen'
import { FileError, type AfterSaveHook, type FileAdapter, type OpenedFile } from './lib/fileAdapter'
import { fileErrorMessage, type Message } from './lib/messages'
import type { RecentFile, RecentFiles } from './lib/recentFiles'

export interface AppProps {
  readonly adapter: FileAdapter
  readonly recentFiles: RecentFiles
  readonly afterSave: AfterSaveHook
}

interface Session {
  readonly file: OpenedFile
  /** Changes for every newly opened file, so the editor is created again. */
  readonly key: number
}

type Loader = () => Promise<OpenedFile | null>

/** Starts reading a drop synchronously (items are only readable during the event). */
function loaderFromDrop(e: DragEvent<HTMLElement>, adapter: FileAdapter): Loader | null {
  const item = Array.from(e.dataTransfer.items).find((i) => i.kind === 'file')
  if (!item) return null
  const handlePromise = item.getAsFileSystemHandle?.() ?? null
  const file = item.getAsFile()
  return async () => {
    const handle = handlePromise ? await handlePromise : null
    if (handle && handle.kind === 'file') return adapter.openHandle(handle as FileSystemFileHandle)
    if (handle && handle.kind === 'directory')
      throw new FileError('not-a-file', 'A directory was dropped')
    if (file) return adapter.openFile(file)
    throw new FileError('not-a-file', 'The drop contained no file')
  }
}

export function App({ adapter, recentFiles, afterSave }: AppProps): ReactElement {
  const [session, setSession] = useState<Session | null>(null)
  const [dirty, setDirty] = useState(false)
  const [recent, setRecent] = useState<readonly RecentFile[]>([])
  const [error, setError] = useState<Message | null>(null)
  /** An open/close action waiting for "変更を破棄" (F-04). */
  const [pending, setPending] = useState<(() => void) | null>(null)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  const refreshRecent = useCallback(() => {
    recentFiles
      .list()
      .then(setRecent, (e: unknown) => console.error('Mend: could not read recent files', e))
  }, [recentFiles])
  useEffect(refreshRecent, [refreshRecent])

  /** Runs `action` now, or after confirmation when there are unsaved changes. */
  const guard = useCallback((action: () => void) => {
    if (dirtyRef.current) setPending(() => action)
    else action()
  }, [])

  const load = useCallback(
    async (loader: Loader): Promise<void> => {
      try {
        const file = await loader()
        if (!file) return
        setDirty(false)
        setSession({ file, key: Date.now() })
        if (file.handle) {
          await recentFiles.touch(file.handle).catch((e: unknown) => {
            console.error('Mend: could not update recent files', e)
          })
          refreshRecent()
        }
      } catch (e: unknown) {
        console.error('Mend: could not open the file', e)
        setError(
          e instanceof FileError
            ? fileErrorMessage(e.code, e.fileName)
            : {
                title: 'ファイルを開けませんでした',
                body: `予期しないエラーが発生しました：${String(e)}`,
              },
        )
      }
    },
    [recentFiles, refreshRecent],
  )

  const open = useCallback(() => guard(() => void load(adapter.open)), [adapter, guard, load])

  const onDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      const loader = loaderFromDrop(e, adapter)
      if (loader) guard(() => void load(loader))
    },
    [adapter, guard, load],
  )

  // F-04: title shows unsaved changes; closing the tab asks first.
  useEffect(() => {
    document.title = session ? `${dirty ? '● ' : ''}${session.file.name} - Mend` : 'Mend'
  }, [dirty, session])
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent): void => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        open()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const onFileChange = useCallback((file: OpenedFile) => {
    setSession((s) => (s ? { ...s, file } : s))
  }, [])

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={session ? onDrop : (e) => e.preventDefault()}
    >
      {session ? (
        <EditorScreen
          key={session.key}
          file={session.file}
          adapter={adapter}
          afterSave={afterSave}
          onFileChange={onFileChange}
          onDirtyChange={setDirty}
          onHome={() =>
            guard(() => {
              setDirty(false)
              setSession(null)
              refreshRecent()
            })
          }
        />
      ) : (
        <StartScreen
          recent={recent}
          onOpen={open}
          onOpenRecent={(r) => void load(() => adapter.openHandle(r.handle))}
          onDrop={onDrop}
        />
      )}

      {pending && (
        <Dialog
          icon={<WarningIcon />}
          tone="warning"
          title="保存されていない変更があります"
          onClose={() => setPending(null)}
          actions={[
            { label: 'キャンセル', onClick: () => setPending(null) },
            {
              label: '変更を破棄して続ける',
              kind: 'danger',
              onClick: () => {
                const action = pending
                setPending(null)
                action()
              },
            },
          ]}
        >
          <p>このまま続けると、保存していない変更は失われます。</p>
        </Dialog>
      )}
      {error && (
        <Dialog
          icon={<WarningIcon />}
          tone="warning"
          title={error.title}
          onClose={() => setError(null)}
          actions={[{ label: '閉じる', kind: 'primary', onClick: () => setError(null) }]}
        >
          <p>{error.body}</p>
        </Dialog>
      )}
    </div>
  )
}
