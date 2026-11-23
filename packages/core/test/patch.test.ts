import { describe, expect, it } from 'vitest'
import { applyPatches, mapOffset } from '../src/patch'

describe('applyPatches', () => {
  it('applies patches in descending order regardless of input order', () => {
    expect(
      applyPatches('0123456789', [
        { start: 1, end: 2, text: 'A' },
        { start: 8, end: 9, text: 'BBB' },
        { start: 4, end: 4, text: '+' },
      ]),
    ).toBe('0A23+4567BBB9')
  })

  it('returns the source unchanged for no patches', () => {
    expect(applyPatches('abc', [])).toBe('abc')
  })

  it('rejects overlapping patches', () => {
    expect(() =>
      applyPatches('0123456789', [
        { start: 1, end: 4, text: '' },
        { start: 3, end: 5, text: '' },
      ]),
    ).toThrow(/overlap/)
  })

  it('rejects two insertions at the same offset (ambiguous order)', () => {
    expect(() =>
      applyPatches('abc', [
        { start: 1, end: 1, text: 'x' },
        { start: 1, end: 1, text: 'y' },
      ]),
    ).toThrow(/overlap/)
  })

  it('rejects out-of-range patches', () => {
    expect(() => applyPatches('abc', [{ start: 2, end: 5, text: '' }])).toThrow(/range/)
    expect(() => applyPatches('abc', [{ start: 2, end: 1, text: '' }])).toThrow(/range/)
  })
})

describe('mapOffset', () => {
  const patches = [
    { start: 2, end: 4, text: 'XYZ' }, // +1
    { start: 6, end: 8, text: '' }, // -2
  ]
  it('shifts offsets after patches by their length delta', () => {
    expect(mapOffset(patches, 0)).toBe(0)
    expect(mapOffset(patches, 2)).toBe(2)
    expect(mapOffset(patches, 4)).toBe(5)
    expect(mapOffset(patches, 6)).toBe(7)
    expect(mapOffset(patches, 8)).toBe(7)
    expect(mapOffset(patches, 10)).toBe(9)
  })
  it('maps an offset inside a replaced range to the start of the replacement', () => {
    expect(mapOffset(patches, 3)).toBe(2)
  })
})
