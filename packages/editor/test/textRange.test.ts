import { describe, expect, it } from 'vitest'
import { changedRange, findMatches, flattenLineBreaks } from '../src/textRange'

describe('changedRange', () => {
  it('finds the differing middle', () => {
    expect(changedRange('abcdef', 'abXYef')).toEqual({ start: 2, endBefore: 4, endAfter: 4 })
    expect(changedRange('abc', 'abxc')).toEqual({ start: 2, endBefore: 2, endAfter: 3 })
    expect(changedRange('aaa', 'aa')).toEqual({ start: 2, endBefore: 3, endAfter: 2 })
    expect(changedRange('same', 'same')).toEqual({ start: 4, endBefore: 4, endAfter: 4 })
    expect(changedRange('', 'new')).toEqual({ start: 0, endBefore: 0, endAfter: 3 })
  })
})

describe('flattenLineBreaks', () => {
  it('turns every line break into one space', () => {
    expect(flattenLineBreaks('a\r\nb\rc\nd')).toBe('a b c d')
  })
})

describe('findMatches', () => {
  it('finds matches inside and across nodes, case-insensitively for ASCII', () => {
    expect(findMatches(['Hello ', 'wor', 'ld'], 'o W')).toEqual([
      { startNode: 0, startOffset: 4, endNode: 1, endOffset: 1 },
    ])
    expect(findMatches(['abab'], 'ab')).toEqual([
      { startNode: 0, startOffset: 0, endNode: 0, endOffset: 2 },
      { startNode: 0, startOffset: 2, endNode: 0, endOffset: 4 },
    ])
  })

  it('never starts at the end of a node or ends at the start of one, skipping empty nodes', () => {
    expect(findMatches(['ab', '', 'cd'], 'cd')).toEqual([
      { startNode: 2, startOffset: 0, endNode: 2, endOffset: 2 },
    ])
    expect(findMatches(['ab', '', 'cd'], 'ab')).toEqual([
      { startNode: 0, startOffset: 0, endNode: 0, endOffset: 2 },
    ])
  })

  it('returns nothing for an empty query or no match', () => {
    expect(findMatches(['abc'], '')).toEqual([])
    expect(findMatches(['abc'], 'x')).toEqual([])
    expect(findMatches([], 'x')).toEqual([])
  })
})
