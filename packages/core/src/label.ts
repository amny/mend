// Human-readable locations: labels for the change list and CSS-like paths for verification issues.

export interface AncestorInfo {
  readonly tagName: string
  readonly className: string | undefined
}

/** Wrappers that add no information to a label. */
const STRUCTURAL = new Set([
  'html',
  'body',
  'main',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'aside',
  'tbody',
  'thead',
  'tfoot',
  'tr',
])

const MAX_LABEL_DEPTH = 3
const MAX_HEADING_LENGTH = 40

function describe(a: AncestorInfo): string | null {
  const generic = a.tagName === 'div' || a.tagName === 'span'
  if (generic) return a.className ? `.${a.className}` : null
  if (STRUCTURAL.has(a.tagName)) return null
  return a.tagName
}

export function buildLabel(
  heading: string | undefined,
  ancestors: readonly AncestorInfo[],
): string {
  const chain = ancestors
    .map(describe)
    .filter((d): d is string => d !== null)
    .slice(-MAX_LABEL_DEPTH)
  return [heading, ...chain].filter((p): p is string => p !== undefined && p !== '').join(' › ')
}

export function normalizeHeading(text: string): string | undefined {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed === '') return undefined
  return collapsed.length > MAX_HEADING_LENGTH
    ? `${collapsed.slice(0, MAX_HEADING_LENGTH)}…`
    : collapsed
}

/** One step of a CSS-like path, e.g. "section:nth-of-type(2)". */
export function pathStep(tagName: string, sameTagIndex: number, sameTagCount: number): string {
  return sameTagCount > 1 ? `${tagName}:nth-of-type(${sameTagIndex + 1})` : tagName
}
