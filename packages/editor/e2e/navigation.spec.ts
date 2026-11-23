// Requirements 5.1: when the editing iframe navigates to another document, the document is loaded again and the
// unsaved edits, the undo history and the change list carry over.
import { expect, test, type Page } from '@playwright/test'
import {
  caret,
  expectSingleReplacement,
  fixtureBytes,
  fixtureSource,
  innerHtml,
  open,
  saveOk,
  state,
  structure,
} from './helpers'

/** Navigates the editing iframe away, as a refresh or a followed link would. */
const navigateAway = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const win = document.querySelector('iframe')?.contentWindow
    if (!win) throw new Error('no editing iframe')
    win.location.replace('about:blank')
  })

/** Waits until the document was loaded again and accepts input. */
const waitForReload = (page: Page, text: string): Promise<unknown> =>
  page.waitForFunction((t) => {
    const doc = document.querySelector('iframe')?.contentDocument
    return doc?.designMode === 'on' && (doc.body?.textContent ?? '').includes(t)
  }, text)

test('edits, the change list and undo survive a navigation', async ({ page }) => {
  await open(page, 'basic.html')
  const before = await structure(page)
  await caret(page, 'p.lead', '月次で', 2)
  await page.keyboard.type('XY')

  await navigateAway(page)
  await waitForReload(page, '月次XYで')
  expect(await structure(page)).toBe(before)
  expect(await innerHtml(page, 'p.lead')).toBe('現行システムでは受注データを月次XYで集計している。')
  const s = await state(page)
  expect(s.readOnly).toBeNull()
  expect(s.changes.map((c) => c.after)).toEqual([
    '現行システムでは受注データを月次XYで集計している。',
  ])
  // The change is highlighted in the new document.
  const highlighted = await page.evaluate(() => {
    const win = document.querySelector('iframe')?.contentWindow as
      (Window & typeof globalThis) | null
    const ranges = [...(win?.CSS.highlights.get('mend-changed') ?? [])] as Range[]
    return ranges.map((r) => r.toString())
  })
  expect(highlighted).toEqual(['XY'])

  // Editing goes on in the new document, and the history spans both.
  await caret(page, 'li', '受注登録', 4)
  await page.keyboard.type('Z')
  await page.keyboard.press('ControlOrMeta+z')
  expect(await innerHtml(page, 'li')).toBe('受注登録')
  await page.keyboard.press('ControlOrMeta+z')
  expect(await innerHtml(page, 'p.lead')).toBe('現行システムでは受注データを月次で集計している。')
  await page.keyboard.press('ControlOrMeta+y')
  const { source } = await saveOk(page)
  expectSingleReplacement(fixtureSource('basic.html'), source, '月次で', '月次XYで')
})

test('a navigation after saving loads the saved source; an emptied element can still be undone', async ({
  page,
}) => {
  await open(page, 'basic.html')
  const before = await structure(page)
  await caret(page, 'li', '受注登録', 0, 4)
  await page.keyboard.press('Backspace')
  const saved = await saveOk(page)
  expectSingleReplacement(
    fixtureSource('basic.html'),
    saved.source,
    '<li>受注登録</li>',
    '<li></li>',
  )

  await navigateAway(page)
  await waitForReload(page, '在庫引当')
  expect(await structure(page)).toBe(before)
  expect(await innerHtml(page, 'li')).toBe('')
  expect((await state(page)).changes).toEqual([])

  await caret(page, 'p.lead', '月次で', 2)
  await page.keyboard.press('ControlOrMeta+z')
  expect(await innerHtml(page, 'li')).toBe('受注登録')
  expect((await saveOk(page)).bytes.equals(fixtureBytes('basic.html'))).toBe(true)
})

test('repeated navigations stop editing but keep the edits saveable', async ({ page }) => {
  await open(page, 'basic.html')
  await caret(page, 'p.lead', '月次で', 2)
  await page.keyboard.type('XY')
  for (let i = 0; i < 3; i++) {
    await navigateAway(page)
    await waitForReload(page, '月次XYで')
  }
  await navigateAway(page)
  await expect.poll(async () => (await state(page)).readOnly?.code).toBe('navigated')
  const s = await state(page)
  expect(s.changes).toHaveLength(1)
  const { source } = await saveOk(page)
  expectSingleReplacement(fixtureSource('basic.html'), source, '月次で', '月次XYで')
})

test('new <br> line breaks survive a navigation and can still be undone', async ({ page }) => {
  await open(page, 'basic.html')
  await caret(page, 'p.lead', '月次で', 2)
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('X')
  await navigateAway(page)
  await waitForReload(page, 'X')
  expect(await innerHtml(page, 'p.lead')).toBe(
    '現行システムでは受注データを月次<br>Xで集計している。',
  )
  expect((await state(page)).readOnly).toBeNull()
  await caret(page, 'li', '受注登録', 0)
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  expect(await innerHtml(page, 'p.lead')).toBe('現行システムでは受注データを月次で集計している。')
  expect((await saveOk(page)).bytes.equals(fixtureBytes('basic.html'))).toBe(true)
})
