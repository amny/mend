import { NBSP } from './helpers'
import { describe, expect, it } from 'vitest'
import { decodeText } from '../src/decodeText'

describe('decodeText', () => {
  it('maps plain text as a single identity run', () => {
    const r = decodeText('abc', 10)
    expect(r.value).toBe('abc')
    expect(r.markup).toBe(false)
    expect(r.segments).toEqual([
      { domStart: 0, domEnd: 3, srcStart: 10, srcEnd: 13, atomic: false },
    ])
  })

  it.each([
    ['&amp;', '&'],
    ['&nbsp;', `${NBSP}`],
    ['&#12354;', 'あ'],
    ['&#x3042;', 'あ'],
    ['&#X3042;', 'あ'],
    ['&copy', '©'],
    ['&amp', '&'],
    ['&#x1F600;', '😀'],
    ['&#0;', '�'],
    ['&#x80;', '€'],
    ['&NotEqualTilde;', String.fromCodePoint(0x2242, 0x338)],
  ])('decodes %s as one atomic token', (src, dom) => {
    const r = decodeText(src, 0)
    expect(r.value).toBe(dom)
    expect(r.segments).toEqual([
      { domStart: 0, domEnd: dom.length, srcStart: 0, srcEnd: src.length, atomic: true },
    ])
  })

  it('applies legacy (semicolon-less) matching like the HTML parser', () => {
    expect(decodeText('&copyright', 0).value).toBe('©right')
    expect(decodeText('&notin', 0).value).toBe('¬in')
    expect(decodeText('&notin;', 0).value).toBe('∉')
  })

  it('keeps unknown or incomplete references literal', () => {
    expect(decodeText('AT&T', 0).value).toBe('AT&T')
    expect(decodeText('&unknown;', 0).value).toBe('&unknown;')
    expect(decodeText('a & b', 0).value).toBe('a & b')
    expect(decodeText('&', 0).value).toBe('&')
  })

  it('normalizes CRLF and lone CR to LF as atomic tokens', () => {
    const r = decodeText('a\r\nb\rc', 0)
    expect(r.value).toBe('a\nb\nc')
    expect(r.segments).toEqual([
      { domStart: 0, domEnd: 1, srcStart: 0, srcEnd: 1, atomic: false },
      { domStart: 1, domEnd: 2, srcStart: 1, srcEnd: 3, atomic: true },
      { domStart: 2, domEnd: 3, srcStart: 3, srcEnd: 4, atomic: false },
      { domStart: 3, domEnd: 4, srcStart: 4, srcEnd: 5, atomic: true },
      { domStart: 4, domEnd: 5, srcStart: 5, srcEnd: 6, atomic: false },
    ])
  })

  it('reports a markup start ("<" followed by a letter, "/", "!" or "?")', () => {
    expect(decodeText('a <b', 0).markup).toBe(true)
    expect(decodeText('a </', 0).markup).toBe(true)
    expect(decodeText('a <!', 0).markup).toBe(true)
    expect(decodeText('a < b', 0).markup).toBe(false)
    expect(decodeText('1<2', 0).markup).toBe(false)
  })
})
