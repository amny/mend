import { describe, expect, it } from 'vitest'
import { parseDocument } from '../src/document'
import { decodeText } from '../src/decodeText'
import { encodeEdit, normalizeEditedValue } from '../src/encodeEdit'
import { applyPatches } from '../src/patch'
import type { TextRecord } from '../src/types'
import { after, before, insertAt, recordContaining, removeRange, NBSP } from './helpers'

function run(html: string, needle: string, edit: (value: string) => string, preformatted = false) {
  const source = `<!doctype html><body><p>${html}</p>`
  const doc = parseDocument(source)
  const record: TextRecord = recordContaining(doc, needle)
  const value = edit(record.value)
  const result = encodeEdit(source, record, value, preformatted)
  const newSource = result.patch ? applyPatches(source, [result.patch]) : source
  const start = source.indexOf('<p>') + 3
  const nodeSource = newSource.slice(start, newSource.length - (source.length - record.end))
  return { result, record, nodeSource, decoded: decodeText(nodeSource, 0) }
}

describe('encodeEdit', () => {
  it('returns no patch when the value is unchanged', () => {
    expect(run('abc', 'abc', (v) => v).result.patch).toBeNull()
  })

  it('produces a minimal patch for an inserted character', () => {
    const { result, record } = run('abcdef', 'abc', (v) => insertAt(v, 3, 'X'))
    expect(result.patch).toEqual({ start: record.start + 3, end: record.start + 3, text: 'X' })
  })

  it('escapes only & and < in new text', () => {
    const { nodeSource } = run('ab', 'ab', (v) => insertAt(v, 1, `&<>"'`))
    expect(nodeSource).toBe(`a&amp;&lt;>"'b`)
  })

  it('keeps an adjacent reference intact when inserting right after / before it (AC-03)', () => {
    expect(run('a&amp;b', 'a&b', (v) => insertAt(v, after(v, '&'), 'X')).nodeSource).toBe(
      'a&amp;Xb',
    )
    expect(run('a&amp;b', 'a&b', (v) => insertAt(v, before(v, '&'), 'X')).nodeSource).toBe(
      'aX&amp;b',
    )
    expect(run('a&nbsp;b', `a${NBSP}b`, (v) => removeRange(v, 2, 3)).nodeSource).toBe('a&nbsp;')
    expect(run('&#x3042;b', 'あb', (v) => insertAt(v, 1, 'い')).nodeSource).toBe('&#x3042;いb')
  })

  it('replaces a whole reference token when the decoded character itself changes', () => {
    expect(run('a&amp;b', 'a&b', (v) => v.replace('&', '+')).nodeSource).toBe('a+b')
  })

  it('never splits a surrogate pair or an astral reference', () => {
    expect(run('x😀y', 'x', (v) => v.replace('😀', '😁')).nodeSource).toBe('x😁y')
    expect(run('x&#x1F600;y', 'x', (v) => v.replace('😀', '😁')).nodeSource).toBe('x😁y')
  })

  it('keeps untouched characters inside the changed range in their original notation', () => {
    // both sides of &nbsp; change; the nbsp in the middle must stay "&nbsp;"
    const { nodeSource } = run('a&nbsp;b', `a${NBSP}b`, () => `A${NBSP}B`)
    expect(nodeSource).toBe('A&nbsp;B')
  })

  describe('U+00A0 typed by Chrome', () => {
    it('turns a lone inserted U+00A0 into a normal space', () => {
      const { nodeSource, result } = run('abc', 'abc', (v) => v + `${NBSP}`)
      expect(nodeSource).toBe('abc ')
      expect(result.expectedValue).toBe('abc ')
    })
    it('keeps U+00A0 as &nbsp; inside a run of spaces', () => {
      const { nodeSource, result } = run('a b', 'a b', (v) => insertAt(v, 1, `${NBSP}`))
      expect(nodeSource).toBe('a&nbsp; b')
      expect(result.expectedValue).toBe(`a${NBSP} b`)
    })
    it('keeps U+00A0 as is in preformatted context', () => {
      const { nodeSource } = run('abc', 'abc', (v) => v + `${NBSP}`, true)
      expect(nodeSource).toBe(`abc${NBSP}`)
    })
    it('does not touch an original &nbsp;', () => {
      const { nodeSource } = run('a&nbsp;b', `a${NBSP}b`, (v) => v + 'c')
      expect(nodeSource).toBe('a&nbsp;bc')
    })
  })

  describe('reference hazards (inserted text must not merge with preceding source)', () => {
    it.each([
      ['&noZ', (v: string) => insertAt(v, 3, 't')],
      ['AT&Z', (v: string) => insertAt(v, 3, 'amp;')],
      ['&#12Z', (v: string) => insertAt(v, 1, '3')],
      ['&ampZ', (v: string) => insertAt(v, 1, ';')],
      ['&copyZ', (v: string) => insertAt(v, 1, 'right')],
    ])('source %s decodes to exactly the edited value', (html, edit) => {
      const { result, decoded } = run(html, 'Z', edit)
      expect(result.patch).not.toBeNull()
      expect(decoded.value).toBe(result.expectedValue)
      expect(decoded.markup).toBe(false)
    })

    it('encodes the first inserted character numerically when it would extend a reference', () => {
      const { nodeSource } = run('&noZ', '&noZ', (v) => insertAt(v, 3, 't'))
      expect(nodeSource).toBe('&no&#116;Z')
    })

    it('handles a deletion that would join a raw & with following letters', () => {
      const { nodeSource, decoded, result } = run('A&x copy', 'A&x copy', (v) =>
        v.replace('x ', ''),
      )
      expect(decoded.value).toBe(result.expectedValue)
      expect(result.expectedValue).toBe('A&copy')
      expect(nodeSource).not.toBe('A&copy')
    })

    it('handles a deletion that would turn a raw < into a tag', () => {
      const { decoded, result } = run('a < b', 'a < b', (v) => v.replace('< ', '<'))
      expect(result.expectedValue).toBe('a <b')
      expect(decoded.value).toBe('a <b')
      expect(decoded.markup).toBe(false)
    })
  })
})

describe('normalizeEditedValue', () => {
  it('applies the same U+00A0 rule as encodeEdit without producing a patch', () => {
    const doc = parseDocument('<!doctype html><p>a&nbsp;b</p>')
    const record = recordContaining(doc, `a${NBSP}b`)
    expect(normalizeEditedValue(doc.source, record, `a${NBSP}bc${NBSP}`, false)).toBe(`a${NBSP}bc `)
    expect(normalizeEditedValue(doc.source, record, record.value, false)).toBe(record.value)
  })
})

describe('new line breaks (preformatted text)', () => {
  const edit = (source: string, needle: string, at: number) => {
    const doc = parseDocument(source)
    const record = recordContaining(doc, needle)
    const value = insertAt(record.value, at, '\n')
    const result = encodeEdit(source, record, value, true)
    const next = result.patch ? applyPatches(source, [result.patch]) : source
    return { next, result, value }
  }

  it('writes LF in an LF file', () => {
    const { next } = edit('<!doctype html>\n<body>\n<pre>ab</pre>\n', 'ab', 1)
    expect(next).toBe('<!doctype html>\n<body>\n<pre>a\nb</pre>\n')
  })

  it('writes CRLF in a CRLF file, and the new source decodes to the edited value', () => {
    const source = '<!doctype html>\r\n<body>\r\n<pre>ab</pre>\r\n'
    const { next, result, value } = edit(source, 'ab', 1)
    expect(next).toBe('<!doctype html>\r\n<body>\r\n<pre>a\r\nb</pre>\r\n')
    expect(result.expectedValue).toBe(value)
    expect(recordContaining(parseDocument(next), 'a\nb').value).toBe('a\nb')
  })

  it('follows the line ending inside the text node first', () => {
    const { next } = edit('<!doctype html>\n<body><pre>x\r\ny</pre>', 'x', 1)
    expect(next).toBe('<!doctype html>\n<body><pre>x\r\n\r\ny</pre>')
  })

  it('escapes a new line break at the start of <pre> (the parser would drop it)', () => {
    const { next, result } = edit('<!doctype html><body><pre>ab</pre>', 'ab', 0)
    expect(next).toBe('<!doctype html><body><pre>&#10;ab</pre>')
    expect(result.expectedValue).toBe('\nab')
  })
})
