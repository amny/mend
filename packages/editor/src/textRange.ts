// Pure string helpers shared by undo (caret placement), highlighting and search.

export interface ChangedRange {
  /** Offset of the first differing UTF-16 unit. */
  readonly start: number
  /** End of the differing part in `before`. */
  readonly endBefore: number
  /** End of the differing part in `after`. */
  readonly endAfter: number
}

/** The differing middle part of two strings (common prefix and suffix removed). */
export function changedRange(before: string, after: string): ChangedRange {
  const max = Math.min(before.length, after.length)
  let start = 0
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let suffix = 0
  while (
    suffix < max - start &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix++
  }
  return { start, endBefore: before.length - suffix, endAfter: after.length - suffix }
}

/** Replaces CR/LF runs with a single space (E-03: pasted line breaks never create elements). */
export const flattenLineBreaks = (text: string): string => text.replace(/\r\n|\r|\n/g, ' ')

export interface TextMatch {
  /** Index of the node the match starts in, and the offset in it. */
  readonly startNode: number
  readonly startOffset: number
  readonly endNode: number
  readonly endOffset: number
}

const foldAscii = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase())

/**
 * Finds `query` in the concatenation of `texts` (ASCII case-insensitive; folding keeps lengths).
 * Matches may span nodes; they never overlap.
 */
export function findMatches(texts: readonly string[], query: string): TextMatch[] {
  if (query === '') return []
  const haystack = foldAscii(texts.join(''))
  const needle = foldAscii(query)
  const starts: number[] = []
  let total = 0
  for (const t of texts) {
    starts.push(total)
    total += t.length
  }
  /** Last node whose start satisfies `pred` (starts are ascending). */
  const lastNode = (pred: (start: number) => boolean): number => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (pred(starts[mid] ?? 0)) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  // A start lies in the node containing that character; an end lies at the end of the node holding the last one.
  const locate = (offset: number, isEnd: boolean): readonly [number, number] => {
    const node = lastNode((s) => (isEnd ? s < offset : s <= offset))
    return [node, offset - (starts[node] ?? 0)]
  }
  const matches: TextMatch[] = []
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    const [startNode, startOffset] = locate(at, false)
    const [endNode, endOffset] = locate(at + needle.length, true)
    matches.push({ startNode, startOffset, endNode, endOffset })
    from = at + needle.length
  }
  return matches
}
