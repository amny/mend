// Tokenizes the source of a text node exactly like the HTML tokenizer does in the data state,
// producing the decoded value and a DOM(UTF-16) -> source position map (requirements 5.3).
import { DecodingMode, HtmlEntityDecoder } from 'entities/decode'
import type { Segment } from './types'

export interface DecodedText {
  readonly value: string
  readonly segments: readonly Segment[]
  /** true if the text contains "<" that the tokenizer would treat as the start of markup. */
  readonly markup: boolean
}

interface Reference {
  readonly value: string
  readonly length: number
}

/** Decodes a character reference starting at text[at] === '&'. Returns null if it is not one. */
function readReference(text: string, at: number): Reference | null {
  const codePoints: number[] = []
  let consumed = 0
  const decoder = new HtmlEntityDecoder((cp, n) => {
    codePoints.push(cp)
    consumed = n
  })
  decoder.startEntity(DecodingMode.Legacy)
  const written = decoder.write(text, at + 1)
  if (written < 0) decoder.end()
  if (codePoints.length === 0 || consumed === 0) return null
  return { value: String.fromCodePoint(...codePoints), length: consumed }
}

const isMarkupStart = (next: string | undefined): boolean =>
  next !== undefined && /[A-Za-z/!?]/.test(next)

/**
 * @param text   source slice of a text node
 * @param offset source offset of text[0] (added to srcStart/srcEnd)
 */
export function decodeText(text: string, offset: number): DecodedText {
  const segments: Segment[] = []
  const parts: string[] = []
  let dom = 0
  let markup = false
  let runStart = -1 // start index (in text) of the current identity run

  const flushRun = (end: number): void => {
    if (runStart < 0) return
    const length = end - runStart
    segments.push({
      domStart: dom,
      domEnd: dom + length,
      srcStart: offset + runStart,
      srcEnd: offset + end,
      atomic: false,
    })
    parts.push(text.slice(runStart, end))
    dom += length
    runStart = -1
  }

  const pushAtomic = (start: number, length: number, value: string): void => {
    segments.push({
      domStart: dom,
      domEnd: dom + value.length,
      srcStart: offset + start,
      srcEnd: offset + start + length,
      atomic: true,
    })
    parts.push(value)
    dom += value.length
  }

  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\r') {
      flushRun(i)
      const length = text[i + 1] === '\n' ? 2 : 1
      pushAtomic(i, length, '\n')
      i += length
      continue
    }
    if (ch === '&') {
      const ref = readReference(text, i)
      if (ref) {
        flushRun(i)
        pushAtomic(i, ref.length, ref.value)
        i += ref.length
        continue
      }
    }
    if (ch === '<' && isMarkupStart(text[i + 1])) markup = true
    if (runStart < 0) runStart = i
    i += 1
  }
  flushRun(text.length)
  return { value: parts.join(''), segments, markup }
}
