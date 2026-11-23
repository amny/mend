// Pre-save verification (requirements 5.7): re-parse the new source and compare it with the expected tree.
import { buildDocument, parseSource, type ParsedSource } from './document'
import { pathStep } from './label'
import { validatePatches } from './patch'
import type { DocNode, MendDocument, Patch } from './types'

export type VerificationIssueKind =
  | 'outside-patch'
  | 'document-mode'
  | 'child-count'
  | 'node-kind'
  | 'tag-name'
  | 'attributes'
  | 'text'
  | 'comment'
  | 'doctype'

export interface VerificationIssue {
  readonly kind: VerificationIssueKind
  /** CSS-like path of the element where the difference was found, e.g. "section:nth-of-type(2) › table › tbody". */
  readonly path: string
  readonly expected: string
  readonly actual: string
}

export type VerificationResult =
  { readonly ok: true } | { readonly ok: false; readonly issues: readonly VerificationIssue[] }

const MAX_ISSUES = 20
/** A <br> inserted by the editor (no attributes). */
const NEW_BR: DocNode = {
  kind: 'element',
  tagName: 'br',
  namespace: 'http://www.w3.org/1999/xhtml',
  attrs: [],
  children: [],
}
const ROOT_PATH = '(document)'
const SKIPPED_PATH_TAGS = new Set(['html', 'body'])

const describeNode = (n: DocNode): string =>
  n.kind === 'element' ? `<${n.tagName}>` : n.kind === 'text' ? '#text' : `#${n.kind}`

const describeAttrs = (n: DocNode): string =>
  n.kind === 'element'
    ? n.attrs.map((a) => `${a.prefix ? `${a.prefix}:` : ''}${a.name}="${a.value}"`).join(' ')
    : ''

const sameAttrs = (a: DocNode, b: DocNode): boolean =>
  a.kind === 'element' &&
  b.kind === 'element' &&
  a.attrs.length === b.attrs.length &&
  a.attrs.every((x, i) => {
    const y = b.attrs[i]
    return (
      y !== undefined &&
      x.name === y.name &&
      x.value === y.value &&
      x.namespace === y.namespace &&
      x.prefix === y.prefix
    )
  })

/** Checks that everything outside the patched ranges is unchanged (an assertion; true by construction). */
function checkOutsidePatches(
  original: string,
  next: string,
  patches: readonly Patch[],
): VerificationIssue[] {
  const sorted = [...patches].sort((x, y) => x.start - y.start)
  let oldPos = 0
  let newPos = 0
  for (const p of [...sorted, { start: original.length, end: original.length, text: '' }]) {
    const length = p.start - oldPos
    if (original.slice(oldPos, p.start) !== next.slice(newPos, newPos + length)) {
      return [
        {
          kind: 'outside-patch',
          path: ROOT_PATH,
          expected: `source[${oldPos}, ${p.start}) unchanged`,
          actual: 'changed',
        },
      ]
    }
    newPos += length + p.text.length
    oldPos = p.end
  }
  return newPos === next.length
    ? []
    : [
        {
          kind: 'outside-patch',
          path: ROOT_PATH,
          expected: `length ${newPos}`,
          actual: `length ${next.length}`,
        },
      ]
}

/**
 * @param original        document the patches were made against
 * @param newSource       patched source
 * @param expectedValues  record id -> expected lines for edited records ('' = text node removed; lines are
 *                        separated by new <br> elements)
 * @param parsed          optional parse of newSource to reuse
 */
export function verifySave(
  original: MendDocument,
  newSource: string,
  expectedValues: ReadonlyMap<number, readonly string[]>,
  patches: readonly Patch[],
  parsed: ParsedSource = parseSource(newSource),
): VerificationResult {
  const issues: VerificationIssue[] = []
  const push = (issue: VerificationIssue): void => {
    if (issues.length < MAX_ISSUES) issues.push(issue)
  }

  try {
    validatePatches(original.source.length, patches)
    checkOutsidePatches(original.source, newSource, patches).forEach(push)
  } catch (error: unknown) {
    push({
      kind: 'outside-patch',
      path: ROOT_PATH,
      expected: 'valid patches',
      actual: String(error),
    })
  }

  const actual = buildDocument(newSource, undefined, parsed).tree
  if (actual.mode !== original.tree.mode) {
    push({
      kind: 'document-mode',
      path: ROOT_PATH,
      expected: original.tree.mode,
      actual: actual.mode,
    })
  }

  const expectedNodes = (n: DocNode): DocNode[] => {
    if (n.kind !== 'text' || n.recordId < 0) return [n]
    const record = original.records[n.recordId]
    const lines = expectedValues.get(n.recordId) ?? [record?.value ?? n.value]
    return lines.flatMap((value, i) => (i === 0 ? [{ ...n, value }] : [NEW_BR, { ...n, value }]))
  }
  const present = (n: DocNode): boolean => n.kind !== 'text' || n.value !== ''

  const compareLists = (
    exp: readonly DocNode[],
    act: readonly DocNode[],
    path: string,
    mapExpected: boolean,
  ): void => {
    const e = (mapExpected ? exp.flatMap(expectedNodes) : exp).filter(present)
    const a = act.filter(present)
    if (e.length !== a.length) {
      push({ kind: 'child-count', path, expected: String(e.length), actual: String(a.length) })
      return
    }
    e.forEach((en, i) => {
      const an = a[i]
      if (!an || issues.length >= MAX_ISSUES) return
      const childPath = stepPath(path, e, i)
      compareNode(en, an, path, childPath, mapExpected)
    })
  }

  const stepPath = (parentPath: string, siblings: readonly DocNode[], index: number): string => {
    const node = siblings[index]
    if (node?.kind !== 'element') return parentPath
    if (SKIPPED_PATH_TAGS.has(node.tagName) && parentPath === ROOT_PATH) return ROOT_PATH
    if (SKIPPED_PATH_TAGS.has(node.tagName)) return parentPath
    const same = siblings.filter((s) => s.kind === 'element' && s.tagName === node.tagName)
    const step = pathStep(node.tagName, same.indexOf(node), same.length)
    return parentPath === ROOT_PATH ? step : `${parentPath} › ${step}`
  }

  const compareNode = (
    e: DocNode,
    a: DocNode,
    parentPath: string,
    path: string,
    mapExpected: boolean,
  ): void => {
    if (e.kind !== a.kind) {
      push({
        kind: 'node-kind',
        path: parentPath,
        expected: describeNode(e),
        actual: describeNode(a),
      })
      return
    }
    if (e.kind === 'text' && a.kind === 'text') {
      if (e.value !== a.value)
        push({ kind: 'text', path: parentPath, expected: e.value, actual: a.value })
      return
    }
    if (e.kind === 'comment' && a.kind === 'comment') {
      if (e.data !== a.data)
        push({ kind: 'comment', path: parentPath, expected: e.data, actual: a.data })
      return
    }
    if (e.kind === 'doctype' && a.kind === 'doctype') {
      const de = `${e.name}|${e.publicId}|${e.systemId}`
      const da = `${a.name}|${a.publicId}|${a.systemId}`
      if (de !== da) push({ kind: 'doctype', path: ROOT_PATH, expected: de, actual: da })
      return
    }
    if (e.kind === 'element' && a.kind === 'element') {
      if (e.tagName !== a.tagName || e.namespace !== a.namespace) {
        push({ kind: 'tag-name', path, expected: e.tagName, actual: a.tagName })
        return
      }
      if (!sameAttrs(e, a))
        push({ kind: 'attributes', path, expected: describeAttrs(e), actual: describeAttrs(a) })
      compareLists(e.children, a.children, path, mapExpected)
      if (e.templateContent || a.templateContent) {
        // Template content has no records: compare as is.
        compareLists(e.templateContent ?? [], a.templateContent ?? [], `${path} › #content`, false)
      }
    }
  }

  compareLists(original.tree.children, actual.children, ROOT_PATH, true)
  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}
