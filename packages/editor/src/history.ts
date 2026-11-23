// Undo/redo history (requirements 5.8, E-04). Pure data: entries hold a node key and the values before/after,
// never source offsets, so the history survives saves (S-05).

/** How a text entry was made. Only consecutive 'typing' entries on the same node are merged. */
export type EntryKind = 'typing' | 'ime' | 'paste' | 'revert'

/** One text node went from `before` to `after`. */
export interface TextEntry<N> {
  readonly node: N
  readonly before: string
  readonly after: string
  readonly kind: EntryKind
  /** ms timestamp of the last change merged into this entry. */
  readonly time: number
}

/**
 * A new <br> was inserted (`inserted`) or removed between two lines of one text (Shift+Enter, Backspace at the start
 * of a line). Inserted: `left` held leftText + rightText, then `left` holds leftText, `br` and `right` (rightText)
 * follow it. Removed is the reverse.
 */
export interface BreakEntry<N, B> {
  readonly kind: 'break'
  readonly inserted: boolean
  readonly left: N
  readonly br: B
  readonly right: N
  readonly leftText: string
  readonly rightText: string
  readonly time: number
}

/** Several changes undone and redone as one step (e.g. reverting a text that has line breaks). Applied in order. */
export interface GroupEntry<N, B> {
  readonly kind: 'group'
  readonly entries: readonly (TextEntry<N> | BreakEntry<N, B>)[]
  readonly time: number
}

export type HistoryEntry<N, B = never> = TextEntry<N> | BreakEntry<N, B> | GroupEntry<N, B>

export const isTextEntry = <N, B>(e: HistoryEntry<N, B>): e is TextEntry<N> =>
  e.kind !== 'break' && e.kind !== 'group'

export interface History<N, B = never> {
  readonly undo: readonly HistoryEntry<N, B>[]
  readonly redo: readonly HistoryEntry<N, B>[]
  /** true right after undo/redo: the next entry never merges into the previous one. */
  readonly sealed: boolean
}

/** Consecutive typing within this window becomes one undo step. */
export const COALESCE_MS = 500

export const emptyHistory = <N, B = never>(): History<N, B> => ({
  undo: [],
  redo: [],
  sealed: false,
})

/** Adds an entry, merging it into the previous one when it continues the same typing run. Clears redo. */
export function record<N, B>(history: History<N, B>, entry: HistoryEntry<N, B>): History<N, B> {
  if (!isTextEntry(entry)) {
    return { undo: [...history.undo, entry], redo: [], sealed: false }
  }
  if (entry.before === entry.after) return history
  const last = history.undo[history.undo.length - 1]
  const continues =
    !history.sealed &&
    last !== undefined &&
    isTextEntry(last) &&
    last.kind === 'typing' &&
    entry.kind === 'typing' &&
    last.node === entry.node &&
    last.after === entry.before &&
    entry.time - last.time <= COALESCE_MS
  if (!continues) return { undo: [...history.undo, entry], redo: [], sealed: false }
  const merged: TextEntry<N> = { ...last, after: entry.after, time: entry.time }
  const rest = history.undo.slice(0, -1)
  return {
    undo: merged.before === merged.after ? rest : [...rest, merged],
    redo: [],
    sealed: false,
  }
}

export interface Step<N, B = never> {
  readonly history: History<N, B>
  readonly entry: HistoryEntry<N, B>
}

/** Pops the last entry; the caller applies it backwards. */
export function undo<N, B>(history: History<N, B>): Step<N, B> | undefined {
  const entry = history.undo[history.undo.length - 1]
  if (!entry) return undefined
  return {
    history: { undo: history.undo.slice(0, -1), redo: [...history.redo, entry], sealed: true },
    entry,
  }
}

/** Pops the last undone entry; the caller applies it forwards. */
export function redo<N, B>(history: History<N, B>): Step<N, B> | undefined {
  const entry = history.redo[history.redo.length - 1]
  if (!entry) return undefined
  return {
    history: { undo: [...history.undo, entry], redo: history.redo.slice(0, -1), sealed: true },
    entry,
  }
}

type Part<N, B> = TextEntry<N> | BreakEntry<N, B>

/** Rewrites every entry part; undefined from `fn` drops the entry (a group is dropped as a whole). */
function mapEntries<N, B, M, C>(
  history: History<N, B>,
  fn: (part: Part<N, B>) => Part<M, C> | undefined,
): History<M, C> {
  const mapEntry = (e: HistoryEntry<N, B>): HistoryEntry<M, C> | undefined => {
    if (e.kind !== 'group') return fn(e)
    const entries: Part<M, C>[] = []
    for (const part of e.entries) {
      const mapped = fn(part)
      if (!mapped) return undefined
      entries.push(mapped)
    }
    return { kind: 'group', entries, time: e.time }
  }
  const mapList = (list: readonly HistoryEntry<N, B>[]): HistoryEntry<M, C>[] =>
    list.flatMap((e) => {
      const mapped = mapEntry(e)
      return mapped ? [mapped] : []
    })
  return { undo: mapList(history.undo), redo: mapList(history.redo), sealed: history.sealed }
}

/** Rewrites every stored text value (used after saving to apply the same U+00A0 rule as the DOM, decision Q6). */
export function mapValues<N, B>(
  history: History<N, B>,
  fn: (node: N, value: string) => string,
): History<N, B> {
  return mapEntries(history, (part) =>
    isTextEntry(part)
      ? { ...part, before: fn(part.node, part.before), after: fn(part.node, part.after) }
      : part,
  )
}

/** Drops the entries for which `keep` is false (a group is dropped as a whole). */
export function filterEntries<N, B>(
  history: History<N, B>,
  keep: (part: Part<N, B>) => boolean,
): History<N, B> {
  return mapEntries(history, (part) => (keep(part) ? part : undefined))
}

/**
 * Moves every entry to other node keys (used when the editing document was loaded again, requirements 5.1).
 * Returns undefined when some node has no counterpart, so the caller can decide what to drop.
 */
export function mapNodes<N, B, M, C>(
  history: History<N, B>,
  text: (node: N) => M | undefined,
  br: (node: B) => C | undefined,
): History<M, C> | undefined {
  let missing = false
  const moved = mapEntries<N, B, M, C>(history, (part) => {
    if (isTextEntry(part)) {
      const node = text(part.node)
      if (node === undefined) missing = true
      return node === undefined ? undefined : { ...part, node }
    }
    const left = text(part.left)
    const right = text(part.right)
    const b = br(part.br)
    if (left === undefined || right === undefined || b === undefined) {
      missing = true
      return undefined
    }
    return { ...part, left, right, br: b }
  })
  return missing ? undefined : moved
}
