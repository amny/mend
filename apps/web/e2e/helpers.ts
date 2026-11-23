import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type FrameLocator, type Page } from '@playwright/test'
import { installFakeFileSystem } from './fakeFileSystem'

const fixturesDir = fileURLToPath(new URL('../../../fixtures/', import.meta.url))

export const EDIT_FRAME = 'iframe[title="Mend editing view"]'

export const fixtureNames = (): string[] =>
  readdirSync(fixturesDir)
    .filter((n) => n.endsWith('.html'))
    .sort()

export const fixtureBytes = (name: string): Buffer => readFileSync(fixturesDir + name)
export const fixtureSource = (name: string): string =>
  new TextDecoder('utf-8', { ignoreBOM: false }).decode(fixtureBytes(name))

export const frame = (page: Page): FrameLocator => page.frameLocator(EDIT_FRAME)

/** Loads the app with the fake file system and the given files on "disk". */
export async function launch(page: Page, files: Readonly<Record<string, Buffer>>): Promise<void> {
  await page.addInitScript(installFakeFileSystem)
  await page.goto('/')
  for (const [name, bytes] of Object.entries(files)) {
    await page.evaluate(([n, b]) => window.__fakeFs.put(n, b), [
      name,
      bytes.toString('base64'),
    ] as const)
  }
}

/** Waits until exactly one editing view exists and it accepts input (createEditor finished). */
export async function waitForEditor(page: Page): Promise<void> {
  await page.waitForFunction((selector) => {
    const frames = document.querySelectorAll<HTMLIFrameElement>(selector)
    return frames.length === 1 && frames[0]?.contentDocument?.designMode === 'on'
  }, EDIT_FRAME)
}

/** Opens a file through the "ファイルを開く" button and the (fake) picker. */
export async function openWithPicker(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    window.__fakeFs.nextOpen = n
  }, name)
  await page.getByRole('button', { name: /ファイルを開く/ }).click()
  await waitForEditor(page)
}

/** Starts the app and opens a fixture copied to the fake disk under the same name. */
export async function openFixture(page: Page, name: string): Promise<void> {
  await launch(page, { [name]: fixtureBytes(name) })
  await openWithPicker(page, name)
}

export async function readFile(page: Page, name: string): Promise<Buffer> {
  const base64 = await page.evaluate((n) => window.__fakeFs.read(n), name)
  if (base64 === null) throw new Error(`fake fs: ${name} does not exist`)
  return Buffer.from(base64, 'base64')
}

export const readText = async (page: Page, name: string): Promise<string> =>
  new TextDecoder('utf-8', { ignoreBOM: false }).decode(await readFile(page, name))

export const writes = (page: Page): Promise<number> => page.evaluate(() => window.__fakeFs.writes)

/** Waits for the save toast, which appears only after the write succeeded. */
export async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByRole('status')).toContainText('保存しました')
}

/** Clicks the element (focusing the iframe as a user would), then places the selection inside its text. */
export async function caret(
  page: Page,
  selector: string,
  needle: string,
  start: number,
  end?: number,
): Promise<void> {
  const target = frame(page).locator(selector).first()
  await target.click()
  await target.evaluate(
    (el, [n, s, e]) => {
      const doc = el.ownerDocument
      const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text
        const at = text.data.indexOf(n)
        if (at < 0) continue
        doc.getSelection()?.setBaseAndExtent(text, at + s, text, at + (e ?? s))
        return
      }
      throw new Error(`caret: "${n}" not found`)
    },
    [needle, start, end] as const,
  )
}

/** Selects from (needleA, offsetA) to (needleB, offsetB), which may be in different text nodes. */
export async function selectAcross(
  page: Page,
  selector: string,
  a: readonly [string, number],
  b: readonly [string, number],
): Promise<void> {
  const target = frame(page).locator(selector).first()
  await target.click()
  await target.evaluate(
    (el, [[na, oa], [nb, ob]]) => {
      const doc = el.ownerDocument
      const find = (needle: string): Text => {
        const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if ((node as Text).data.includes(needle)) return node as Text
        }
        throw new Error(`selectAcross: "${needle}" not found`)
      }
      const ta = find(na)
      const tb = find(nb)
      doc
        .getSelection()
        ?.setBaseAndExtent(ta, ta.data.indexOf(na) + oa, tb, tb.data.indexOf(nb) + ob)
    },
    [a, b] as const,
  )
}

/** Element/attribute/node-kind skeleton of the editing document (text content excluded). */
export const structure = (page: Page): Promise<string> =>
  page.evaluate((selector) => {
    const doc = document.querySelector<HTMLIFrameElement>(selector)?.contentDocument
    if (!doc?.documentElement) throw new Error('no editing document')
    const sig = (n: Node): string => {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as Element
        const attrs = Array.from(el.attributes, (a) => ` ${a.name}="${a.value}"`).join('')
        return `<${el.localName}${attrs}>${Array.from(el.childNodes, sig).join('')}</>`
      }
      return n.nodeType === Node.TEXT_NODE ? '#' : n.nodeType === Node.COMMENT_NODE ? '!' : '?'
    }
    return sig(doc.documentElement)
  }, EDIT_FRAME)

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

/** Save with the keyboard while the focus is in the editing view (the iframe reports Ctrl+S itself). */
export const pressSave = (page: Page): Promise<void> => page.keyboard.press('ControlOrMeta+s')

/** Waits until the change list shows `count` entries (it updates after React re-renders). */
export const expectChanges = (page: Page, count: number): Promise<void> =>
  expect(page.locator('.change-list > li')).toHaveCount(count)
