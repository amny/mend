// The editing view: iframe display, structure guard, IME, undo/redo, change list, search and post-save resync.
// All side effects on the iframe live here; the decisions are made by the pure modules it imports.
import {
  normalizeEditedValue,
  prepareSave as coreSave,
  type MendDocument,
  type SaveOptions,
  type SaveResult,
  type SaveSuccess,
  type TextEdit,
  type TextRecord,
} from '@mend/core'
import {
  emptyHistory,
  filterEntries,
  isTextEntry,
  mapNodes as mapHistoryNodes,
  mapValues,
  record as recordEntry,
  redo as redoStep,
  undo as undoStep,
  type BreakEntry,
  type EntryKind,
  type History,
  type HistoryEntry,
  type TextEntry,
} from './history'
import { mapNodes, restoreVirtualTexts, type NodeMap } from './mapping'
import { createOverlay } from './overlay'
import { revertMutations } from './revert'
import { changedRange, findMatches, flattenLineBreaks } from './textRange'

export type ReadOnlyReason =
  /** The browser DOM did not match the parse (requirements 5.2). `detail` is the path and reason. */
  | { readonly code: 'mapping-mismatch'; readonly detail: string }
  /** The guard could not restore the structure after a blocked edit. */
  | { readonly code: 'guard-failed'; readonly detail: string }
  /** The node map could not be rebuilt after saving (the file itself was saved). */
  | { readonly code: 'resync-failed'; readonly detail: string }
  /** The iframe kept loading other documents, or the document could not be loaded again (requirements 5.1). */
  | { readonly code: 'navigated'; readonly detail: string }

export interface ChangeEntry {
  readonly recordId: number
  /** e.g. "1. 背景と目的 › .card › p" */
  readonly label: string
  readonly before: string
  /** The current text; new <br> line breaks appear as "\n". */
  readonly after: string
}

export interface SearchState {
  readonly query: string
  readonly count: number
  /** Index of the current match, -1 when there is none. */
  readonly current: number
}

export interface EditorState {
  readonly readOnly: ReadOnlyReason | null
  /** Unsaved changes in document order. */
  readonly changes: readonly ChangeEntry[]
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly search: SearchState
  /** Where the caret is: the element (e.g. "p.lead") and the record label, or null outside editable text. */
  readonly caret: { readonly element: string; readonly label: string } | null
}

export type Shortcut = 'save' | 'saveAs' | 'find'

export interface EditorOptions {
  /** The element the editor fills. It should have a size. */
  readonly container: HTMLElement
  readonly document: MendDocument
  /** Keyboard shortcuts pressed while the iframe has focus (its key events do not reach the parent page). */
  readonly onShortcut?: (shortcut: Shortcut) => void
}

/** The outcome of prepareSave. Pass it to commitSave after the file was written. */
export interface PreparedSave {
  readonly result: SaveResult
  /** The document the save was prepared from. */
  readonly document: MendDocument
  /** Record id -> DOM lines at the time of preparing (one line unless new <br>s were inserted). */
  readonly values: ReadonlyMap<number, readonly string[]>
  /** New <br>s and the line text nodes around them that this save writes into the source. */
  readonly lineBreaks: { readonly breaks: ReadonlySet<Element>; readonly texts: ReadonlySet<Text> }
}

export interface MendEditor {
  readonly getState: () => EditorState
  readonly subscribe: (listener: (state: EditorState) => void) => () => void
  /** The current source of truth (changes after each commitSave). */
  readonly getDocument: () => MendDocument
  readonly undo: () => void
  readonly redo: () => void
  /** E-06: puts one text node back to its saved value. Recorded in the undo history. */
  readonly revertChange: (recordId: number) => void
  /** E-06: scrolls to a changed text node and puts the caret at the change. */
  readonly revealChange: (recordId: number) => void
  /**
   * Scrolls to the element of a verification issue path (e.g. "section:nth-of-type(2) › table").
   * Returns false when the path does not resolve to an element.
   */
  readonly revealPath: (path: string) => boolean
  readonly find: (query: string) => void
  readonly findNext: () => void
  readonly findPrevious: () => void
  readonly clearFind: () => void
  /** Builds and verifies the new source. Nothing is changed until commitSave. */
  readonly prepareSave: (options?: SaveOptions) => PreparedSave
  /** Call after the verified source was written: syncs the DOM and history and rebuilds the node map (S-05). */
  readonly commitSave: (prepared: PreparedSave) => void
  readonly focus: () => void
  readonly destroy: () => void
}

type FrameWindow = Window & typeof globalThis

const NBSP = String.fromCodePoint(0xa0)
const HIGHLIGHT_CHANGED = 'mend-changed'
const HIGHLIGHT_SEARCH = 'mend-search'
const HIGHLIGHT_SEARCH_CURRENT = 'mend-search-current'
const HIGHLIGHT_CSS = `
::highlight(${HIGHLIGHT_CHANGED}) { background-color: rgba(255, 224, 138, 0.75); }
::highlight(${HIGHLIGHT_SEARCH}) { background-color: rgba(47, 163, 154, 0.25); }
::highlight(${HIGHLIGHT_SEARCH_CURRENT}) { background-color: rgba(47, 163, 154, 0.6); }
`

/** Input types that would change the structure (E-02). */
const BLOCKED_INPUT_TYPES = new Set([
  'insertParagraph',
  'insertLineBreak',
  'insertOrderedList',
  'insertUnorderedList',
  'insertHorizontalRule',
  'insertLink',
  'insertFromDrop',
  'insertFromYank',
  'insertTranspose',
  'deleteByDrag',
])

/** Text inside these elements is not searched (not rendered as text). */
const UNSEARCHED = new Set(['head', 'script', 'style', 'template', 'textarea', 'title'])

/** More reloads than this within RELOAD_WINDOW_MS stop editing instead of reloading forever. */
const MAX_RELOADS = 3
const RELOAD_WINDOW_MS = 10_000

const OBSERVE_OPTIONS: MutationObserverInit = {
  subtree: true,
  childList: true,
  characterData: true,
  characterDataOldValue: true,
  attributes: true,
  attributeOldValue: true,
}

const isText = (n: Node | null | undefined): n is Text => n?.nodeType === Node.TEXT_NODE
const ZWSP = String.fromCodePoint(0x200b)

const sameLines = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
  a !== undefined && a.length === b.length && a.every((line, i) => line === b[i])

/** Deletions that join two lines when the caret is at the start (Backward) or end (Forward) of a line. */
const JOINING_DELETES = new Set([
  'deleteContentBackward',
  'deleteWordBackward',
  'deleteSoftLineBackward',
  'deleteHardLineBackward',
  'deleteContentForward',
  'deleteWordForward',
  'deleteSoftLineForward',
  'deleteHardLineForward',
])

type Entry = HistoryEntry<Text, Element>

const htmlBlobUrl = (source: string): string =>
  URL.createObjectURL(new Blob([source], { type: 'text/html;charset=utf-8' }))

function loadFrame(frame: HTMLIFrameElement, url: string): Promise<void> {
  return new Promise((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true })
    frame.src = url
  })
}

export async function createEditor(options: EditorOptions): Promise<MendEditor> {
  const { container, onShortcut } = options
  const host = container.ownerDocument

  // --- Display: blob URL + sandbox without scripts (CLAUDE.md, spikes/README.md) ---
  const wrapper = host.createElement('div')
  Object.assign(wrapper.style, { position: 'relative', width: '100%', height: '100%' })
  const frame = host.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.title = 'Mend editing view'
  Object.assign(frame.style, { border: '0', width: '100%', height: '100%', display: 'block' })
  const layer = host.createElement('div')
  Object.assign(layer.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    overflow: 'hidden',
  })
  wrapper.append(frame, layer)
  container.append(wrapper)
  const overlay = createOverlay(layer, frame)

  let frameUrl = htmlBlobUrl(options.document.source)
  await loadFrame(frame, frameUrl)
  const loadedDoc = frame.contentDocument
  const loadedWin = frame.contentWindow as FrameWindow | null
  if (!loadedDoc || !loadedWin) {
    throw new Error('Mend: the editing iframe is not accessible (sandbox must allow same origin)')
  }
  // Replaced only when the iframe navigated and the document was loaded again (reload()).
  let doc: Document = loadedDoc
  let win: FrameWindow = loadedWin

  // --- State (mutable only inside this closure) ---
  let mend = options.document
  let map: NodeMap = { recordOf: new Map(), nodeOf: [], linesOf: new Map() }
  let history: History<Text, Element> = emptyHistory()
  /** <br> elements this editor inserted (Shift+Enter) that are not in the source of truth yet. */
  let newBreaks = new Set<Element>()
  let readOnly: ReadOnlyReason | null = null
  /** Record ids whose node may differ from the record value. */
  let touched = new Set<number>()
  let composing = false
  let compositionBuffer: MutationRecord[] = []
  let pendingKind: EntryKind = 'typing'
  let lastCaret: { readonly node: Text; readonly offset: number } | undefined
  let caretNode: Text | undefined
  let searchQuery = ''
  let searchRanges: Range[] = []
  let searchCurrent = -1
  let state: EditorState
  let reloading = false
  let destroyed = false
  let recentReloads: readonly number[] = []
  /** Last known white-space mode per node, for saving while the document is being loaded again. */
  const preformattedCache = new WeakMap<Text, boolean>()
  const listeners = new Set<(s: EditorState) => void>()
  /** Cleanups of the editor itself. */
  const cleanups: (() => void)[] = []
  /** Cleanups of the current document (listeners, observer); run when it is replaced. */
  const docCleanups: (() => void)[] = []

  const on = <K extends keyof DocumentEventMap>(
    type: K,
    handler: (e: DocumentEventMap[K]) => void,
    capture = true,
  ): void => {
    const target = doc
    target.addEventListener(type, handler, capture)
    docCleanups.push(() => target.removeEventListener(type, handler, capture))
  }

  const isNewBreak = (n: Node): boolean => newBreaks.has(n as Element)
  /** The text nodes of a record: its lines when split by new <br>s, else the one node. */
  const linesOfRecord = (id: number): readonly Text[] => {
    const lines = map.linesOf.get(id)
    if (lines) return lines
    const node = map.nodeOf[id]
    return node ? [node] : []
  }
  /**
   * Empty lines after a <br> hold one U+200B in the DOM only (never saved, never in values): without it the line has
   * no rendered position, and Chrome puts the caret and typed text before the <br>.
   */
  const placeholders = new WeakSet<Text>()
  /** The text of a node as the user sees it (without the placeholder). */
  const textValue = (t: Text): string => (placeholders.has(t) ? '' : t.data)
  /** Writes a value, using the placeholder for an empty line after a <br>. */
  const writeText = (t: Text, value: string): void => {
    if (value === '' && t.previousSibling?.nodeName === 'BR') {
      t.data = ZWSP
      placeholders.add(t)
    } else {
      t.data = value
      placeholders.delete(t)
    }
  }
  /** Removes the placeholder after the user typed into the line (keeps the caret on the typed text). */
  const settlePlaceholder = (t: Text): void => {
    if (!placeholders.has(t) || t.data === ZWSP) return
    placeholders.delete(t)
    const at = t.data.indexOf(ZWSP)
    if (at < 0) return
    const sel = selection()
    const offset = sel?.focusNode === t ? sel.focusOffset : undefined
    t.data = t.data.slice(0, at) + t.data.slice(at + 1)
    if (offset !== undefined) sel?.collapse(t, offset > at ? offset - 1 : offset)
  }
  /** `value` of a node with [start, end) replaced by `insert`, offsets in DOM data. */
  const splice = (t: Text, start: number, end: number, insert: string): string =>
    placeholders.has(t) ? insert : t.data.slice(0, start) + insert + t.data.slice(end)
  const valueOf = (id: number): string[] => linesOfRecord(id).map(textValue)
  const isChanged = (lines: readonly string[], rec: TextRecord): boolean =>
    lines.length !== 1 || lines[0] !== rec.value

  const recordOfNode = (n: Node | null | undefined): TextRecord | undefined => {
    if (!isText(n)) return undefined
    const id = map.recordOf.get(n)
    return id === undefined ? undefined : mend.records[id]
  }
  const isEditableText = (n: Node | null | undefined): n is Text =>
    readOnly === null && recordOfNode(n)?.status === 'editable'

  const isPreformatted = (node: Text): boolean => {
    // A node of a document that was navigated away has no computed style: use what was seen before.
    if (node.ownerDocument !== doc) {
      return preformattedCache.get(node) ?? recordOfNode(node)?.preformatted ?? false
    }
    const el = node.parentElement
    if (!el) return false
    const style = win.getComputedStyle(el)
    const collapse = style.getPropertyValue('white-space-collapse')
    const pre = collapse
      ? collapse === 'preserve' || collapse === 'break-spaces'
      : ['pre', 'pre-wrap', 'break-spaces'].includes(style.getPropertyValue('white-space'))
    preformattedCache.set(node, pre)
    return pre
  }

  /** Elements whose line breaks are rendered (pre, pre-wrap, pre-line, break-spaces): Enter inserts "\n" there. */
  const keepsLineBreaks = (node: Text): boolean => {
    const el = node.parentElement
    if (!el || node.ownerDocument !== doc) return recordOfNode(node)?.preformatted ?? false
    const style = win.getComputedStyle(el)
    const collapse = style.getPropertyValue('white-space-collapse')
    if (collapse) return ['preserve', 'preserve-breaks', 'break-spaces'].includes(collapse)
    return ['pre', 'pre-wrap', 'pre-line', 'break-spaces'].includes(
      style.getPropertyValue('white-space'),
    )
  }

  /** The editable text node holding the whole selection, or undefined. */
  const selectedText = (): Text | undefined => {
    const sel = selection()
    if (!sel || sel.rangeCount === 0) return undefined
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    return node === range.endContainer && isEditableText(node) ? node : undefined
  }

  // --- Selection helpers ---
  const selection = (): Selection | null => doc.getSelection()
  const setCaret = (node: Text, offset: number): void => {
    const sel = selection()
    if (!sel || !node.isConnected) return
    sel.collapse(node, Math.min(offset, node.data.length))
    lastCaret = { node, offset }
  }
  /** Sets node.data while keeping a selection inside the node at the same offsets. */
  const setDataKeepingSelection = (node: Text, value: string): void => {
    const sel = selection()
    const anchor = sel?.anchorNode === node ? sel.anchorOffset : undefined
    const focusOffset = sel?.focusNode === node ? sel.focusOffset : undefined
    node.data = value
    if (sel && anchor !== undefined && focusOffset !== undefined) {
      sel.setBaseAndExtent(
        node,
        Math.min(anchor, value.length),
        node,
        Math.min(focusOffset, value.length),
      )
    }
  }

  // --- Mutation guard (requirements 5.4, step 2) ---
  function onMutations(records: MutationRecord[]): void {
    if (composing) compositionBuffer.push(...records)
    else processRecords(records, pendingKind)
  }
  // Recreated for each loaded document (attachDocument).
  let observer = new win.MutationObserver(onMutations)
  /** Drops records caused by our own changes. Callers flush pending user records first. */
  const discardOwnRecords = (): void => {
    observer.takeRecords()
  }

  const markTouched = (node: Text): void => {
    const id = map.recordOf.get(node)
    if (id !== undefined) touched.add(id)
  }

  const pushHistory = (node: Text, before: string, after: string, kind: EntryKind): void => {
    history = recordEntry(history, { node, before, after, kind, time: Date.now() })
    markTouched(node)
  }

  /** Rebuilds the node map after the editor changed the structure itself (new <br>s). */
  const remap = (): void => {
    const next = mapNodes(doc, mend, false, isNewBreak)
    if (next.ok) {
      map = next.map
      return
    }
    setReadOnly({
      code: 'guard-failed',
      detail: `${next.mismatch.reason} at ${next.mismatch.path}`,
    })
  }

  function processRecords(records: readonly MutationRecord[], kind: EntryKind): void {
    pendingKind = 'typing'
    if (records.length === 0) return
    const before = new Map<Text, string>()
    const rejected: MutationRecord[] = []
    const newTexts: { node: Text; prev: Node | null; next: Node | null }[] = []
    const sel = selection()
    const focus = sel?.focusNode ?? null
    const focusOffset = sel?.focusOffset ?? 0

    let settled = false
    for (const r of records) {
      if (r.type === 'characterData' && isEditableText(r.target)) {
        const target = r.target
        const wasPlaceholder = placeholders.has(target)
        if (!before.has(target)) before.set(target, wasPlaceholder ? '' : (r.oldValue ?? ''))
        if (wasPlaceholder && !composing) {
          settlePlaceholder(target)
          settled = true
        }
        continue
      }
      rejected.push(r)
      if (r.type === 'childList') {
        r.addedNodes.forEach((n) => {
          if (isText(n) && n.parentNode === r.target && !map.recordOf.has(n)) {
            newTexts.push({ node: n, prev: n.previousSibling, next: n.nextSibling })
          }
        })
      }
    }

    if (settled) discardOwnRecords()
    let caret: { node: Text; offset: number } | undefined
    if (rejected.length > 0) {
      // Text typed at an element boundary lands in a new text node: keep it by merging it into its neighbour.
      const typed = newTexts.map((t) => ({ ...t, data: t.node.data }))
      revertMutations(rejected)
      for (const t of typed) {
        if (t.data === '') continue
        const target = isEditableText(t.prev) ? t.prev : isEditableText(t.next) ? t.next : undefined
        if (!target) continue
        const current = textValue(target)
        if (!before.has(target)) before.set(target, current)
        const atEnd = target === t.prev
        const offset = atEnd ? current.length : 0
        writeText(target, atEnd ? current + t.data : t.data + current)
        if (focus === t.node) caret = { node: target, offset: offset + focusOffset }
      }
      discardOwnRecords()
      // Make sure the guard really restored the structure; otherwise stop editing (requirements 6.1).
      const check = mapNodes(doc, mend, false, isNewBreak)
      if (!check.ok) {
        setReadOnly({
          code: 'guard-failed',
          detail: `${check.mismatch.reason} at ${check.mismatch.path}`,
        })
      } else {
        map = check.map
        const restore =
          caret ??
          (isEditableText(focus) ? { node: focus, offset: focusOffset } : undefined) ??
          lastCaret
        if (restore) setCaret(restore.node, restore.offset)
      }
    }

    for (const [node, value] of before) {
      if (textValue(node) !== value) pushHistory(node, value, textValue(node), kind)
    }
    emit()
  }

  /** Flushes user mutations not yet seen by the observer callback (never during IME composition). */
  const flush = (): void => {
    if (!composing) processRecords(observer.takeRecords(), pendingKind)
  }

  /** A programmatic change of one text node, recorded in the history. */
  const change = (node: Text, value: string, kind: EntryKind, caretOffset: number): void => {
    flush()
    const old = textValue(node)
    if (old === value) return
    writeText(node, value)
    discardOwnRecords()
    pushHistory(node, old, value, kind)
    setCaret(node, caretOffset)
    emit()
  }

  /** Inserts (`insert`) or removes the <br> of a break entry, with the texts on both sides. */
  const applyBreak = (e: BreakEntry<Text, Element>, insert: boolean): void => {
    if (insert) {
      e.left.after(e.br, e.right)
      writeText(e.left, e.leftText)
      writeText(e.right, e.rightText)
      newBreaks.add(e.br)
    } else {
      e.br.remove()
      e.right.remove()
      writeText(e.left, e.leftText + e.rightText)
    }
    discardOwnRecords()
    markTouched(e.left)
    remap()
    if (insert) setCaret(e.right, 0)
    else setCaret(e.left, e.leftText.length)
  }

  const applyText = (e: TextEntry<Text>, forward: boolean): void => {
    const [from, to] = forward ? [e.before, e.after] : [e.after, e.before]
    writeText(e.node, to)
    discardOwnRecords()
    markTouched(e.node)
    setCaret(e.node, changedRange(from, to).endAfter)
  }

  /** Applies an entry forwards (redo) or backwards (undo). */
  const applyEntry = (e: Entry, forward: boolean): void => {
    if (e.kind === 'group') {
      const parts = forward ? e.entries : [...e.entries].reverse()
      parts.forEach((part) => applyEntry(part, forward))
      return
    }
    if (isTextEntry(e)) applyText(e, forward)
    else applyBreak(e, forward === e.inserted)
    const focus = selection()?.focusNode
    const el = focus?.nodeType === Node.ELEMENT_NODE ? (focus as Element) : focus?.parentElement
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  /** Records an entry (already applied by the caller) and updates the state. */
  const commit = (e: Entry): void => {
    history = recordEntry(history, e)
    emit()
  }

  const undo = (): void => {
    if (composing) return
    flush()
    const step = undoStep(history)
    if (!step) return
    history = step.history
    applyEntry(step.entry, false)
    emit()
  }

  const redo = (): void => {
    if (composing) return
    flush()
    const step = redoStep(history)
    if (!step) return
    history = step.history
    applyEntry(step.entry, true)
    emit()
  }

  // --- New <br> line breaks (Shift+Enter outside preformatted text) ---
  /** Splits the selected text node at the caret with a new <br> (the selection is deleted first). */
  const insertBreak = (): void => {
    flush()
    const sel = selection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node !== range.endContainer || !isEditableText(node)) return
    const offset = placeholders.has(node) ? 0 : range.startOffset
    if (!range.collapsed) change(node, splice(node, offset, range.endOffset, ''), 'typing', offset)
    const text = textValue(node)
    const entry: BreakEntry<Text, Element> = {
      kind: 'break',
      inserted: true,
      left: node,
      br: doc.createElement('br'),
      right: doc.createTextNode(''),
      leftText: text.slice(0, offset),
      rightText: text.slice(offset),
      time: Date.now(),
    }
    applyBreak(entry, true)
    commit(entry)
  }

  /** The caret as a text position, also when Chrome reports it as a position between nodes. */
  const caretInText = (backward: boolean): { node: Text; offset: number } | undefined => {
    const sel = selection()
    if (!sel || !sel.isCollapsed || !sel.focusNode) return undefined
    const { focusNode, focusOffset } = sel
    if (isText(focusNode)) {
      return { node: focusNode, offset: placeholders.has(focusNode) ? 0 : focusOffset }
    }
    const after = focusNode.childNodes[focusOffset]
    const before = focusNode.childNodes[focusOffset - 1]
    if (backward && isText(after)) return { node: after, offset: 0 }
    if (!backward && isText(before)) return { node: before, offset: textValue(before).length }
    return undefined
  }

  /** Backspace at the start of a line / Delete at its end removes the new <br> between the lines. */
  const joinLines = (backward: boolean): boolean => {
    const caret = caretInText(backward)
    if (!caret || !isEditableText(caret.node)) return false
    const id = map.recordOf.get(caret.node)
    const lines = id === undefined ? undefined : map.linesOf.get(id)
    if (!lines) return false
    const i = lines.indexOf(caret.node)
    const pair: readonly [Text | undefined, Text | undefined] | undefined =
      backward && caret.offset === 0 && i > 0
        ? [lines[i - 1], caret.node]
        : !backward && caret.offset === textValue(caret.node).length && i < lines.length - 1
          ? [caret.node, lines[i + 1]]
          : undefined
    const [left, right] = pair ?? []
    const br = right?.previousSibling
    if (!left || !right || !br || !isNewBreak(br)) return false
    flush()
    const entry: BreakEntry<Text, Element> = {
      kind: 'break',
      inserted: false,
      left,
      br: br as Element,
      right,
      leftText: textValue(left),
      rightText: textValue(right),
      time: Date.now(),
    }
    applyBreak(entry, false)
    commit(entry)
    return true
  }

  // --- Pre-input guard (requirements 5.4, step 1) ---
  const onBeforeInput = (e: InputEvent): void => {
    const type = e.inputType
    if (type === 'historyUndo' || type === 'historyRedo') {
      e.preventDefault()
      if (type === 'historyUndo') undo()
      else redo()
      return
    }
    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      // A line break is plain text where line breaks are rendered; elsewhere it would split the element.
      e.preventDefault()
      const node = readOnly === null ? selectedText() : undefined
      if (!node) return
      if (keepsLineBreaks(node)) insertPlainText('\n', 'typing')
      // Elsewhere only Shift+Enter, as a new <br>; Enter (a new paragraph) stays blocked (E-02).
      else if (type === 'insertLineBreak') insertBreak()
      return
    }
    if (readOnly !== null || BLOCKED_INPUT_TYPES.has(type) || type.startsWith('format')) {
      e.preventDefault()
      return
    }
    if (type === 'insertFromPaste' || type === 'insertFromPasteAsQuotation') {
      e.preventDefault()
      const text = e.dataTransfer?.getData('text/plain') ?? ''
      const node = selectedText()
      insertPlainText(
        node && keepsLineBreaks(node) ? text.replace(/\r\n?/g, '\n') : flattenLineBreaks(text),
        'paste',
      )
      return
    }
    const ranges = e.getTargetRanges()
    const range = ranges.length === 1 ? ranges[0] : undefined
    const inOneEditableNode =
      range !== undefined &&
      range.startContainer === range.endContainer &&
      isEditableText(range.startContainer)

    if (type.startsWith('delete')) {
      if (JOINING_DELETES.has(type) && joinLines(type.endsWith('Backward'))) {
        e.preventDefault()
        return
      }
      if (!range || !inOneEditableNode) {
        e.preventDefault()
        return
      }
      const node = range.startContainer as Text
      // An empty line: nothing to delete (only the placeholder is there).
      if (placeholders.has(node)) {
        e.preventDefault()
        return
      }
      // Chrome would remove an emptied text node and insert <br>; empty it ourselves instead (AC-06).
      if (range.startOffset === 0 && range.endOffset >= node.data.length && node.data !== '') {
        e.preventDefault()
        change(node, '', 'typing', 0)
      }
      return
    }

    // insertText, insertReplacementText, insertCompositionText, ...
    if (range && !range.collapsed) {
      if (!inOneEditableNode) {
        // Composition cannot be cancelled; the mutation guard reverts it afterwards.
        if (e.cancelable) e.preventDefault()
        return
      }
      if (e.cancelable && e.data !== null) {
        // Replacing a selection: do it ourselves so Chrome never removes the node.
        e.preventDefault()
        const node = range.startContainer as Text
        const start = placeholders.has(node) ? 0 : range.startOffset
        const value = splice(node, range.startOffset, range.endOffset, e.data)
        change(node, value, 'typing', start + e.data.length)
      }
    }
  }

  const insertPlainText = (text: string, kind: EntryKind): void => {
    const sel = selection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node !== range.endContainer || !isEditableText(node)) return
    const value = splice(node, range.startOffset, range.endOffset, text)
    const start = placeholders.has(node) ? 0 : range.startOffset
    change(node, value, kind, start + text.length)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.isComposing || !(e.ctrlKey || e.metaKey) || e.altKey) return
    const key = e.key.toLowerCase()
    if (key === 'z' || key === 'y') {
      e.preventDefault()
      if (key === 'z' && !e.shiftKey) undo()
      else redo()
    } else if (key === 's') {
      e.preventDefault()
      onShortcut?.(e.shiftKey ? 'saveAs' : 'save')
    } else if (key === 'f') {
      e.preventDefault()
      onShortcut?.('find')
    } else if (key === 'b' || key === 'i' || key === 'u') {
      e.preventDefault()
    }
  }

  const onCompositionStart = (): void => {
    flush()
    composing = true
  }
  const onCompositionEnd = (): void => {
    composing = false
    const records = [...compositionBuffer, ...observer.takeRecords()]
    compositionBuffer = []
    processRecords(records, 'ime')
  }

  const onSelectionChange = (): void => {
    const sel = selection()
    const focus = sel?.focusNode
    const editable = isEditableText(focus) ? focus : undefined
    if (sel && editable) lastCaret = { node: editable, offset: sel.focusOffset }
    if (editable !== caretNode) {
      caretNode = editable
      emit(false)
    }
  }

  const preventDefault = (e: Event): void => e.preventDefault()

  // --- Hover frame (V-03) ---
  const hoverTarget = (x: number, y: number): Element | undefined => {
    const pos = doc.caretPositionFromPoint(x, y)
    const node = pos?.offsetNode
    if (!isEditableText(node) || node.data === '') return undefined
    const range = doc.createRange()
    range.selectNodeContents(node)
    const inside = Array.from(range.getClientRects()).some(
      (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
    )
    return inside ? (node.parentElement ?? undefined) : undefined
  }
  const elementLabel = (el: Element): string => {
    const cls = el.classList[0]
    return cls ? `${el.localName}.${cls}` : el.localName
  }
  const onMouseMove = (e: MouseEvent): void => {
    const el = hoverTarget(e.clientX, e.clientY)
    if (el) overlay.show(el.getBoundingClientRect(), elementLabel(el))
    else overlay.hide()
  }

  // --- Highlights (V-04): Highlight API + adoptedStyleSheets (attachDocument), no DOM nodes added ---
  const updateHighlights = (changes: readonly ChangeEntry[]): void => {
    // While the document is being loaded again, the old one is no longer displayed.
    if (frame.contentDocument !== doc) return
    const ranges = changes.flatMap((c) => {
      const lines = map.linesOf.get(c.recordId)
      if (lines) {
        // Split by new <br>s: every line is part of the change.
        return lines.flatMap((line) => {
          if (textValue(line) === '' || line.ownerDocument !== doc) return []
          const range = doc.createRange()
          range.selectNodeContents(line)
          return [range]
        })
      }
      const node = map.nodeOf[c.recordId]
      if (!node || textValue(node) === '' || node.ownerDocument !== doc) return []
      const r = changedRange(c.before, c.after)
      const range = doc.createRange()
      if (r.endAfter > r.start) {
        range.setStart(node, r.start)
        range.setEnd(node, r.endAfter)
      } else {
        range.selectNodeContents(node)
      }
      return [range]
    })
    win.CSS.highlights.set(HIGHLIGHT_CHANGED, new win.Highlight(...ranges))
    const current = searchRanges[searchCurrent]
    win.CSS.highlights.set(
      HIGHLIGHT_SEARCH,
      new win.Highlight(...searchRanges.filter((r) => r !== current)),
    )
    win.CSS.highlights.set(
      HIGHLIGHT_SEARCH_CURRENT,
      new win.Highlight(...(current ? [current] : [])),
    )
  }

  // --- Search (E-05) ---
  const searchableTexts = (): Text[] => {
    const root = doc.body ?? doc.documentElement
    if (!root) return []
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.nodeType === Node.ELEMENT_NODE
          ? UNSEARCHED.has((n as Element).localName)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP
          : NodeFilter.FILTER_ACCEPT,
    })
    const texts: Text[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (isText(n)) texts.push(n)
    }
    return texts
  }

  const runSearch = (): void => {
    if (searchQuery === '') {
      searchRanges = []
      searchCurrent = -1
      return
    }
    const texts = searchableTexts()
    searchRanges = findMatches(texts.map(textValue), searchQuery).flatMap((m) => {
      const start = texts[m.startNode]
      const end = texts[m.endNode]
      if (!start || !end) return []
      const range = doc.createRange()
      range.setStart(start, m.startOffset)
      range.setEnd(end, m.endOffset)
      return [range]
    })
    searchCurrent =
      searchRanges.length === 0 ? -1 : Math.min(Math.max(searchCurrent, 0), searchRanges.length - 1)
  }

  const scrollToRange = (range: Range): void => {
    const el =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement
    el?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }

  const moveSearch = (delta: number): void => {
    if (searchRanges.length === 0) return
    searchCurrent = (searchCurrent + delta + searchRanges.length) % searchRanges.length
    const range = searchRanges[searchCurrent]
    if (range) scrollToRange(range)
    emit(false)
  }

  // --- State ---
  const computeChanges = (): ChangeEntry[] => {
    const changes: ChangeEntry[] = []
    const stillTouched = new Set<number>()
    for (const id of [...touched].sort((a, b) => a - b)) {
      const lines = valueOf(id)
      const rec = mend.records[id]
      if (lines.length === 0 || !rec || !isChanged(lines, rec)) continue
      stillTouched.add(id)
      changes.push({ recordId: id, label: rec.label, before: rec.value, after: lines.join('\n') })
    }
    touched = stillTouched
    return changes
  }

  const caretInfo = (): EditorState['caret'] => {
    const rec = recordOfNode(caretNode)
    const el = caretNode?.parentElement
    return rec && el ? { element: elementLabel(el), label: rec.label } : null
  }

  /** Recomputes the state and notifies listeners. `research` re-runs the search (text may have moved). */
  function emit(research = true): void {
    if (research) runSearch()
    const changes = computeChanges()
    state = {
      readOnly,
      changes,
      canUndo: history.undo.length > 0,
      canRedo: history.redo.length > 0,
      search: { query: searchQuery, count: searchRanges.length, current: searchCurrent },
      caret: caretInfo(),
    }
    updateHighlights(changes)
    listeners.forEach((l) => l(state))
  }

  function setReadOnly(reason: ReadOnlyReason): void {
    readOnly = reason
    doc.designMode = 'off'
    overlay.hide()
    console.warn(`Mend: editing disabled (${reason.code}): ${reason.detail}`)
  }

  /** Observer, event listeners and the highlight style sheet for the current document. */
  function attachDocument(): void {
    const target = doc
    const targetWin = win
    observer = new targetWin.MutationObserver(onMutations)
    const current = observer
    current.observe(target, OBSERVE_OPTIONS)
    docCleanups.push(() => current.disconnect())
    on('beforeinput', onBeforeInput)
    on('keydown', onKeyDown)
    on('compositionstart', onCompositionStart)
    on('compositionend', onCompositionEnd)
    on('selectionchange', onSelectionChange)
    on('dragstart', preventDefault)
    on('dragover', preventDefault)
    on('drop', preventDefault)
    on('mousemove', onMouseMove, false)
    on('mouseleave', () => overlay.hide(), false)
    targetWin.addEventListener('scroll', overlay.hide)
    docCleanups.push(() => targetWin.removeEventListener('scroll', overlay.hide))
    const sheet = new targetWin.CSSStyleSheet()
    sheet.replaceSync(HIGHLIGHT_CSS)
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet]
  }

  const detachDocument = (): void => {
    docCleanups.splice(0).forEach((c) => c())
  }

  /** Stops editing after a navigation that could not be undone by loading the document again. */
  const stopAfterNavigation = (detail: string): void => {
    reloading = false
    readOnly = { code: 'navigated', detail }
    console.warn(`Mend: editing disabled (navigated): ${detail}`)
    overlay.hide()
    emit()
  }

  // --- Unexpected navigation (requirements 5.1): load the document again and carry the edits over ---
  // Chrome does not follow <meta http-equiv="refresh"> in a sandbox without allow-scripts, so this is a safety net.
  // Until the new document is ready, the old (navigated-away) document stays the editor's document: its text nodes
  // still hold the edits, so saving and undo keep working in the meantime.
  async function reload(): Promise<void> {
    const now = Date.now()
    recentReloads = [...recentReloads.filter((t) => now - t < RELOAD_WINDOW_MS), now]
    if (recentReloads.length > MAX_RELOADS) {
      stopAfterNavigation(
        `the editing iframe navigated ${recentReloads.length} times within ${RELOAD_WINDOW_MS} ms`,
      )
      return
    }
    console.warn('Mend: the editing iframe navigated; loading the document again')
    reloading = true
    overlay.hide()
    emit(false)
    // A save may finish while loading; then load its source instead.
    let source: string
    do {
      source = mend.source
      const url = htmlBlobUrl(source)
      URL.revokeObjectURL(frameUrl)
      frameUrl = url
      await loadFrame(frame, url)
      if (destroyed) return
    } while (source !== mend.source)
    finishReload()
  }

  function finishReload(): void {
    const nextDoc = frame.contentDocument
    const nextWin = frame.contentWindow as FrameWindow | null
    if (!nextDoc || !nextWin) {
      stopAfterNavigation('the document loaded again is not accessible')
      return
    }
    // Settle pending input on the old document before leaving it.
    if (composing) {
      composing = false
      const records = [...compositionBuffer, ...observer.takeRecords()]
      compositionBuffer = []
      processRecords(records, 'ime')
    } else {
      flush()
    }
    const oldMap = map
    const wasReadOnly = readOnly !== null
    detachDocument()
    doc = nextDoc
    win = nextWin
    reloading = false
    lastCaret = undefined
    caretNode = undefined
    if (wasReadOnly) {
      // Show the document again but keep editing off; the old nodes still hold the values for saving.
      attachDocument()
      emit()
      return
    }

    restoreVirtualTexts(doc, mend)
    const fresh = mapNodes(doc, mend, true)
    if (!fresh.ok) {
      attachDocument()
      stopAfterNavigation(
        `the document loaded again does not match: ${fresh.mismatch.reason} at ${fresh.mismatch.path}`,
      )
      return
    }
    // Carry the unsaved values and new <br>s over (written before the observer is attached, so no records are made).
    const textMap = new Map<Text, Text>()
    const brMap = new Map<Element, Element>()
    const oldBreaks = newBreaks
    newBreaks = new Set()
    for (let id = 0; id < mend.records.length; id++) {
      const from = oldMap.linesOf.get(id) ?? [oldMap.nodeOf[id]]
      const anchor = fresh.map.nodeOf[id]
      const first = from[0]
      if (touched.has(id) && (!first || !anchor)) {
        attachDocument()
        stopAfterNavigation(`record ${id} has no text node after loading the document again`)
        return
      }
      if (!first || !anchor) continue
      textMap.set(first, anchor)
      if (touched.has(id)) writeText(anchor, textValue(first))
      let last: Text = anchor
      for (const line of from.slice(1)) {
        const oldBr = line?.previousSibling
        if (!line || !oldBr || !oldBreaks.has(oldBr as Element)) continue
        const br = doc.createElement('br')
        const text = doc.createTextNode('')
        last.after(br, text)
        writeText(text, textValue(line))
        newBreaks.add(br)
        brMap.set(oldBr as Element, br)
        textMap.set(line, text)
        last = text
      }
    }
    const next = mapNodes(doc, mend, false, isNewBreak)
    if (!next.ok) {
      attachDocument()
      stopAfterNavigation(
        `the edits could not be carried over: ${next.mismatch.reason} at ${next.mismatch.path}`,
      )
      return
    }
    const moved = mapHistoryNodes(
      history,
      (node) => textMap.get(node),
      (br) => brMap.get(br),
    )
    if (!moved) console.warn('Mend: cleared the undo history: a node was not found after reloading')
    history = moved ?? emptyHistory()
    map = next.map
    attachDocument()
    doc.designMode = 'on'
    emit()
  }

  // --- Start ---
  const initial = mapNodes(doc, mend, true)
  if (initial.ok) {
    map = initial.map
    doc.designMode = 'on'
  } else {
    readOnly = {
      code: 'mapping-mismatch',
      detail: `${initial.mismatch.reason} at ${initial.mismatch.path}`,
    }
    console.warn(`Mend: opened read-only: ${readOnly.detail}`)
  }
  attachDocument()
  const onLoad = (): void => {
    if (reloading || destroyed || frame.contentDocument === doc) return
    if (readOnly?.code === 'navigated') return
    reload().catch((error: unknown) => {
      console.error('Mend: could not load the document again', error)
      stopAfterNavigation(`loading the document again failed: ${String(error)}`)
    })
  }
  frame.addEventListener('load', onLoad)
  cleanups.push(() => frame.removeEventListener('load', onLoad))
  emit()

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getDocument: () => mend,
    undo,
    redo,
    revertChange: (recordId) => {
      const node = map.nodeOf[recordId]
      const rec = mend.records[recordId]
      if (!node || !rec || readOnly !== null) return
      const lines = map.linesOf.get(recordId)
      if (!lines) {
        const r = changedRange(textValue(node), rec.value)
        change(node, rec.value, 'revert', r.endAfter)
        return
      }
      // Join the lines from the last one, then put the text back: one undo step.
      flush()
      const datas = lines.map(textValue)
      const parts: (TextEntry<Text> | BreakEntry<Text, Element>)[] = []
      for (let i = lines.length - 1; i > 0; i--) {
        const left = lines[i - 1]
        const right = lines[i]
        const br = right?.previousSibling
        if (!left || !right || !br || !isNewBreak(br)) return
        parts.push({
          kind: 'break',
          inserted: false,
          left,
          br: br as Element,
          right,
          leftText: datas[i - 1] ?? '',
          rightText: datas[i] ?? '',
          time: Date.now(),
        })
        datas[i - 1] = (datas[i - 1] ?? '') + (datas[i] ?? '')
      }
      parts.push({
        node,
        before: datas[0] ?? '',
        after: rec.value,
        kind: 'revert',
        time: Date.now(),
      })
      const entry: Entry = { kind: 'group', entries: parts, time: Date.now() }
      applyEntry(entry, true)
      commit(entry)
    },
    revealPath: (path) => {
      const steps = path.split(' › ')
      if (steps.length === 0 || steps.some((s) => !/^[a-z][\w-]*(:nth-of-type\(\d+\))?$/.test(s))) {
        return false
      }
      // Verification paths omit <html> and <body> (packages/core/src/verify.ts).
      const prefix = steps[0] === 'head' ? ':root > ' : 'body > '
      const el = doc.querySelector(prefix + steps.join(' > '))
      if (!el) return false
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      // After the scroll event (which hides the frame) has been dispatched.
      host.defaultView?.requestAnimationFrame(() =>
        overlay.show(el.getBoundingClientRect(), elementLabel(el)),
      )
      return true
    },
    revealChange: (recordId) => {
      const node = map.nodeOf[recordId]
      const rec = mend.records[recordId]
      if (!node || !rec) return
      node.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' })
      win.focus()
      if (map.linesOf.has(recordId)) setCaret(node, textValue(node).length)
      else setCaret(node, changedRange(rec.value, textValue(node)).endAfter)
    },
    find: (query) => {
      searchQuery = query
      searchCurrent = 0
      runSearch()
      const range = searchRanges[searchCurrent]
      if (range) scrollToRange(range)
      emit(false)
    },
    findNext: () => moveSearch(1),
    findPrevious: () => moveSearch(-1),
    clearFind: () => {
      searchQuery = ''
      emit()
    },
    prepareSave: (saveOptions = {}) => {
      flush()
      const ids = new Set(touched)
      // During IME composition the buffered records are not processed yet; include their nodes too.
      for (const r of compositionBuffer) {
        const id = isEditableText(r.target) ? map.recordOf.get(r.target) : undefined
        if (id !== undefined) ids.add(id)
      }
      const edits: TextEdit[] = []
      const values = new Map<number, readonly string[]>()
      const breaks = new Set<Element>()
      const texts = new Set<Text>()
      for (const id of ids) {
        const node = map.nodeOf[id]
        const rec = mend.records[id]
        const lines = valueOf(id)
        if (!node || !rec || !isChanged(lines, rec)) continue
        const value = lines.length === 1 ? (lines[0] ?? '') : lines
        edits.push({ recordId: id, value, preformatted: isPreformatted(node) })
        values.set(id, lines)
        map.linesOf.get(id)?.forEach((line, i) => {
          texts.add(line)
          const br = line.previousSibling
          if (i > 0 && br && isNewBreak(br)) breaks.add(br as Element)
        })
      }
      return {
        result: coreSave(mend, edits, saveOptions),
        document: mend,
        values,
        lineBreaks: { breaks, texts },
      }
    },
    commitSave: (prepared) => {
      if (prepared.document !== mend) {
        throw new Error('Mend: commitSave got a save prepared from an older document')
      }
      if (!prepared.result.ok) throw new Error('Mend: commitSave got a failed save')
      const result: SaveSuccess = prepared.result
      flush()
      const old = mend
      // 1. The DOM takes the values the new source decodes to (U+00A0 rule), unless the user typed meanwhile.
      for (const [id, expected] of result.expectedValues) {
        const lines = linesOfRecord(id)
        const current = lines.map(textValue)
        if (!sameLines(prepared.values.get(id), current) || sameLines(expected, current)) continue
        if (lines.length !== expected.length) continue
        lines.forEach((line, i) => {
          const value = expected[i] ?? ''
          if (textValue(line) !== value) setDataKeepingSelection(line, value)
        })
      }
      discardOwnRecords()
      // 2. The history takes the same rule, so undo/redo stays consistent with the DOM (decision Q6).
      history = mapValues(history, (node, value) => {
        if (!value.includes(NBSP)) return value
        const rec = recordOfNode(node)
        if (!rec || rec.status !== 'editable') return value
        // A line of a split text is not the record's whole value; such entries are dropped below if saved.
        if (map.linesOf.has(rec.id)) return value
        try {
          return normalizeEditedValue(old.source, rec, value, isPreformatted(node))
        } catch (error: unknown) {
          // Such a value cannot be encoded at all; prepareSave rejects it again if it is ever restored and saved.
          console.warn(`Mend: kept an undo value that cannot be encoded (${rec.label})`, error)
          return value
        }
      })
      // 2b. Saved <br>s are part of the source now: history that would remove them is dropped (decided with the
      // user: line breaks cannot be undone across a save; plain text edits still can).
      const { breaks: saved, texts: savedTexts } = prepared.lineBreaks
      history = filterEntries(history, (part) =>
        isTextEntry(part)
          ? !savedTexts.has(part.node)
          : !savedTexts.has(part.left) && !savedTexts.has(part.right) && !saved.has(part.br),
      )
      newBreaks = new Set([...newBreaks].filter((br) => !saved.has(br)))
      // 3. Rebuild the node map against the new source of truth (S-05).
      const nodes = [...touched].flatMap((id) => linesOfRecord(id))
      const next = mapNodes(doc, result.document, false, isNewBreak)
      mend = result.document
      if (!next.ok) {
        map = { recordOf: new Map(), nodeOf: [], linesOf: new Map() }
        setReadOnly({
          code: 'resync-failed',
          detail: `${next.mismatch.reason} at ${next.mismatch.path}`,
        })
      } else {
        map = next.map
      }
      touched = new Set(
        nodes.flatMap((n) => {
          const id = map.recordOf.get(n)
          return id === undefined ? [] : [id]
        }),
      )
      emit()
    },
    focus: () => {
      frame.focus()
      win.focus()
    },
    destroy: () => {
      destroyed = true
      detachDocument()
      cleanups.forEach((c) => c())
      listeners.clear()
      wrapper.remove()
      URL.revokeObjectURL(frameUrl)
    },
  }
}
