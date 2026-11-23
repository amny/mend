import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { decodeUtf8 } from '../src/encoding'
import { parseDocument } from '../src/document'
import type { MendDocument, TextRecord } from '../src/types'

/** U+00A0. Built from a number because formatters rewrite \u escapes into invisible literals. */
export const NBSP = String.fromCodePoint(0xa0)

export const fixturesDir = fileURLToPath(new URL('../../../fixtures/', import.meta.url))

export const fixtureNames = (): readonly string[] =>
  readdirSync(fixturesDir)
    .filter((n) => n.endsWith('.html'))
    .sort()

export function loadFixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fixturesDir + name))
}

export function loadFixture(name: string): {
  doc: MendDocument
  hasBom: boolean
  bytes: Uint8Array
} {
  const bytes = loadFixtureBytes(name)
  const decoded = decodeUtf8(bytes)
  if (!decoded.ok) throw new Error(`fixture ${name} is not valid UTF-8: ${decoded.error.message}`)
  return { doc: parseDocument(decoded.source), hasBom: decoded.hasBom, bytes }
}

export const editable = (doc: MendDocument): readonly TextRecord[] =>
  doc.records.filter((r) => r.status === 'editable')

/** Finds the single editable record whose value contains `needle`. */
export function recordContaining(doc: MendDocument, needle: string): TextRecord {
  const found = doc.records.filter((r) => r.value.includes(needle))
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one record containing ${JSON.stringify(needle)}, found ${found.length}`,
    )
  }
  const [record] = found
  if (!record) throw new Error('unreachable')
  return record
}

/** Inserts `text` at DOM offset `at` of the record's value. */
export const insertAt = (value: string, at: number, text: string): string =>
  value.slice(0, at) + text + value.slice(at)

/** Removes [from, to) of the record's value. */
export const removeRange = (value: string, from: number, to: number): string =>
  value.slice(0, from) + value.slice(to)

/** Index just after the first occurrence of `needle` (throws if missing). */
export function after(value: string, needle: string): number {
  const i = value.indexOf(needle)
  if (i < 0) throw new Error(`${JSON.stringify(needle)} not found in ${JSON.stringify(value)}`)
  return i + needle.length
}

export function before(value: string, needle: string): number {
  const i = value.indexOf(needle)
  if (i < 0) throw new Error(`${JSON.stringify(needle)} not found in ${JSON.stringify(value)}`)
  return i
}

/** Asserts that the only difference between a and b lies within a[start, end). */
export function diffConfinedTo(a: string, b: string, start: number, end: number): boolean {
  const delta = b.length - a.length
  return a.slice(0, start) === b.slice(0, start) && a.slice(end) === b.slice(end + delta)
}
