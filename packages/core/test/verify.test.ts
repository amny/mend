import { describe, expect, it } from 'vitest'
import { parseDocument } from '../src/document'
import { verifySave } from '../src/verify'
import { recordContaining } from './helpers'

const src =
  '<!doctype html><body><section><p class="x" id="a">alpha</p><p>beta</p></section><!--c-->'

describe('verifySave', () => {
  const doc = parseDocument(src)
  const a = recordContaining(doc, 'alpha')
  const expected = new Map([[a.id, ['ALPHA']]])
  const good = src.replace('alpha', 'ALPHA')
  const patch = { start: a.start, end: a.end, text: 'ALPHA' }

  it('accepts a correct result', () => {
    expect(verifySave(doc, good, expected, [patch])).toEqual({ ok: true })
  })

  it.each([
    ['text mismatch', src.replace('alpha', 'ALPHB'), 'text'],
    ['extra element', src.replace('alpha', 'AL<b>PHA</b>'), 'child-count'],
    ['text replaced by element', src.replace('alpha', '<b>ALPHA</b>'), 'node-kind'],
    ['attribute order', good.replace('class="x" id="a"', 'id="a" class="x"'), 'attributes'],
    ['attribute value', good.replace('class="x"', 'class="y"'), 'attributes'],
    ['comment', good.replace('<!--c-->', '<!--d-->'), 'comment'],
    ['tag name', good.replace('<p>beta</p>', '<div>beta</div>'), 'tag-name'],
    ['document mode', good.replace('<!doctype html>', ''), 'document-mode'],
  ])('rejects %s', (_label, newSource, kind) => {
    const result = verifySave(doc, newSource, expected, [
      { ...patch, text: newSource.slice(a.start, a.end) },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((i) => i.kind)).toContain(kind)
  })

  it('rejects changes outside the patched ranges even if the tree matches', () => {
    const sneaky = good.replace('<p>beta', '<p >beta')
    const result = verifySave(doc, sneaky, expected, [patch])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((i) => i.kind)).toContain('outside-patch')
  })

  it('describes the location of an issue as a CSS-like path', () => {
    const result = verifySave(
      doc,
      src.replace('<p>beta</p>', '<p>beta</p><p>gamma</p>'),
      new Map(),
      [],
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    const issue = result.issues.find((i) => i.kind === 'child-count')
    expect(issue?.path).toBe('section')
    expect(issue?.expected).toBe('2')
    expect(issue?.actual).toBe('3')
  })
})
