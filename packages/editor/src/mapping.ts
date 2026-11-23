// Walks the iframe DOM and the core document tree in parallel and pairs text nodes with records (requirements 5.2).
import type { DocNode, MendDocument } from '@mend/core'

export interface NodeMap {
  /** Text node -> record id (every line of a text split by new <br>s maps to the same record). */
  readonly recordOf: ReadonlyMap<Text, number>
  /** Record id -> text node (the first line). */
  readonly nodeOf: readonly (Text | undefined)[]
  /** Record id -> its lines, for texts split by new <br>s only (first line included). */
  readonly linesOf: ReadonlyMap<number, readonly Text[]>
}

export interface MappingMismatch {
  /** CSS-like path of the first mismatch, e.g. "html > body > div:nth-child(2)". */
  readonly path: string
  readonly reason: string
}

export type MappingResult =
  | { readonly ok: true; readonly map: NodeMap }
  | { readonly ok: false; readonly mismatch: MappingMismatch }

const describeDom = (n: Node): string =>
  n.nodeType === Node.ELEMENT_NODE ? `<${(n as Element).localName}>` : n.nodeName

const describeDoc = (n: DocNode): string =>
  n.kind === 'element' ? `<${n.tagName}>` : n.kind === 'text' ? '#text' : `#${n.kind}`

class Mismatch extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${reason} at ${path}`)
  }
}

/**
 * Builds the node map. `checkText` compares text values too (on first load; after a save the user may have
 * typed while the file was being written, so only the structure is compared).
 */
export function mapNodes(
  doc: Document,
  mend: MendDocument,
  checkText: boolean,
  /** <br> elements inserted by the editor (not in the source): each is followed by the next line's text node. */
  isNewBreak: (node: Node) => boolean = () => false,
): MappingResult {
  const recordOf = new Map<Text, number>()
  const nodeOf: (Text | undefined)[] = new Array<Text | undefined>(mend.records.length)
  const linesOf = new Map<number, readonly Text[]>()

  const walk = (domParent: Node, docChildren: readonly DocNode[], path: string): void => {
    const domChildren = domParent.childNodes
    if (domChildren.length < docChildren.length) {
      throw new Mismatch(
        path,
        `child count differs (DOM ${domChildren.length}, source ${docChildren.length})`,
      )
    }
    // DOM position: a text split by new <br>s takes more DOM children than its one source node.
    let k = 0
    docChildren.forEach((d, i) => {
      const n = domChildren[k]
      k += 1
      if (!n) throw new Mismatch(path, `missing DOM child ${i}`)
      const here = `${path}${path ? ' > ' : ''}${describeDoc(d)}:nth-child(${i + 1})`
      switch (d.kind) {
        case 'text': {
          // nodeType, not instanceof: the nodes belong to the iframe's realm.
          if (n.nodeType !== Node.TEXT_NODE) {
            throw new Mismatch(here, `expected text, found ${describeDom(n)}`)
          }
          const text = n as Text
          if (checkText && text.data !== d.value) throw new Mismatch(here, 'text differs')
          if (d.recordId >= 0) {
            recordOf.set(text, d.recordId)
            nodeOf[d.recordId] = text
          }
          const lines = [text]
          for (let br = domChildren[k]; br && isNewBreak(br); br = domChildren[k]) {
            const next = domChildren[k + 1]
            if (d.recordId < 0 || next?.nodeType !== Node.TEXT_NODE) {
              throw new Mismatch(here, 'a new <br> is not between two lines of an editable text')
            }
            lines.push(next as Text)
            recordOf.set(next as Text, d.recordId)
            k += 2
          }
          if (lines.length > 1) linesOf.set(d.recordId, lines)
          return
        }
        case 'element': {
          if (n.nodeType !== Node.ELEMENT_NODE) {
            throw new Mismatch(here, `expected <${d.tagName}>, found ${describeDom(n)}`)
          }
          const el = n as Element
          if (el.localName !== d.tagName || el.namespaceURI !== d.namespace) {
            throw new Mismatch(here, `expected <${d.tagName}>, found ${describeDom(n)}`)
          }
          walk(el, d.children, here)
          return
        }
        case 'comment':
          if (n.nodeType !== Node.COMMENT_NODE || (checkText && (n as Comment).data !== d.data)) {
            throw new Mismatch(here, `expected a comment, found ${describeDom(n)}`)
          }
          return
        case 'doctype':
          if (n.nodeType !== Node.DOCUMENT_TYPE_NODE || (n as DocumentType).name !== d.name) {
            throw new Mismatch(here, `expected a doctype, found ${describeDom(n)}`)
          }
          return
      }
    })
    if (k !== domChildren.length) {
      throw new Mismatch(
        path,
        `child count differs (DOM ${domChildren.length}, source ${docChildren.length})`,
      )
    }
  }

  try {
    walk(doc, mend.tree.children, '')
  } catch (error: unknown) {
    if (error instanceof Mismatch) {
      return { ok: false, mismatch: { path: error.path || '(document)', reason: error.reason } }
    }
    throw error
  }
  return { ok: true, map: { recordOf, nodeOf, linesOf } }
}

/**
 * Puts back the empty text nodes of virtual records (emptied and saved) into a freshly loaded document: the source
 * has no text there, but the editor's tree and history still refer to the node (requirements 5.1, reload).
 * Inserts only empty text nodes, never elements or attributes. Stops at the first structural difference and
 * leaves the report to mapNodes.
 */
export function restoreVirtualTexts(doc: Document, mend: MendDocument): void {
  const walk = (domParent: Node, docChildren: readonly DocNode[]): void => {
    docChildren.forEach((d, i) => {
      if (d.kind === 'text') {
        if (d.recordId >= 0 && mend.records[d.recordId]?.virtual) {
          domParent.insertBefore(doc.createTextNode(''), domParent.childNodes[i] ?? null)
        }
        return
      }
      if (d.kind !== 'element') return
      const n = domParent.childNodes[i]
      if (n?.nodeType !== Node.ELEMENT_NODE || (n as Element).localName !== d.tagName) return
      walk(n, d.children)
    })
  }
  walk(doc, mend.tree.children)
}
