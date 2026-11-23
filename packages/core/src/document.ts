// Parses the source with parse5 and derives the document tree and text records (requirements 5.1-5.3).
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { decodeText } from './decodeText'
import { buildLabel, normalizeHeading, type AncestorInfo } from './label'
import type {
  DocAttribute,
  DocDocument,
  DocElement,
  DocNode,
  DocText,
  DocumentMode,
  MendDocument,
  TextRecord,
  TextRecordStatus,
} from './types'

type P5Node = DefaultTreeAdapterMap['node']
type P5ChildNode = DefaultTreeAdapterMap['childNode']
type P5Element = DefaultTreeAdapterMap['element']
type P5Text = DefaultTreeAdapterMap['textNode']
type P5ParentNode = DefaultTreeAdapterMap['parentNode']
type P5Template = DefaultTreeAdapterMap['template']

const HTML_NS = 'http://www.w3.org/1999/xhtml'

/** Fixed parser options (CLAUDE.md: never change these). */
export const PARSE_OPTIONS = { sourceCodeLocationInfo: true, scriptingEnabled: false } as const

/** Elements whose text is never editable (requirements 5.2 + decisions in M1). */
const EXCLUDED_TAGS = new Set([
  'head',
  'script',
  'style',
  'template',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
  'select',
  'option',
  'optgroup',
  'button',
])

const PREFORMATTED_TAGS = new Set(['pre', 'listing', 'textarea', 'plaintext'])
const NEWLINE_DROPPING_TAGS = new Set(['pre', 'listing', 'textarea'])
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const ASCII_WHITESPACE_ONLY = /^[ \t\n\f\r]*$/

/**
 * What an old text node became in the new tree: new nodes (text or <br>) and virtual (emptied) text nodes.
 * A virtual part without `anchor` sits next to a new <br> and is anchored at its edge.
 */
export type RebasePart =
  { readonly kind: 'node' } | { readonly kind: 'virtual'; readonly anchor?: number }

/** Old-tree counterpart used when rebuilding after a save, to keep emptied text nodes as virtual nodes. */
export interface RebaseContext {
  readonly oldChildren: readonly DocNode[]
  /** The parts an old text node became, or undefined when it is one new node as before. */
  readonly expand: (oldRecordId: number) => readonly RebasePart[] | undefined
}

interface WalkContext {
  readonly excluded: boolean
  readonly preformatted: boolean
  readonly ancestors: readonly AncestorInfo[]
}

const leadingNewlineLength = (source: string, at: number): number =>
  source.startsWith('\r\n', at) ? 2 : source[at] === '\n' || source[at] === '\r' ? 1 : 0

const isElement = (n: P5Node): n is P5Element => 'tagName' in n
const isText = (n: P5Node): n is P5Text => n.nodeName === '#text'
const isTemplate = (n: P5Element): n is P5Template => n.tagName === 'template' && 'content' in n

function textContent(node: P5Node): string {
  if (isText(node)) return node.value
  if ('childNodes' in node) return node.childNodes.map(textContent).join('')
  return ''
}

function firstClass(el: P5Element): string | undefined {
  const cls = el.attrs.find((a) => a.name === 'class')?.value.trim()
  return cls ? cls.split(/\s+/)[0] : undefined
}

function toAttributes(el: P5Element): readonly DocAttribute[] {
  return el.attrs.map((a) => ({
    name: a.name,
    value: a.value,
    ...(a.namespace !== undefined ? { namespace: a.namespace } : {}),
    ...(a.prefix !== undefined ? { prefix: a.prefix } : {}),
  }))
}

export type ParsedSource = DefaultTreeAdapterMap['document']

export function parseSource(source: string): ParsedSource {
  return parse(source, PARSE_OPTIONS)
}

const DOCUMENT_MODES: Readonly<Record<string, DocumentMode>> = {
  'no-quirks': 'no-quirks',
  quirks: 'quirks',
  'limited-quirks': 'limited-quirks',
}

/**
 * Builds a MendDocument. With `rebase`, emptied nodes of the previous document are kept as virtual nodes.
 * `parsed` may be passed to reuse a parse of the same source.
 */
export function buildDocument(
  source: string,
  rebase?: RebaseContext,
  parsed: ParsedSource = parseSource(source),
): MendDocument {
  const p5doc = parsed
  const mode = DOCUMENT_MODES[p5doc.mode]
  if (!mode) throw new Error(`Mend: unknown document mode "${p5doc.mode}"`)
  const records: TextRecord[] = []
  let lastHeading: string | undefined

  const addRecord = (fields: Omit<TextRecord, 'id'>): number => {
    const id = records.length
    records.push({ id, ...fields })
    return id
  }

  function convertText(
    node: P5Text,
    parent: P5ParentNode,
    index: number,
    ctx: WalkContext,
  ): DocText {
    const loc = node.sourceCodeLocation
    const label = buildLabel(lastHeading, ctx.ancestors)
    const base = { preformatted: ctx.preformatted, label, virtual: false }
    if (!loc) {
      const id = addRecord({
        ...base,
        value: node.value,
        start: 0,
        end: 0,
        segments: [],
        status: 'mapping-mismatch',
        leadingNewlineDropped: false,
      })
      return { kind: 'text', value: node.value, recordId: id }
    }
    const parentStartTagEnd =
      isElement(parent) && NEWLINE_DROPPING_TAGS.has(parent.tagName) && index === 0
        ? parent.sourceCodeLocation?.startTag?.endOffset
        : undefined
    // In <pre>/<listing>/<textarea>, parse5 sometimes includes the ignored leading newline in the location.
    const ignoredNewline =
      parentStartTagEnd === loc.startOffset ? leadingNewlineLength(source, loc.startOffset) : 0
    const start = loc.startOffset + ignoredNewline
    const decoded = decodeText(source.slice(start, loc.endOffset), start)
    const mapped = decoded.value === node.value && !decoded.markup
    const status: TextRecordStatus = ctx.excluded
      ? 'excluded-context'
      : ASCII_WHITESPACE_ONLY.test(node.value)
        ? 'whitespace'
        : mapped
          ? 'editable'
          : 'mapping-mismatch'
    const id = addRecord({
      ...base,
      value: node.value,
      start,
      end: loc.endOffset,
      segments: mapped ? decoded.segments : [],
      status,
      leadingNewlineDropped: parentStartTagEnd === start,
    })
    return { kind: 'text', value: node.value, recordId: id }
  }

  function virtualText(
    anchor: number,
    parent: P5ParentNode,
    index: number,
    ctx: WalkContext,
  ): DocText {
    const parentStartTagEnd =
      isElement(parent) && NEWLINE_DROPPING_TAGS.has(parent.tagName) && index === 0
        ? parent.sourceCodeLocation?.startTag?.endOffset
        : undefined
    const id = addRecord({
      value: '',
      start: anchor,
      end: anchor,
      segments: [],
      status: ctx.excluded ? 'excluded-context' : 'editable',
      preformatted: ctx.preformatted,
      label: buildLabel(lastHeading, ctx.ancestors),
      virtual: true,
      leadingNewlineDropped: parentStartTagEnd === anchor,
    })
    return { kind: 'text', value: '', recordId: id }
  }

  function convertElement(el: P5Element, ctx: WalkContext, old: DocNode | undefined): DocElement {
    if (el.namespaceURI === HTML_NS && HEADING_TAGS.has(el.tagName)) {
      lastHeading = normalizeHeading(textContent(el)) ?? lastHeading
    }
    const childCtx: WalkContext = {
      excluded: ctx.excluded || el.namespaceURI !== HTML_NS || EXCLUDED_TAGS.has(el.tagName),
      preformatted: ctx.preformatted || PREFORMATTED_TAGS.has(el.tagName),
      ancestors: [...ctx.ancestors, { tagName: el.tagName, className: firstClass(el) }],
    }
    const oldElement = old?.kind === 'element' ? old : undefined
    const children = convertChildren(el, childCtx, oldElement?.children)
    const base = {
      kind: 'element' as const,
      tagName: el.tagName,
      namespace: el.namespaceURI,
      attrs: toAttributes(el),
      children,
    }
    if (isTemplate(el)) {
      return { ...base, templateContent: el.content.childNodes.map(convertTemplateNode) }
    }
    return base
  }

  /** Template content is inert and not part of the DOM tree; it gets no records. */
  function convertTemplateNode(node: P5ChildNode): DocNode {
    if (isText(node)) return { kind: 'text', value: node.value, recordId: -1 }
    if (isElement(node)) {
      const base = {
        kind: 'element' as const,
        tagName: node.tagName,
        namespace: node.namespaceURI,
        attrs: toAttributes(node),
        children: node.childNodes.map(convertTemplateNode),
      }
      return isTemplate(node)
        ? { ...base, templateContent: node.content.childNodes.map(convertTemplateNode) }
        : base
    }
    return convertLeaf(node)
  }

  function convertLeaf(node: P5ChildNode): DocNode {
    if (node.nodeName === '#comment' && 'data' in node) return { kind: 'comment', data: node.data }
    if (node.nodeName === '#documentType' && 'name' in node) {
      return { kind: 'doctype', name: node.name, publicId: node.publicId, systemId: node.systemId }
    }
    throw new Error(`Mend: unexpected parse5 node type "${node.nodeName}"`)
  }

  function convertChild(
    node: P5ChildNode,
    parent: P5ParentNode,
    index: number,
    ctx: WalkContext,
    old: DocNode | undefined,
  ): DocNode {
    if (isText(node)) return convertText(node, parent, index, ctx)
    if (isElement(node)) return convertElement(node, ctx, old)
    return convertLeaf(node)
  }

  function convertChildren(
    parent: P5ParentNode,
    ctx: WalkContext,
    oldChildren: readonly DocNode[] | undefined,
  ): DocNode[] {
    const nodes = parent.childNodes
    if (!rebase || oldChildren === undefined) {
      return nodes.map((n, i) => convertChild(n, parent, i, ctx, undefined))
    }
    // Walk old children; emptied old text nodes become virtual nodes, split ones their lines and <br>s, everything
    // else consumes a new node.
    const out: DocNode[] = []
    let j = 0
    const take = (oldChild: DocNode | undefined): void => {
      const node = nodes[j]
      if (!node) throw new Error('Mend: rebase failed: new tree has fewer children than expected')
      out.push(convertChild(node, parent, out.length, ctx, oldChild))
      j += 1
    }
    const edge = (node: P5ChildNode | undefined, side: 'start' | 'end'): number => {
      const loc = node?.sourceCodeLocation
      if (!loc) throw new Error('Mend: rebase failed: no source location next to an emptied line')
      return side === 'start' ? loc.startOffset : loc.endOffset
    }
    for (const oldChild of oldChildren) {
      const parts = oldChild.kind === 'text' ? rebase.expand(oldChild.recordId) : undefined
      if (!parts) {
        take(oldChild)
        continue
      }
      parts.forEach((part, k) => {
        if (part.kind === 'node') {
          take(undefined)
          return
        }
        // An emptied line: after the previous new node (a <br>), or before the next one.
        const anchor = part.anchor ?? (k > 0 ? edge(nodes[j - 1], 'end') : edge(nodes[j], 'start'))
        out.push(virtualText(anchor, parent, out.length, ctx))
      })
    }
    if (j !== nodes.length)
      throw new Error('Mend: rebase failed: new tree has more children than expected')
    return out
  }

  const rootCtx: WalkContext = { excluded: false, preformatted: false, ancestors: [] }
  const tree: DocDocument = {
    kind: 'document',
    mode,
    children: convertChildren(p5doc, rootCtx, rebase?.oldChildren),
  }
  return { source, tree, records }
}

export function parseDocument(source: string): MendDocument {
  return buildDocument(source)
}
