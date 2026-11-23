// Verifies that fixtures/ still has the byte-level properties the tests rely on
// (e.g. git or an editor did not normalize CRLF or strip the BOM).
// Usage: pnpm fixtures:check
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url))

type Check = readonly [description: string, ok: (bytes: Uint8Array, text: string) => boolean]

// Invisible code points are built from numbers so formatters cannot silently rewrite them.
const cp = (...codes: readonly number[]): string => String.fromCodePoint(...codes)
const hasBom = (b: Uint8Array): boolean => b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf
const includesAll =
  (...needles: readonly string[]) =>
  (_b: Uint8Array, t: string): boolean =>
    needles.every((n) => t.includes(n))

const common: readonly Check[] = [['has no BOM', (b) => !hasBom(b)]]

const checks: Readonly<Record<string, readonly Check[]>> = {
  'basic.html': [...common, ['uses LF only', (_b, t) => !t.includes('\r')]],
  'entities.html': [
    ...common,
    [
      'contains required references',
      includesAll('&amp;', '&nbsp;', '&#12354;', '&#x3042;', '&copy ', '&copyright', 'AT&T'),
    ],
  ],
  'crlf.html': [
    ...common,
    ['uses CRLF line endings', (_b, t) => t.includes('\r\n') && !/[^\r]\n/.test(t)],
    ['contains a lone CR', (_b, t) => /\r[^\n]/.test(t)],
    ['uses tab indentation', (_b, t) => t.includes('\r\n\t\t<p>')],
  ],
  'emoji.html': [
    ...common,
    ['contains ZWJ sequence', includesAll(cp(0x200d))],
    ['contains variation selectors', includesAll(cp(0xfe0f), cp(0xe0100))],
    ['contains combining marks', includesAll(cp(0x3099), cp(0x301))],
    ['contains astral characters', (_b, t) => /[\u{10000}-\u{10FFFF}]/u.test(t)],
  ],
  'inline.html': [
    ...common,
    ['contains nested inline elements', includesAll('<strong>', '<a ', '<code>')],
  ],
  'scripts.html': [
    ...common,
    [
      'contains script, handlers and noscript',
      includesAll('<script>', 'onclick=', 'onerror=', '<noscript>'),
    ],
  ],
  'implicit.html': [
    ...common,
    ['omits doctype, html, head and body tags', (_b, t) => !/<!doctype|<html|<head|<body/i.test(t)],
  ],
  'malformed.html': [
    ...common,
    ['contains text directly under table', includesAll('表の直下のテキスト')],
  ],
  'pre.html': [
    ...common,
    ['contains pre and pre-wrap', includesAll('<pre', 'pre-wrap', '<textarea')],
  ],
  'comments.html': [
    ...common,
    [
      'contains conditional comments and template',
      includesAll('<!--[if IE]>', '<![if !IE]>', '<template'),
    ],
  ],
  'bom.html': [['starts with UTF-8 BOM', (b) => hasBom(b)]],
  'ai-sample.html': [
    ...common,
    ['uses LF only', (_b, t) => !t.includes('\r')],
    ['uses grid layout and inline CSS', includesAll('display: grid', '<style>')],
  ],
  'large.html': [
    ...common,
    ['is about 1MB', (b) => b.length >= 900_000 && b.length <= 1_500_000],
    ['uses grid layout and inline JS', includesAll('display: grid', '<script>')],
  ],
}

async function main(): Promise<void> {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const failures: string[] = []
  for (const [name, fileChecks] of Object.entries(checks)) {
    let bytes: Uint8Array
    try {
      bytes = await readFile(join(fixturesDir, name))
    } catch (error: unknown) {
      failures.push(`${name}: cannot read (${String(error)})`)
      continue
    }
    let text: string
    try {
      text = decoder.decode(bytes)
    } catch (error: unknown) {
      failures.push(`${name}: not valid UTF-8 (${String(error)})`)
      continue
    }
    for (const [description, ok] of fileChecks) {
      if (!ok(bytes, text)) failures.push(`${name}: expected to ${description}`)
    }
  }
  if (failures.length > 0) {
    console.error(`fixtures check failed:\n  ${failures.join('\n  ')}`)
    process.exitCode = 1
    return
  }
  console.log(`fixtures check passed (${Object.keys(checks).length} files)`)
}

main().catch((error: unknown) => {
  console.error('check-fixtures failed:', error)
  process.exitCode = 1
})
