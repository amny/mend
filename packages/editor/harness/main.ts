// Exposes the editor to Playwright as window.mendTest. Not part of the package.
import { decodeUtf8, encodeUtf8, parseDocument } from '@mend/core'
import { createEditor, type EditorState, type MendEditor, type Shortcut } from '../src'

export type SaveOutcome =
  | { readonly ok: true; readonly base64: string; readonly source: string }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly issues: number }

export interface MendTestApi {
  readonly open: (fixture: string) => Promise<EditorState>
  readonly openSource: (source: string) => Promise<EditorState>
  /** Opens `source` with a tree that lacks its last root child, so the DOM cannot match it. */
  readonly openMismatched: (source: string) => Promise<EditorState>
  readonly editor: () => MendEditor
  readonly state: () => EditorState
  /** Saves (prepare + commit). Returns the bytes as base64. */
  readonly save: (fault?: boolean) => SaveOutcome
  /** Places the selection inside the text node containing `needle` (offsets relative to `needle`). */
  readonly select: (needle: string, start: number, end?: number) => void
  /** Selects from `start` in the node containing `from` to `end` in the node containing `to`. */
  readonly selectAcross: (from: string, start: number, to: string, end: number) => void
  readonly shortcuts: Shortcut[]
}

declare global {
  interface Window {
    mendTest: MendTestApi
  }
}

const container = document.getElementById('editor')
if (!container) throw new Error('harness: #editor not found')

let current: MendEditor | undefined
let hasBom = false
const shortcuts: Shortcut[] = []

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

const mount = async (source: string, tamper = false): Promise<EditorState> => {
  current?.destroy()
  const doc = parseDocument(source)
  const editor = await createEditor({
    container,
    document: tamper
      ? { ...doc, tree: { ...doc.tree, children: doc.tree.children.slice(0, -1) } }
      : doc,
    onShortcut: (s) => shortcuts.push(s),
  })
  current = editor
  return editor.getState()
}

const editor = (): MendEditor => {
  if (!current) throw new Error('harness: no editor is open')
  return current
}

const frameDoc = (): Document => {
  const doc = container.querySelector('iframe')?.contentDocument
  if (!doc) throw new Error('harness: editing iframe is not accessible')
  return doc
}

const findText = (needle: string): { node: Text; at: number } => {
  const doc = frameDoc()
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text
    const at = text.data.indexOf(needle)
    if (at >= 0) return { node: text, at }
  }
  throw new Error(`harness: text not found: ${needle}`)
}

const selection = (): Selection => {
  const sel = frameDoc().getSelection()
  if (!sel) throw new Error('harness: no selection')
  return sel
}

window.mendTest = {
  open: async (fixture) => {
    const bytes = new Uint8Array(await (await fetch(`/fixtures/${fixture}`)).arrayBuffer())
    const decoded = decodeUtf8(bytes)
    if (!decoded.ok) throw new Error(`harness: ${fixture}: ${decoded.error.message}`)
    hasBom = decoded.hasBom
    return mount(decoded.source)
  },
  openSource: (source) => {
    hasBom = false
    return mount(source)
  },
  openMismatched: (source) => {
    hasBom = false
    return mount(source, true)
  },
  editor,
  state: () => editor().getState(),
  save: (fault = false) => {
    const prepared = editor().prepareSave(fault ? { fault: 'corrupt-structure' } : {})
    const { result } = prepared
    if (!result.ok) {
      return {
        ok: false,
        code: result.error.code,
        message: result.error.message,
        issues: result.error.issues.length,
      }
    }
    editor().commitSave(prepared)
    return { ok: true, base64: toBase64(encodeUtf8(result.source, hasBom)), source: result.source }
  },
  select: (needle, start, end) => {
    const { node, at } = findText(needle)
    selection().setBaseAndExtent(node, at + start, node, at + (end ?? start))
  },
  selectAcross: (from, start, to, end) => {
    const a = findText(from)
    const b = findText(to)
    selection().setBaseAndExtent(a.node, a.at + start, b.node, b.at + end)
  },
  shortcuts,
}
