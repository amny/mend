// Editor screen (docs/screens/editor.png): header, change list, editing view / preview, status bar and the
// save flow (F-02 to F-05, S-03, S-04).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { parseDocument, type SaveError } from '@mend/core'
import {
  createEditor,
  createPreview,
  type EditorState,
  type MendEditor,
  type PreparedSave,
  type Preview,
  type Shortcut,
} from '@mend/editor'
import {
  FileError,
  type AfterSaveHook,
  type FileAdapter,
  type OpenedFile,
} from '../lib/fileAdapter'
import { caretLocation, encodingLabel } from '../lib/format'
import {
  describeIssue,
  fileErrorMessage,
  readOnlyMessage,
  saveErrorMessage,
  type Message,
} from '../lib/messages'
import { consumeSaveFault } from '../testHooks'
import { ChangeList } from './ChangeList'
import { Dialog, Toast } from './Dialog'
import { Logo, RedoIcon, RefreshIcon, SearchIcon, UndoIcon, WarningIcon } from './Icons'
import { SearchBar } from './SearchBar'

export interface EditorScreenProps {
  readonly file: OpenedFile
  readonly adapter: FileAdapter
  readonly afterSave: AfterSaveHook
  /** The file was saved (new timestamp, maybe a new handle after "別名で保存"). */
  readonly onFileChange: (file: OpenedFile) => void
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onHome: () => void
}

type Mode = 'edit' | 'preview'

type Modal =
  | { readonly kind: 'save-error'; readonly error: SaveError }
  | { readonly kind: 'conflict'; readonly prepared: PreparedSave }
  | { readonly kind: 'message'; readonly message: Message }

const ROOT_PATH = '(document)'

const errorMessage = (error: unknown, fallbackTitle: string): Message => {
  if (error instanceof FileError) return fileErrorMessage(error.code, error.fileName)
  return { title: fallbackTitle, body: `予期しないエラーが発生しました：${String(error)}` }
}

export function EditorScreen({
  file,
  adapter,
  afterSave,
  onFileChange,
  onDirtyChange,
  onHome,
}: EditorScreenProps): ReactElement {
  const editorHost = useRef<HTMLDivElement>(null)
  const previewHost = useRef<HTMLDivElement>(null)
  const editorRef = useRef<MendEditor | null>(null)
  const previewRef = useRef<Preview | null>(null)
  const savingRef = useRef(false)
  // The file at mount time: the editor is created once per opened file (saving does not remount it).
  const initialSource = useRef(file.source).current
  const [state, setState] = useState<EditorState | null>(null)
  const [loadError, setLoadError] = useState<Message | null>(null)
  const [mode, setMode] = useState<Mode>('edit')
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFocus, setSearchFocus] = useState(0)
  const [activeChange, setActiveChange] = useState<number | null>(null)
  const [modal, setModal] = useState<Modal | null>(null)
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const doc = useMemo(() => parseDocument(initialSource), [initialSource])
  const unmappable = useMemo(
    () => doc.records.filter((r) => r.status === 'mapping-mismatch').length,
    [doc],
  )

  // --- Save (F-02 / F-03 / F-05 / S-03 / S-04) ---
  const fileRef = useRef(file)
  fileRef.current = file

  const write = useCallback(
    async (prepared: PreparedSave, asNew: boolean): Promise<void> => {
      const editor = editorRef.current
      if (!editor || !prepared.result.ok) return
      const current = fileRef.current
      const source = prepared.result.source
      const next =
        asNew || !current.handle
          ? await adapter.saveAs(current, source)
          : await adapter.save(current, source)
      if (!next) return
      editor.commitSave(prepared)
      onFileChange(next)
      const count = prepared.result.patches.length
      setToast({
        title: '保存しました',
        body:
          count === 0
            ? '変更はありません。元のファイルと同じ内容で保存しました。'
            : `変更 ${count}箇所。それ以外の部分は元のファイルと一致しています。`,
      })
      await afterSave(current.source, source, { name: next.name })
    },
    [adapter, afterSave, onFileChange],
  )

  const runSave = useCallback(async (task: () => Promise<void>): Promise<void> => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      await task()
    } catch (error: unknown) {
      console.error('Mend: save failed', error)
      setModal({ kind: 'message', message: errorMessage(error, '保存できませんでした') })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [])

  const save = useCallback(
    (asNew: boolean): Promise<void> =>
      runSave(async () => {
        const editor = editorRef.current
        if (!editor) return
        const prepared = editor.prepareSave(
          consumeSaveFault() ? { fault: 'corrupt-structure' } : {},
        )
        if (!prepared.result.ok) {
          console.warn('Mend: save stopped before writing', prepared.result.error)
          setModal({ kind: 'save-error', error: prepared.result.error })
          return
        }
        const current = fileRef.current
        if (!asNew && current.handle && (await adapter.modifiedOnDisk(current))) {
          setModal({ kind: 'conflict', prepared })
          return
        }
        await write(prepared, asNew)
      }),
    [adapter, runSave, write],
  )

  // --- Commands shared by buttons, parent-page keys and keys inside the iframe ---
  const openSearch = useCallback(() => {
    setMode('edit')
    setSearchOpen(true)
    setSearchFocus((n) => n + 1)
  }, [])

  const commands = useRef<Record<Shortcut, () => void>>({
    save: () => {},
    saveAs: () => {},
    find: () => {},
  })
  commands.current = {
    save: () => void save(false),
    saveAs: () => void save(true),
    find: openSearch,
  }

  // --- Editor lifecycle ---
  useEffect(() => {
    const host = editorHost.current
    if (!host) return
    let disposed = false
    let editor: MendEditor | undefined
    let unsubscribe: (() => void) | undefined
    // One container per run: a disposed run (React StrictMode) disappears at once, even while still loading.
    const container = host.ownerDocument.createElement('div')
    container.className = 'editor-frame'
    host.append(container)
    createEditor({ container, document: doc, onShortcut: (s) => commands.current[s]() }).then(
      (created) => {
        if (disposed) {
          created.destroy()
          return
        }
        editor = created
        editorRef.current = created
        setState(created.getState())
        unsubscribe = created.subscribe(setState)
      },
      (error: unknown) => {
        console.error('Mend: could not create the editor', error)
        if (!disposed) setLoadError(errorMessage(error, '編集ビューを開けませんでした'))
      },
    )
    return () => {
      disposed = true
      unsubscribe?.()
      editor?.destroy()
      container.remove()
      editorRef.current = null
    }
  }, [doc])

  useEffect(() => {
    const host = previewHost.current
    if (!host) return
    const preview = createPreview(host)
    previewRef.current = preview
    return () => {
      preview.destroy()
      previewRef.current = null
    }
  }, [])

  const dirty = (state?.changes.length ?? 0) > 0
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  // Keys while the focus is in the parent page (the iframe reports its own through onShortcut).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing) return
      const key = e.key.toLowerCase()
      const inField = e.target instanceof HTMLInputElement
      if (key === 's') {
        e.preventDefault()
        commands.current[e.shiftKey ? 'saveAs' : 'save']()
      } else if (key === 'f') {
        e.preventDefault()
        commands.current.find()
      } else if (!inField && (key === 'z' || key === 'y')) {
        e.preventDefault()
        if (key === 'z' && !e.shiftKey) editorRef.current?.undo()
        else editorRef.current?.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // --- Preview (V-02): the current patched source, never written anywhere ---
  const showMode = (next: Mode): void => {
    setMode(next)
    if (next !== 'preview') return
    const prepared = editorRef.current?.prepareSave()
    if (!prepared) return
    if (prepared.result.ok) {
      setPreviewError(null)
      previewRef.current?.show(prepared.result.source)
    } else {
      setPreviewError(
        saveErrorMessage(prepared.result.error).body.replace('ファイルは書き換えていません。', ''),
      )
    }
  }

  const readOnly = state?.readOnly ?? null
  const changes = state?.changes ?? []
  const caret = state?.caret ?? null

  return (
    <div className="editor-screen">
      <header className="topbar">
        <button type="button" className="brand" onClick={onHome} title="最初の画面に戻る">
          <Logo />
          <span>Mend</span>
        </button>
        <span className="topbar-divider" />
        <span className="file-name">{file.name}</span>
        {dirty && <span className="dirty-badge">未保存の変更 {changes.length}件</span>}
        <div className="topbar-spacer" />
        <div className="segmented" role="tablist" aria-label="表示の切り替え">
          {(['edit', 'preview'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'segmented-active' : ''}
              onClick={() => showMode(m)}
            >
              {m === 'edit' ? '編集' : 'プレビュー'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="元に戻す"
          title="元に戻す (Ctrl+Z)"
          disabled={!state?.canUndo || mode !== 'edit'}
          onClick={() => editorRef.current?.undo()}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="やり直す"
          title="やり直す (Ctrl+Y)"
          disabled={!state?.canRedo || mode !== 'edit'}
          onClick={() => editorRef.current?.redo()}
        >
          <RedoIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="検索"
          title="検索 (Ctrl+F)"
          onClick={openSearch}
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={saving}
          onClick={() => void save(true)}
        >
          別名で保存
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={saving}
          onClick={() => void save(false)}
        >
          保存 <kbd>Ctrl+S</kbd>
        </button>
      </header>

      <div className="workspace">
        <ChangeList
          changes={changes}
          activeId={activeChange}
          readOnly={readOnly !== null}
          onReveal={(id) => {
            setActiveChange(id)
            setMode('edit')
            editorRef.current?.revealChange(id)
          }}
          onRevert={(id) => editorRef.current?.revertChange(id)}
        />
        <main className="canvas">
          {readOnly && (
            <div className="banner banner-warning" role="alert">
              <WarningIcon />
              {readOnlyMessage(readOnly)}
            </div>
          )}
          {loadError && (
            <div className="banner banner-warning" role="alert">
              <WarningIcon />
              {loadError.title}：{loadError.body}
            </div>
          )}
          {mode === 'edit' && searchOpen && state && (
            <SearchBar
              search={state.search}
              focusToken={searchFocus}
              onQuery={(q) => editorRef.current?.find(q)}
              onNext={() => editorRef.current?.findNext()}
              onPrevious={() => editorRef.current?.findPrevious()}
              onClose={() => {
                setSearchOpen(false)
                editorRef.current?.clearFind()
                editorRef.current?.focus()
              }}
            />
          )}
          <div className="view" hidden={mode !== 'edit'} ref={editorHost} />
          <div className="view" hidden={mode !== 'preview'}>
            {previewError && (
              <div className="banner banner-warning" role="alert">
                <WarningIcon />
                プレビューを作れませんでした。{previewError}
              </div>
            )}
            <div className="preview-frame" ref={previewHost} />
          </div>
        </main>
      </div>

      <footer className="statusbar">
        <span className={`status-mode${readOnly ? ' status-readonly' : ''}`}>
          {readOnly
            ? '読み取り専用'
            : mode === 'edit'
              ? '編集モード：スクリプト無効'
              : 'プレビュー：スクリプト有効'}
        </span>
        <span>{encodingLabel(file.hasBom, file.source)}</span>
        {unmappable > 0 && <span>編集できないテキスト {unmappable}箇所</span>}
        <span className="statusbar-spacer" />
        {caret && <span className="status-caret">{caretLocation(caret)}</span>}
      </footer>

      {modal?.kind === 'save-error' && (
        <SaveErrorDialog
          error={modal.error}
          onClose={() => setModal(null)}
          onReveal={(path) => {
            setModal(null)
            setMode('edit')
            editorRef.current?.revealPath(path)
          }}
        />
      )}
      {modal?.kind === 'conflict' && (
        <Dialog
          icon={<RefreshIcon />}
          title="ファイルが別の場所で更新されています"
          onClose={() => setModal(null)}
          actions={[
            { label: 'キャンセル', onClick: () => setModal(null) },
            {
              label: '別名で保存',
              onClick: () => {
                setModal(null)
                void runSave(() => write(modal.prepared, true))
              },
            },
            {
              label: '上書きする',
              kind: 'danger',
              onClick: () => {
                setModal(null)
                void runSave(() => write(modal.prepared, false))
              },
            },
          ]}
        >
          <p>
            {`${file.name} は、開いた後に別のアプリで変更されました。このまま上書きすると、その変更は失われます。`}
          </p>
        </Dialog>
      )}
      {modal?.kind === 'message' && (
        <Dialog
          icon={<WarningIcon />}
          tone="warning"
          title={modal.message.title}
          onClose={() => setModal(null)}
          actions={[{ label: '閉じる', kind: 'primary', onClick: () => setModal(null) }]}
        >
          <p>{modal.message.body}</p>
        </Dialog>
      )}
      {toast && <Toast title={toast.title} body={toast.body} onDone={() => setToast(null)} />}
    </div>
  )
}

function SaveErrorDialog({
  error,
  onClose,
  onReveal,
}: {
  error: SaveError
  onClose: () => void
  onReveal: (path: string) => void
}): ReactElement {
  const message = saveErrorMessage(error)
  const [first, ...rest] = error.issues
  const revealable = first && first.path !== ROOT_PATH ? first.path : undefined
  return (
    <Dialog
      icon={<WarningIcon />}
      tone="warning"
      title={message.title}
      onClose={onClose}
      actions={[
        { label: '閉じる', onClick: onClose },
        ...(revealable
          ? [
              {
                label: '該当箇所を表示',
                kind: 'primary' as const,
                onClick: () => onReveal(revealable),
              },
            ]
          : []),
      ]}
    >
      <p>{message.body}</p>
      {first ? (
        <pre className="issue">
          {first.path}
          {'\n'}
          {describeIssue(first)}
          {rest.length > 0 && `\nほか ${rest.length}件`}
        </pre>
      ) : (
        <pre className="issue">{error.message}</pre>
      )}
    </Dialog>
  )
}
