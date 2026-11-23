import { describe, expect, it } from 'vitest'
import { parseDocument } from '../src/document'
import { prepareSave } from '../src/save'
import { recordContaining, NBSP } from './helpers'

const src = '<!doctype html><body><p id="a">alpha</p><p id="b">be&amp;ta</p><p id="c">gamma</p>'

describe('prepareSave', () => {
  it('returns the source unchanged when there are no edits', () => {
    const doc = parseDocument(src)
    const result = prepareSave(doc, [])
    expect(result.ok && result.source).toBe(src)
  })

  it('applies several edits and returns expected values', () => {
    const doc = parseDocument(src)
    const a = recordContaining(doc, 'alpha')
    const c = recordContaining(doc, 'gamma')
    const result = prepareSave(doc, [
      { recordId: a.id, value: 'ALPHA' },
      { recordId: c.id, value: `gam${NBSP}ma` },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source).toBe(src.replace('alpha', 'ALPHA').replace('gamma', 'gam ma'))
    expect(result.patches).toHaveLength(2)
    expect(result.expectedValues.get(c.id)).toEqual(['gam ma'])
  })

  it('ignores edits whose value equals the original', () => {
    const doc = parseDocument(src)
    const a = recordContaining(doc, 'alpha')
    const result = prepareSave(doc, [{ recordId: a.id, value: 'alpha' }])
    expect(result.ok && result.patches).toEqual([])
  })

  it('refuses edits to non-editable records', () => {
    const doc = parseDocument('<!doctype html><body><script>x()</script><p>a</p>')
    const script = recordContaining(doc, 'x()')
    const result = prepareSave(doc, [{ recordId: script.id, value: 'y()' }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('non-editable')
  })

  it('refuses unknown record ids', () => {
    const result = prepareSave(parseDocument(src), [{ recordId: 999, value: 'x' }])
    expect(result.ok || result.error.code).toBe('unknown-record')
  })

  it('fails verification when a fault is injected, and reports where (AC-08)', () => {
    const doc = parseDocument(src)
    const a = recordContaining(doc, 'alpha')
    const result = prepareSave(doc, [{ recordId: a.id, value: 'ALPHA' }], {
      fault: 'corrupt-structure',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('verification-failed')
    expect(result.error.issues.length).toBeGreaterThan(0)
    expect(result.error.issues[0]?.path).toMatch(/p/)
  })

  describe('emptied text nodes', () => {
    it('removes the text and keeps the element (no <br>, AC-06)', () => {
      const doc = parseDocument(src)
      const b = recordContaining(doc, 'be&ta')
      const result = prepareSave(doc, [{ recordId: b.id, value: '' }])
      expect(result.ok && result.source).toBe(src.replace('be&amp;ta', ''))
    })

    it('keeps a virtual record in the next document so that it can be refilled', () => {
      const doc = parseDocument(src)
      const b = recordContaining(doc, 'be&ta')
      const first = prepareSave(doc, [{ recordId: b.id, value: '' }])
      if (!first.ok) throw new Error(first.error.message)
      const next = first.document
      expect(next.source).toBe(first.source)
      const virtual = next.records.filter((r) => r.virtual)
      expect(virtual).toHaveLength(1)
      expect(virtual[0]?.value).toBe('')
      expect(next.records).toHaveLength(doc.records.length)

      // Undo after save: put the text back, save again -> byte-identical to the original.
      const second = prepareSave(next, [{ recordId: virtual[0]?.id ?? -1, value: 'be&ta' }])
      expect(second.ok && second.source).toBe(src)
    })
  })

  it('rebuilds the next document on the new source with the same structure', () => {
    const doc = parseDocument(src)
    const a = recordContaining(doc, 'alpha')
    const result = prepareSave(doc, [{ recordId: a.id, value: 'ALPHA!' }])
    if (!result.ok) throw new Error(result.error.message)
    expect(result.document.records.map((r) => r.value)).toEqual(['ALPHA!', 'be&ta', 'gamma'])
    // Saving the next document again without edits is a no-op.
    const again = prepareSave(result.document, [])
    expect(again.ok && again.source).toBe(result.source)
  })
})

describe('new <br> line breaks (lines)', () => {
  const save = (source: string, needle: string, lines: readonly string[]) => {
    const doc = parseDocument(source)
    const record = recordContaining(doc, needle)
    const result = prepareSave(doc, [{ recordId: record.id, value: lines }])
    if (!result.ok) throw new Error(result.error.message)
    return result
  }

  it('splits a text node with <br> and changes nothing else', () => {
    const result = save(src, 'alpha', ['al', 'pha'])
    expect(result.source).toBe(src.replace('alpha', 'al<br>pha'))
    const at = src.indexOf('alpha') + 2
    expect(result.patches).toEqual([{ start: at, end: at, text: '<br>' }])
    expect(result.expectedValues.get(recordContaining(parseDocument(src), 'alpha').id)).toEqual([
      'al',
      'pha',
    ])
  })

  it('keeps the notation of untouched characters on both sides', () => {
    const result = save(src, 'be&ta', ['be&', 'ta'])
    expect(result.source).toBe(src.replace('be&amp;ta', 'be&amp;<br>ta'))
  })

  it('combines typing and line breaks', () => {
    const result = save(src, 'gamma', ['ga', 'm&', '', 'ma'])
    expect(result.source).toBe(src.replace('gamma', 'ga<br>m&amp;<br><br>ma'))
  })

  it('follows the line break notation of the file', () => {
    const source = '<!doctype html><body><p>a<br />b</p><p>cd</p>'
    expect(save(source, 'cd', ['c', 'd']).source).toBe(source.replace('cd', 'c<br />d'))
    const upper = '<!doctype html><body><p>a<BR>b</p><p>cd</p>'
    expect(save(upper, 'cd', ['c', 'd']).source).toBe(upper.replace('cd', 'c<BR>d'))
  })

  it('a line break at the end leaves a virtual line that can be typed into after saving', () => {
    const first = save(src, 'alpha', ['alpha', ''])
    expect(first.source).toBe(src.replace('alpha', 'alpha<br>'))
    const next = first.document
    // alpha, (br), virtual line, be&ta, gamma
    const virtual = next.records.filter((r) => r.virtual)
    expect(virtual).toHaveLength(1)
    const anchor = virtual[0]
    if (!anchor) throw new Error('no virtual record')
    expect(next.source.slice(0, anchor.start).endsWith('alpha<br>')).toBe(true)
    const second = prepareSave(next, [{ recordId: anchor.id, value: 'X' }])
    expect(second.ok && second.source).toBe(src.replace('alpha', 'alpha<br>X'))
  })

  it('a line break at the start leaves a virtual first line before the <br>', () => {
    const first = save(src, 'alpha', ['', 'alpha'])
    expect(first.source).toBe(src.replace('alpha', '<br>alpha'))
    const anchor = first.document.records.find((r) => r.virtual)
    if (!anchor) throw new Error('no virtual record')
    const second = prepareSave(first.document, [{ recordId: anchor.id, value: 'Y' }])
    expect(second.ok && second.source).toBe(src.replace('alpha', 'Y<br>alpha'))
  })

  it('the next document has one record per line', () => {
    const result = save(src, 'alpha', ['al', 'pha'])
    expect(result.document.records.map((r) => r.value)).toEqual(['al', 'pha', 'be&ta', 'gamma'])
    const again = prepareSave(result.document, [])
    expect(again.ok && again.source).toBe(result.source)
  })

  it('a <br> in foster-parented text follows the text out of the table, as the browser does', () => {
    const source = '<!doctype html><body><table>xy<tr><td>c</td></tr></table>'
    expect(save(source, 'xy', ['x', 'y']).source).toBe(source.replace('xy', 'x<br>y'))
  })
})
