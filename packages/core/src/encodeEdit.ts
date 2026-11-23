// Turns the edited value of one text node into a source patch (requirements 5.5, 5.6; decisions Q3, Q4).
import { decodeText } from './decodeText'
import { diffCodePoints } from './diff'
import type { Patch, Segment, TextRecord } from './types'

export interface EncodeResult {
  /** null when the value is unchanged. */
  readonly patch: Patch | null
  /** The value the patched source decodes to (U+00A0 normalized). The editor syncs the DOM to it after saving. */
  readonly expectedValue: string
}

/** U+00A0. Built from a number because formatters rewrite \u escapes into invisible literals. */
const NBSP = String.fromCodePoint(0xa0)
const HAZARD_LOOKBEHIND = 64

/** A piece of the rewritten range: kept original source, or characters to encode. */
type Piece =
  | { readonly kind: 'orig'; readonly domStart: number; readonly domEnd: number }
  | {
      readonly kind: 'new'
      /** DOM characters to encode. */
      readonly text: string
      /** Offset of text[0] in the edited value (for U+00A0 neighbours); -1 if it came from the original suffix. */
      readonly valueStart: number
      /** Encode the first code point as a numeric reference to break a merge with preceding source. */
      readonly escapeFirst: boolean
    }

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff

function segmentAt(segments: readonly Segment[], dom: number): Segment | undefined {
  // Binary search: the segment with domStart <= dom < domEnd.
  let lo = 0
  let hi = segments.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const s = segments[mid]
    if (!s) break
    if (dom < s.domStart) hi = mid - 1
    else if (dom >= s.domEnd) lo = mid + 1
    else return s
  }
  return undefined
}

function splitsSurrogate(value: string, dom: number): boolean {
  return (
    dom > 0 &&
    dom < value.length &&
    isHigh(value.charCodeAt(dom - 1)) &&
    isLow(value.charCodeAt(dom))
  )
}

/** Largest boundary <= dom (never inside an atomic token or a surrogate pair). */
function snapDown(record: TextRecord, dom: number): number {
  const s = segmentAt(record.segments, dom)
  if (s && s.atomic && dom > s.domStart) return s.domStart
  return splitsSurrogate(record.value, dom) ? dom - 1 : dom
}

/** Smallest boundary >= dom. */
function snapUp(record: TextRecord, dom: number): number {
  const s = segmentAt(record.segments, dom)
  if (s && s.atomic && dom > s.domStart) return s.domEnd
  return splitsSurrogate(record.value, dom) ? dom + 1 : dom
}

/** Source offset of a DOM boundary offset. */
function srcOf(record: TextRecord, dom: number): number {
  if (dom >= record.value.length) return record.end
  const s = segmentAt(record.segments, dom)
  if (!s) return record.start
  if (s.atomic) {
    if (dom !== s.domStart) throw new Error(`Mend: offset ${dom} is inside an atomic token`)
    return s.srcStart
  }
  return s.srcStart + (dom - s.domStart)
}

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

function commonSuffix(a: string, b: string, limit: number): number {
  let i = 0
  while (i < limit && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++
  return i
}

const isSpaceLike = (c: string | undefined): boolean => c === ' ' || c === NBSP

/** Chrome inserts U+00A0 for typed spaces; a lone one becomes a normal space (requirements 5.5). */
function keepsNbsp(value: string, index: number, preformatted: boolean): boolean {
  return preformatted || isSpaceLike(value[index - 1]) || isSpaceLike(value[index + 1])
}

/** Builds the pieces for value[a, bValue) replacing original[a, bOrig). */
function buildPieces(
  record: TextRecord,
  value: string,
  a: number,
  bOrig: number,
  bValue: number,
): Piece[] {
  const pieces: Piece[] = []
  const pushNew = (start: number, end: number): void => {
    if (end <= start) return
    const last = pieces[pieces.length - 1]
    if (
      last?.kind === 'new' &&
      last.valueStart >= 0 &&
      last.valueStart + last.text.length === start
    ) {
      pieces[pieces.length - 1] = { ...last, text: last.text + value.slice(start, end) }
      return
    }
    pieces.push({
      kind: 'new',
      text: value.slice(start, end),
      valueStart: start,
      escapeFirst: false,
    })
  }
  for (const h of diffCodePoints(record.value.slice(a, bOrig), value.slice(a, bValue))) {
    const oldStart = a + h.oldStart
    const oldEnd = a + h.oldEnd
    const newStart = a + h.newStart
    const newEnd = a + h.newEnd
    if (!h.equal) {
      pushNew(newStart, newEnd)
      continue
    }
    // Keep the original notation for the part of an equal hunk that lies on token boundaries.
    const keepStart = snapUp(record, oldStart)
    const keepEnd = snapDown(record, oldEnd)
    if (keepStart >= keepEnd) {
      pushNew(newStart, newEnd)
      continue
    }
    pushNew(newStart, newStart + (keepStart - oldStart))
    pieces.push({ kind: 'orig', domStart: keepStart, domEnd: keepEnd })
    pushNew(newEnd - (oldEnd - keepEnd), newEnd)
  }
  return pieces
}

/**
 * The line ending a new line break is written with: the first one inside the text node, else the nearest before
 * it, else the nearest after it, else LF. Keeps CRLF files CRLF (also with mixed line endings, locally consistent).
 */
export function lineEndingAt(source: string, record: TextRecord): string {
  const at = (i: number): string =>
    source[i] === '\r' && source[i + 1] === '\n' ? '\r\n' : (source[i] ?? '\n')
  const isBreak = (i: number): boolean => source[i] === '\n' || source[i] === '\r'
  for (let i = record.start; i < record.end; i++) if (isBreak(i)) return at(i)
  for (let i = record.start - 1; i >= 0; i--) {
    if (!isBreak(i)) continue
    // The "\n" of a CRLF pair: report the pair.
    return source[i] === '\n' && source[i - 1] === '\r' ? '\r\n' : at(i)
  }
  for (let i = record.end; i < source.length; i++) if (isBreak(i)) return at(i)
  return '\n'
}

/** A new <br>: `marker` stands for it in the value while encoding, `markup` is what is written (e.g. "<br>"). */
interface LineBreak {
  readonly marker: string
  readonly markup: string
}

function encodeChar(
  ch: string,
  valueIndex: number,
  value: string,
  preformatted: boolean,
  lineEnding: string,
  lineBreak: LineBreak | undefined,
): string {
  if (lineBreak && ch === lineBreak.marker) return lineBreak.markup
  if (ch === '\n') return lineEnding
  if (ch === '&') return '&amp;'
  if (ch === '<') return '&lt;'
  if (ch === NBSP && valueIndex >= 0) {
    if (preformatted) return NBSP
    return keepsNbsp(value, valueIndex, preformatted) ? '&nbsp;' : ' '
  }
  return ch
}

const numericReference = (cp: string): string => `&#${cp.codePointAt(0) ?? 0};`

function renderPiece(
  piece: Piece,
  record: TextRecord,
  source: string,
  value: string,
  preformatted: boolean,
  lineEnding: string,
  lineBreak: LineBreak | undefined,
): string {
  if (piece.kind === 'orig') {
    return source.slice(srcOf(record, piece.domStart), srcOf(record, piece.domEnd))
  }
  const cps = Array.from(piece.text)
  let offset = 0
  return cps
    .map((cp, i) => {
      const valueIndex = piece.valueStart >= 0 ? piece.valueStart + offset : -1
      offset += cp.length
      if (i === 0 && piece.escapeFirst) return numericReference(cp)
      return encodeChar(cp, valueIndex, value, preformatted, lineEnding, lineBreak)
    })
    .join('')
}

/**
 * Would `left` + `right` decode differently from decoding them apart (a reference or tag forming across the join)?
 * A new <br> ends a text node, so only the text between the nearest <br>s on both sides can join.
 */
function joinHazard(left: string, right: string, lineBreak: LineBreak | undefined): boolean {
  if (lineBreak) {
    const cut = left.lastIndexOf(lineBreak.markup)
    const next = right.indexOf(lineBreak.markup)
    return joinHazard(
      cut < 0 ? left : left.slice(cut + lineBreak.markup.length),
      next < 0 ? right : right.slice(0, next),
      undefined,
    )
  }
  if (right === '') return false
  const idx = Math.max(left.lastIndexOf('&'), left.lastIndexOf('<'))
  if (idx < 0 || left.length - idx > HAZARD_LOOKBEHIND) return false
  const tail = left.slice(idx)
  const joined = decodeText(tail + right, 0)
  return joined.markup || joined.value !== decodeText(tail, 0).value + decodeText(right, 0).value
}

const startsWithNewline = (s: string): boolean => s.startsWith('\n') || s.startsWith('\r')

/**
 * Computes the patch for one edited text node.
 * Throws if the result cannot be made to decode to the expected value (callers must not save then).
 */
export function encodeEdit(
  source: string,
  record: TextRecord,
  value: string,
  preformattedHint: boolean,
  lineBreak?: LineBreak,
): EncodeResult {
  if (value === record.value) return { patch: null, expectedValue: value }
  if (record.status !== 'editable') {
    throw new Error(
      `Mend: text record ${record.id} (${record.label}) is not editable (${record.status})`,
    )
  }
  const preformatted = preformattedHint || record.preformatted
  const original = record.value

  // 1. Outer changed range, snapped to token / code point boundaries.
  const a = snapDown(record, commonPrefix(original, value))
  const suffix = commonSuffix(original, value, Math.min(original.length, value.length) - a)
  let bOrig = snapUp(record, original.length - suffix)
  const bValue = value.length - (original.length - bOrig)

  // 2. Pieces (Q4: untouched characters inside the range keep their notation).
  let pieces: Piece[] = buildPieces(record, value, a, bOrig, bValue)

  // 3. Fix joins that would merge into a reference/tag (Q3) or a dropped leading newline.
  const prefixSrc = source.slice(record.start, srcOf(record, a))
  const lineEnding = lineEndingAt(source, record)
  const render = (ps: readonly Piece[]): string[] =>
    ps.map((p) => renderPiece(p, record, source, value, preformatted, lineEnding, lineBreak))

  /** Escapes the first code point at join i (0 = before pieces[0]; pieces.length = before the suffix). Returns false if impossible. */
  const escapeAt = (i: number): boolean => {
    const piece = pieces[i]
    if (piece === undefined) {
      // Join with the original suffix: pull its first code point into the patch.
      if (bOrig >= original.length) return false
      const s = segmentAt(record.segments, bOrig)
      if (!s || s.atomic) return false
      const cp = String.fromCodePoint(original.codePointAt(bOrig) ?? 0)
      pieces = [...pieces, { kind: 'new', text: cp, valueStart: -1, escapeFirst: true }]
      bOrig += cp.length
      return true
    }
    if (piece.kind === 'new') {
      if (piece.escapeFirst) return false
      pieces = pieces.map((p, k) => (k === i ? { ...piece, escapeFirst: true } : p))
      return true
    }
    const s = segmentAt(record.segments, piece.domStart)
    if (!s || s.atomic) return false
    const cp = String.fromCodePoint(original.codePointAt(piece.domStart) ?? 0)
    const head: Piece = { kind: 'new', text: cp, valueStart: -1, escapeFirst: true }
    const rest: Piece[] =
      piece.domStart + cp.length < piece.domEnd
        ? [{ kind: 'orig', domStart: piece.domStart + cp.length, domEnd: piece.domEnd }]
        : []
    pieces = [...pieces.slice(0, i), head, ...rest, ...pieces.slice(i + 1)]
    return true
  }

  for (let attempt = 0; attempt <= pieces.length + 2; attempt++) {
    const rendered = render(pieces)
    const suffixSrc = source.slice(srcOf(record, bOrig), record.end)
    const parts = [...rendered, suffixSrc]
    let fixed = false
    let left = prefixSrc
    for (let i = 0; i < parts.length; i++) {
      const right = parts.slice(i).join('')
      const droppedNewline = record.leadingNewlineDropped && left === '' && startsWithNewline(right)
      if ((droppedNewline || joinHazard(left, right, lineBreak)) && escapeAt(i)) {
        fixed = true
        break
      }
      left += parts[i] ?? ''
    }
    if (!fixed) break
  }

  // 4. Expected value and final self-check.
  const expectedValue = pieces
    .map((p) => {
      if (p.kind === 'orig') return original.slice(p.domStart, p.domEnd)
      if (p.valueStart < 0 || preformatted) return p.text
      return Array.from(p.text)
        .map((cp, k) =>
          cp === NBSP && !keepsNbsp(value, p.valueStart + k, preformatted) ? ' ' : cp,
        )
        .join('')
    })
    .join('')
  const fullExpected = original.slice(0, a) + expectedValue + original.slice(bOrig)
  const patch: Patch = {
    start: srcOf(record, a),
    end: srcOf(record, bOrig),
    text: render(pieces).join(''),
  }
  const nodeSource = prefixSrc + patch.text + source.slice(patch.end, record.end)
  // With new <br>s, every part between them is its own text node and must decode to its line.
  const parts = lineBreak ? nodeSource.split(lineBreak.markup) : [nodeSource]
  const expectedParts = lineBreak ? fullExpected.split(lineBreak.marker) : [fullExpected]
  const decodesCorrectly =
    parts.length === expectedParts.length &&
    parts.every((part, i) => {
      const check = decodeText(part, 0)
      return check.value === expectedParts[i] && !check.markup
    })
  const dropped = record.leadingNewlineDropped && startsWithNewline(nodeSource)
  if (!decodesCorrectly || dropped) {
    const check = decodeText(nodeSource, 0)
    throw new Error(
      `Mend: could not encode the edit of text record ${record.id} (${record.label}) safely: ` +
        `${JSON.stringify(nodeSource)} would decode to ${JSON.stringify(check.value)}, expected ${JSON.stringify(fullExpected)}`,
    )
  }
  return { patch, expectedValue: fullExpected }
}

/** "<br>" unless the source already writes line breaks another way ("<br/>", "<br />", "<BR>"): then that. */
export function lineBreakMarkup(source: string): string {
  return /<br\s*\/?>/i.exec(source)?.[0] ?? '<br>'
}

export interface EncodeLinesResult {
  readonly patch: Patch | null
  /** The lines the patched source decodes to (U+00A0 normalized). */
  readonly expectedLines: readonly string[]
}

/** A code point that occurs in none of the strings (private use area). */
function unusedCodePoint(strings: readonly string[]): string {
  for (let cp = 0xe000; cp <= 0xf8ff; cp++) {
    const c = String.fromCodePoint(cp)
    if (strings.every((s) => !s.includes(c))) return c
  }
  throw new Error('Mend: no unused code point to mark line breaks with')
}

/**
 * Computes the patch for a text node split into `lines` by new <br> elements (written as `markup`).
 * Characters that stay keep their notation, like encodeEdit. Throws if the result cannot be encoded safely.
 */
export function encodeLines(
  source: string,
  record: TextRecord,
  lines: readonly string[],
  preformattedHint: boolean,
  markup: string,
): EncodeLinesResult {
  if (lines.length < 2) {
    const result = encodeEdit(source, record, lines[0] ?? '', preformattedHint)
    return { patch: result.patch, expectedLines: [result.expectedValue] }
  }
  const marker = unusedCodePoint([record.value, ...lines])
  const result = encodeEdit(source, record, lines.join(marker), preformattedHint, {
    marker,
    markup,
  })
  return { patch: result.patch, expectedLines: result.expectedValue.split(marker) }
}

/** The value the DOM should hold after saving `value` (same U+00A0 rule as encodeEdit). Used to sync DOM and undo history. */
export function normalizeEditedValue(
  source: string,
  record: TextRecord,
  value: string,
  preformattedHint: boolean,
): string {
  return encodeEdit(source, record, value, preformattedHint).expectedValue
}
