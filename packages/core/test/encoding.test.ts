import { describe, expect, it } from 'vitest'
import { decodeUtf8, encodeUtf8 } from '../src/encoding'

const bytes = (...b: number[]): Uint8Array => new Uint8Array(b)

describe('decodeUtf8 / encodeUtf8', () => {
  it('round-trips text without BOM', () => {
    const input = new TextEncoder().encode('<p>あ😀</p>')
    const decoded = decodeUtf8(input)
    expect(decoded).toEqual({ ok: true, source: '<p>あ😀</p>', hasBom: false })
    if (!decoded.ok) return
    expect(encodeUtf8(decoded.source, decoded.hasBom)).toEqual(input)
  })

  it('records and restores the BOM, excluding it from the source', () => {
    const input = bytes(0xef, 0xbb, 0xbf, 0x3c, 0x70, 0x3e)
    const decoded = decodeUtf8(input)
    expect(decoded).toEqual({ ok: true, source: '<p>', hasBom: true })
    if (!decoded.ok) return
    expect(encodeUtf8(decoded.source, true)).toEqual(input)
  })

  it('keeps a second BOM-like character as content', () => {
    const input = bytes(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61)
    const decoded = decodeUtf8(input)
    expect(decoded.ok && decoded.source).toBe(String.fromCodePoint(0xfeff) + 'a')
  })

  it('rejects invalid UTF-8 instead of replacing it (Shift_JIS etc.)', () => {
    // "あ" in Shift_JIS
    const decoded = decodeUtf8(bytes(0x82, 0xa0))
    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    expect(decoded.error.code).toBe('invalid-utf8')
    expect(decoded.error.message).toMatch(/UTF-8/)
  })

  it('rejects lone surrogates encoded in UTF-8 (CESU-8)', () => {
    expect(decodeUtf8(bytes(0xed, 0xa0, 0x80)).ok).toBe(false)
  })
})
