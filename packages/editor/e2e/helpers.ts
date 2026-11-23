import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type FrameLocator, type Page } from '@playwright/test'
import type { EditorState } from '../src'
import type { SaveOutcome } from '../harness/main'

const fixturesDir = fileURLToPath(new URL('../../../fixtures/', import.meta.url))

export const NBSP = String.fromCodePoint(0xa0)

export const fixtureNames = (): string[] =>
  readdirSync(fixturesDir)
    .filter((n) => n.endsWith('.html'))
    .sort()

export const fixtureBytes = (name: string): Buffer => readFileSync(fixturesDir + name)
export const fixtureSource = (name: string): string =>
  new TextDecoder('utf-8', { ignoreBOM: false }).decode(fixtureBytes(name))

export const frame = (page: Page): FrameLocator =>
  page.frameLocator('iframe[title="Mend editing view"]')

export async function open(page: Page, fixture: string): Promise<EditorState> {
  await page.goto('/')
  return page.evaluate((name) => window.mendTest.open(name), fixture)
}

export const state = (page: Page): Promise<EditorState> =>
  page.evaluate(() => window.mendTest.state())

/** Clicks the element (to focus the iframe, as a user would) and then places the selection precisely. */
export async function caret(
  page: Page,
  selector: string,
  needle: string,
  start: number,
  end?: number,
): Promise<void> {
  await frame(page).locator(selector).first().click()
  await page.evaluate(([n, s, e]) => window.mendTest.select(n, s, e), [needle, start, end] as const)
}

export async function save(page: Page, fault = false): Promise<SaveOutcome> {
  return page.evaluate((f) => window.mendTest.save(f), fault)
}

export async function saveOk(page: Page): Promise<{ bytes: Buffer; source: string }> {
  const outcome = await save(page)
  if (!outcome.ok) throw new Error(`save failed: ${outcome.code}: ${outcome.message}`)
  return { bytes: Buffer.from(outcome.base64, 'base64'), source: outcome.source }
}

/** Element/attribute/node-kind skeleton of the iframe document (text content excluded). */
export const structure = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const doc = document.querySelector('iframe')?.contentDocument
    if (!doc?.documentElement) throw new Error('no iframe document')
    const sig = (n: Node): string => {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as Element
        const attrs = Array.from(el.attributes, (a) => ` ${a.name}="${a.value}"`).join('')
        return `<${el.localName}${attrs}>${Array.from(el.childNodes, sig).join('')}</>`
      }
      return n.nodeType === Node.TEXT_NODE ? '#' : n.nodeType === Node.COMMENT_NODE ? '!' : '?'
    }
    return sig(doc.documentElement)
  })

export const innerHtml = (page: Page, selector: string): Promise<string> =>
  frame(page)
    .locator(selector)
    .first()
    .evaluate((el) => el.innerHTML)

/** Asserts that `saved` equals `original` with exactly one occurrence of `from` replaced by `to`. */
export function expectSingleReplacement(
  original: string,
  saved: string,
  from: string,
  to: string,
): void {
  const at = original.indexOf(from)
  expect(at, `"${from}" must occur in the original`).toBeGreaterThanOrEqual(0)
  expect(original.indexOf(from, at + 1), `"${from}" must be unique`).toBe(-1)
  expect(saved).toBe(original.slice(0, at) + to + original.slice(at + from.length))
}
