import { describe, expect, it } from 'vitest'
import {
  COALESCE_MS,
  emptyHistory,
  filterEntries,
  mapNodes,
  mapValues,
  record,
  redo,
  undo,
  type EntryKind,
  type History,
  type BreakEntry,
} from '../src/history'

const entry = (
  node: string,
  before: string,
  after: string,
  time: number,
  kind: EntryKind = 'typing',
) => ({
  node,
  before,
  after,
  kind,
  time,
})

const typeAll = (steps: readonly (readonly [string, string, string, number])[]): History<string> =>
  steps.reduce((h, [n, b, a, t]) => record(h, entry(n, b, a, t)), emptyHistory<string>())

describe('history', () => {
  it('merges consecutive typing on the same node within the window', () => {
    const h = typeAll([
      ['a', 'x', 'xy', 0],
      ['a', 'xy', 'xyz', 100],
    ])
    expect(h.undo).toEqual([entry('a', 'x', 'xyz', 100)])
  })

  it('starts a new step after a pause, on another node, or for IME/paste/revert', () => {
    const paused = typeAll([
      ['a', 'x', 'xy', 0],
      ['a', 'xy', 'xyz', COALESCE_MS + 1],
    ])
    expect(paused.undo).toHaveLength(2)
    const other = typeAll([
      ['a', 'x', 'xy', 0],
      ['b', 'p', 'pq', 10],
    ])
    expect(other.undo).toHaveLength(2)
    const ime = record(typeAll([['a', 'x', 'xy', 0]]), entry('a', 'xy', 'xy愛', 10, 'ime'))
    expect(ime.undo).toHaveLength(2)
    const afterIme = record(ime, entry('a', 'xy愛', 'xy愛z', 20))
    expect(afterIme.undo).toHaveLength(3)
  })

  it('drops a merged step that returns to its starting value, and ignores no-op entries', () => {
    const h = typeAll([
      ['a', 'x', 'xy', 0],
      ['a', 'xy', 'x', 10],
    ])
    expect(h.undo).toEqual([])
    expect(record(h, entry('a', 'x', 'x', 20))).toBe(h)
  })

  it('undoes and redoes in order, and new entries clear redo', () => {
    const h = typeAll([
      ['a', '1', '2', 0],
      ['b', '1', '2', 10],
    ])
    const u1 = undo(h)
    expect(u1?.entry).toMatchObject({ node: 'b' })
    const u2 = u1 && undo(u1.history)
    expect(u2?.entry).toMatchObject({ node: 'a' })
    expect(u2 && undo(u2.history)).toBeUndefined()
    const r1 = u2 && redo(u2.history)
    expect(r1?.entry).toMatchObject({ node: 'a' })
    expect(r1?.history.redo).toHaveLength(1)
    const cleared = r1 && record(r1.history, entry('c', '1', '2', 2000))
    expect(cleared?.redo).toEqual([])
  })

  it('never merges typing into a step that was just undone or redone', () => {
    const h = typeAll([
      ['a', 'x', 'xy', 0],
      ['b', 'p', 'pq', 10],
    ])
    const u = undo(h)
    const next = u && record(u.history, entry('a', 'xy', 'xyz', 20))
    expect(next?.undo).toHaveLength(2)
    expect(next?.sealed).toBe(false)
  })

  it('maps values', () => {
    const h = typeAll([['a', 'x', 'y', 0]])
    expect(mapValues(h, (_, v) => v.toUpperCase()).undo[0]).toMatchObject({
      before: 'X',
      after: 'Y',
    })
  })
})

describe('mapNodes', () => {
  it('moves entries to new node keys and keeps the order and values', () => {
    let h: History<string> = emptyHistory()
    h = record(h, entry('a', 'X', 'Y', 0))
    h = record(h, entry('b', 'P', 'Q', 10_000))
    const step = undo(h)
    if (!step) throw new Error('nothing to undo')
    const moved = mapNodes(
      step.history,
      (n) => `${n}2`,
      (b) => b,
    )
    expect(moved?.undo).toMatchObject([{ node: 'a2', before: 'X', after: 'Y' }])
    expect(moved?.redo).toMatchObject([{ node: 'b2', before: 'P', after: 'Q' }])
    expect(moved?.sealed).toBe(true)
  })
  it('returns undefined when a node has no counterpart', () => {
    const h = record(emptyHistory<string>(), entry('a', 'X', 'Y', 0))
    expect(
      mapNodes(
        h,
        () => undefined,
        (b) => b,
      ),
    ).toBeUndefined()
  })
})

describe('line break entries', () => {
  const brk = (left: string, right: string, time: number): BreakEntry<string, string> => ({
    kind: 'break',
    inserted: true,
    left,
    br: `${left}-br`,
    right,
    leftText: 'ab',
    rightText: 'cd',
    time,
  })

  it('are never merged with typing and clear redo', () => {
    let h: History<string, string> = emptyHistory()
    h = record(h, entry('a', 'x', 'xy', 0))
    h = record(h, brk('a', 'a2', 10))
    h = record(h, entry('a', 'ab', 'abz', 20))
    expect(h.undo.map((e) => e.kind)).toEqual(['typing', 'break', 'typing'])
  })

  it('move with their nodes, and a missing <br> makes the move fail', () => {
    const h = record(emptyHistory<string, string>(), brk('a', 'a2', 0))
    expect(
      mapNodes(
        h,
        (n) => `${n}!`,
        (b) => `${b}!`,
      )?.undo,
    ).toMatchObject([{ left: 'a!', right: 'a2!', br: 'a-br!' }])
    expect(
      mapNodes(
        h,
        (n) => n,
        () => undefined,
      ),
    ).toBeUndefined()
  })

  it('filterEntries drops parts, and a group as a whole', () => {
    let h: History<string, string> = emptyHistory()
    h = record(h, entry('a', 'x', 'y', 0))
    h = record(h, {
      kind: 'group',
      entries: [brk('b', 'b2', 10), entry('b', 'p', 'q', 10)],
      time: 10,
    })
    h = record(h, entry('c', 'm', 'n', 2000))
    const kept = filterEntries(h, (part) => (part.kind === 'break' ? part.left : part.node) !== 'b')
    expect(kept.undo.map((e) => e.kind)).toEqual(['typing', 'typing'])
    expect(kept.undo).toMatchObject([{ node: 'a' }, { node: 'c' }])
  })

  it('mapValues rewrites text inside groups only', () => {
    const h = record(emptyHistory<string, string>(), {
      kind: 'group',
      entries: [brk('b', 'b2', 0), entry('b', 'p', 'q', 0)],
      time: 0,
    })
    const mapped = mapValues(h, (_, v) => v.toUpperCase()).undo[0]
    expect(mapped).toMatchObject({
      kind: 'group',
      entries: [
        { kind: 'break', leftText: 'ab' },
        { before: 'P', after: 'Q' },
      ],
    })
  })
})
