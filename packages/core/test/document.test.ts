import { describe, expect, it } from 'vitest'
import { parseDocument } from '../src/document'
import type { DocElement, DocNode } from '../src/types'
import { editable, fixtureNames, loadFixture, recordContaining } from './helpers'

const elements = (nodes: readonly DocNode[]): DocElement[] =>
  nodes.flatMap((n) => (n.kind === 'element' ? [n, ...elements(n.children)] : []))

describe('parseDocument', () => {
  it('creates one record per text node, in document order', () => {
    const doc = parseDocument('<!doctype html><p>a<b>b</b>c</p>')
    expect(doc.records.map((r) => r.value)).toEqual(['a', 'b', 'c'])
    expect(doc.records.map((r) => r.id)).toEqual([0, 1, 2])
    for (const r of doc.records) expect(doc.source.slice(r.start, r.end)).toBe(r.value)
  })

  it('maps references and CRLF so that segments reproduce the value', () => {
    const doc = parseDocument('<!doctype html><p>a&amp;b\r\nc&copy</p>')
    const [r] = doc.records
    expect(r?.value).toBe('a&b\nc©')
    expect(r?.status).toBe('editable')
  })

  it('parses <noscript> content as elements (scriptingEnabled: false)', () => {
    const doc = parseDocument('<!doctype html><body><noscript><p>x</p></noscript>')
    expect(elements(doc.tree.children).some((e) => e.tagName === 'p')).toBe(true)
    expect(recordContaining(doc, 'x').status).toBe('editable')
  })

  it('reports quirks mode for documents without doctype (matches a blob: iframe)', () => {
    expect(parseDocument('<p>x').tree.mode).toBe('quirks')
    expect(parseDocument('<!doctype html><p>x').tree.mode).toBe('no-quirks')
  })

  it.each([
    ['<!doctype html><head><title>t</title></head><body>x', 't'],
    ['<!doctype html><body><script>var s</script>', 'var s'],
    ['<!doctype html><body><style>p{}</style>', 'p{}'],
    ['<!doctype html><body><textarea>ta</textarea>', 'ta'],
    ['<!doctype html><body><select><option>op</option></select>', 'op'],
    ['<!doctype html><body><button>bt</button>', 'bt'],
    ['<!doctype html><body><svg><text>sv</text></svg>', 'sv'],
    ['<!doctype html><body><math><mi>mi</mi></math>', 'mi'],
  ])('excludes text in non-editable contexts: %s', (src, text) => {
    expect(recordContaining(parseDocument(src), text).status).toBe('excluded-context')
  })

  it('keeps template content out of records and in templateContent', () => {
    const doc = parseDocument('<!doctype html><body><template><p>tpl</p></template>')
    expect(doc.records.some((r) => r.value === 'tpl')).toBe(false)
    const tpl = elements(doc.tree.children).find((e) => e.tagName === 'template')
    expect(tpl?.children).toEqual([])
    expect(tpl?.templateContent?.length).toBe(1)
  })

  it('marks whitespace-only text as whitespace', () => {
    const doc = parseDocument('<!doctype html><body><p>a</p>\n  <p>b</p>')
    expect(doc.records.filter((r) => r.status === 'whitespace').length).toBeGreaterThan(0)
  })

  it('treats text merged across ignored markup as mapping-mismatch', () => {
    // parse5 merges "foo" and "bar" into one node spanning "</span>"
    expect(
      recordContaining(parseDocument('<!doctype html><p>foo</span>bar</p>'), 'foobar').status,
    ).toBe('mapping-mismatch')
  })

  it('treats text containing NUL as mapping-mismatch', () => {
    expect(recordContaining(parseDocument('<!doctype html><p>z\0z</p>'), 'zz').status).toBe(
      'mapping-mismatch',
    )
  })

  it('handles the ignored leading newline of <pre>', () => {
    const doc = parseDocument('<!doctype html><pre>\nA\nB</pre>')
    const r = recordContaining(doc, 'A')
    expect(r.value).toBe('A\nB')
    expect(r.status).toBe('editable')
    expect(r.preformatted).toBe(true)
  })

  it('handles a <pre> whose location includes the ignored newline (two leading newlines)', () => {
    for (const nl of ['\n', '\r\n']) {
      const doc = parseDocument(`<!doctype html><pre>${nl}${nl}A</pre>`)
      const r = recordContaining(doc, 'A')
      expect(r.value).toBe('\nA')
      expect(r.status).toBe('editable')
      expect(doc.source.slice(r.start, r.end)).toBe(`${nl}A`)
      expect(r.leadingNewlineDropped).toBe(false)
    }
  })

  it('builds location labels from the preceding heading and ancestors', () => {
    const doc = parseDocument(
      '<!doctype html><body><section><h2>1. 背景と目的</h2><p class="lead">本文</p><div class="card"><p>カード</p></div>' +
        '<table><tbody><tr><td>セル</td></tr></tbody></table></section>',
    )
    expect(recordContaining(doc, '本文').label).toBe('1. 背景と目的 › p')
    expect(recordContaining(doc, 'カード').label).toBe('1. 背景と目的 › .card › p')
    expect(recordContaining(doc, 'セル').label).toBe('1. 背景と目的 › table › td')
  })

  it.each(fixtureNames())(
    'parses %s with editable records whose segments are consistent',
    (name) => {
      const { doc } = loadFixture(name)
      expect(editable(doc).length).toBeGreaterThan(0)
      for (const r of editable(doc)) {
        let dom = 0
        let src = r.start
        for (const s of r.segments) {
          expect(s.domStart).toBe(dom)
          expect(s.srcStart).toBe(src)
          dom = s.domEnd
          src = s.srcEnd
        }
        expect(dom).toBe(r.value.length)
        expect(src).toBe(r.end)
      }
    },
  )
})
