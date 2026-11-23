// AC-01..03 (and the core part of AC-09 / AC-11) over every fixture.
import { describe, expect, it } from 'vitest'
import { encodeUtf8 } from '../src/encoding'
import { prepareSave } from '../src/save'
import type { MendDocument, TextRecord } from '../src/types'
import {
  after,
  before,
  diffConfinedTo,
  editable,
  fixtureNames,
  insertAt,
  loadFixture,
  recordContaining,
  removeRange,
  NBSP,
} from './helpers'

/** Up to `limit` editable records spread over the document. */
function sample(doc: MendDocument, limit: number): readonly TextRecord[] {
  const all = editable(doc)
  if (all.length <= limit) return all
  const step = all.length / limit
  return Array.from({ length: limit }, (_, i) => all[Math.floor(i * step)]).filter(
    (r): r is TextRecord => r !== undefined,
  )
}

/** A code-point-safe middle offset. */
function middle(value: string): number {
  const cps = Array.from(value)
  return cps.slice(0, Math.floor(cps.length / 2)).join('').length
}

const edits: ReadonlyArray<readonly [string, (v: string) => string]> = [
  ['insert', (v) => insertAt(v, middle(v), '修正')],
  [
    'delete',
    (v) =>
      v.length > 1
        ? removeRange(v, middle(v), middle(v) + (Array.from(v.slice(middle(v)))[0]?.length ?? 1))
        : '',
  ],
  ['replace all', () => '全部置き換え'],
  ['empty', () => ''],
]

/**
 * Edits that must be refused by verification (never saved). Emptying a text node can change how the
 * parser rebuilds malformed markup, e.g. the <i> cloned by the adoption agency disappears with its text.
 */
const expectedRefusals: ReadonlyArray<{ fixture: string; value: string; edit: string }> = [
  { fixture: 'malformed.html', value: 'の続き', edit: 'empty' },
]

const isExpectedRefusal = (fixture: string, value: string, edit: string): boolean =>
  expectedRefusals.some((r) => r.fixture === fixture && r.value === value && r.edit === edit)

describe.each(fixtureNames())('%s', (name) => {
  const { doc, hasBom, bytes } = loadFixture(name)

  it('AC-01: saving without edits is byte-identical', () => {
    const result = prepareSave(doc, [])
    if (!result.ok) throw new Error(result.error.message)
    expect(encodeUtf8(result.source, hasBom)).toEqual(bytes)
  })

  it('AC-02: a single edit changes only that text range', { timeout: 30_000 }, () => {
    // large is ~1MB (about 0.1s per save), so it gets a smaller sample.
    for (const record of sample(doc, name === 'large.html' ? 8 : 40)) {
      for (const [label, edit] of edits) {
        const value = edit(record.value)
        const result = prepareSave(doc, [{ recordId: record.id, value }])
        if (isExpectedRefusal(name, record.value, label)) {
          expect(result.ok || result.error.code).toBe('verification-failed')
          continue
        }
        if (!result.ok) {
          throw new Error(
            `${label} on ${JSON.stringify(record.value)} failed: ${result.error.message}`,
          )
        }
        expect(
          diffConfinedTo(doc.source, result.source, record.start, record.end),
          `${label} ${record.label}`,
        ).toBe(true)
      }
    }
  })

  it('AC-09 (core): undoing everything saves byte-identical', () => {
    const records = sample(doc, 10)
    const changed = prepareSave(
      doc,
      records.map((r) => ({ recordId: r.id, value: r.value + 'x' })),
    )
    if (!changed.ok) throw new Error(changed.error.message)
    const reverted = prepareSave(
      doc,
      records.map((r) => ({ recordId: r.id, value: r.value })),
    )
    expect(reverted.ok && encodeUtf8(reverted.source, hasBom)).toEqual(bytes)
  })

  it('AC-11 (core): reverting one edit keeps it byte-identical and leaves the others', () => {
    const records = sample(doc, 3)
    if (records.length < 2) return
    const [first, ...rest] = records
    if (!first) return
    const result = prepareSave(doc, [
      { recordId: first.id, value: first.value },
      ...rest.map((r) => ({ recordId: r.id, value: r.value + '追加' })),
    ])
    if (!result.ok) throw new Error(result.error.message)
    expect(result.source.slice(0, first.end)).toBe(doc.source.slice(0, first.end))
    for (const r of rest) expect(result.document.records[r.id]?.value).toBe(r.value + '追加')
  })
})

describe('AC-03: editing next to a reference keeps its notation', () => {
  const { doc } = loadFixture('entities.html')
  const record = recordContaining(doc, 'あ&い')
  const refs = ['&amp;', '&nbsp;', '&#x3048;', '&copy']

  it.each([
    ['insert after &', (v: string) => insertAt(v, after(v, '&'), 'X')],
    ['insert before &', (v: string) => insertAt(v, before(v, '&'), 'X')],
    ['insert after nbsp', (v: string) => insertAt(v, after(v, `${NBSP}`), 'X')],
    ['insert before え', (v: string) => insertAt(v, before(v, 'え'), 'X')],
    ['insert after ©', (v: string) => insertAt(v, after(v, '©'), 'X')],
    ['delete char after &', (v: string) => removeRange(v, after(v, '&'), after(v, '&') + 1)],
    ['delete char before ©', (v: string) => removeRange(v, before(v, '©') - 1, before(v, '©'))],
  ])('%s', (_label, edit) => {
    const result = prepareSave(doc, [{ recordId: record.id, value: edit(record.value) }])
    if (!result.ok) throw new Error(result.error.message)
    const nodeSource = result.source.slice(
      record.start,
      record.end + (result.source.length - doc.source.length),
    )
    for (const ref of refs) expect(nodeSource).toContain(ref)
  })

  it('keeps every reference in the file when editing each paragraph', () => {
    for (const r of editable(doc)) {
      const result = prepareSave(doc, [{ recordId: r.id, value: r.value + '!' }])
      if (!result.ok) throw new Error(`${r.label}: ${result.error.message}`)
      expect(result.source.slice(0, r.end)).toBe(doc.source.slice(0, r.end))
    }
  })
})

describe('performance (large.html, ~1MB)', () => {
  it('parses and saves 20 edits within 1 second each', () => {
    const t0 = performance.now()
    const { doc } = loadFixture('large.html')
    const t1 = performance.now()
    const result = prepareSave(
      doc,
      sample(doc, 20).map((r) => ({ recordId: r.id, value: r.value + '修正' })),
    )
    const t2 = performance.now()
    expect(result.ok).toBe(true)
    expect(t1 - t0).toBeLessThan(1000)
    expect(t2 - t1).toBeLessThan(1000)
  })
})
