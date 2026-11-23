// Small pure formatters for the UI.

/** "今日", "昨日" or "11月12日" (another year: "2025年11月12日"). Days are local calendar days. */
export function formatOpenedAt(time: number, now: number): string {
  const day = new Date(time)
  const today = new Date(now)
  const startOf = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOf(today) - startOf(day)) / 86_400_000)
  if (diffDays === 0) return '今日'
  if (diffDays === 1) return '昨日'
  const md = `${day.getMonth() + 1}月${day.getDate()}日`
  return day.getFullYear() === today.getFullYear() ? md : `${day.getFullYear()}年${md}`
}

export type LineEnding = 'LF' | 'CRLF' | 'CR' | '混在' | 'なし'

export function detectLineEnding(source: string): LineEnding {
  const crlf = source.match(/\r\n/g)?.length ?? 0
  const cr = (source.match(/\r/g)?.length ?? 0) - crlf
  const lf = (source.match(/\n/g)?.length ?? 0) - crlf
  const kinds: LineEnding[] = []
  if (crlf > 0) kinds.push('CRLF')
  if (lf > 0) kinds.push('LF')
  if (cr > 0) kinds.push('CR')
  if (kinds.length === 0) return 'なし'
  return kinds.length === 1 ? (kinds[0] ?? 'なし') : '混在'
}

export const encodingLabel = (hasBom: boolean, source: string): string => {
  const ending = detectLineEnding(source)
  const encoding = hasBom ? 'UTF-8（BOM付き）' : 'UTF-8'
  return ending === 'なし' ? encoding : `${encoding} ／ ${ending}`
}

/** Shows invisible characters in the change list: U+00A0 as "⍽", line breaks as "↵", empty as "（空）". */
export function visibleText(value: string): string {
  if (value === '') return '（空）'
  return value.replaceAll(String.fromCodePoint(0xa0), '⍽').replace(/\r\n|\r|\n/g, '↵')
}

/** "1. 背景と目的 › p.lead": the record label with its last step replaced by the element (with class). */
export function caretLocation(caret: { readonly element: string; readonly label: string }): string {
  const steps = caret.label === '' ? [] : caret.label.split(' › ')
  const last = steps[steps.length - 1]
  const tag = caret.element.split('.')[0]
  if (last === tag || (last?.startsWith('.') && caret.element.endsWith(last))) {
    return [...steps.slice(0, -1), caret.element].join(' › ')
  }
  return [...steps, caret.element].join(' › ')
}
