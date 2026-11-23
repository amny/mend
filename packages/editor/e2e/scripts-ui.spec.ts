// AC-07 (no script runs while editing), highlighting, hover frame, search and shortcuts.
import { expect, test } from '@playwright/test'
import { caret, frame, open, state } from './helpers'

test('AC-07: scripts in the document never run while editing', async ({ page }) => {
  const ran: string[] = []
  page.on('console', (m) => {
    if (m.text().includes('MEND_SCRIPT_RAN')) ran.push(m.text())
  })
  page.on('dialog', (d) => {
    ran.push(`dialog: ${d.message()}`)
    void d.dismiss()
  })
  await open(page, 'scripts.html')
  const f = frame(page)
  await f.locator('p[onmouseover]').hover()
  await f.locator('button').click()
  await f.locator('a').click()
  await caret(page, '#static', '静的な段落', 2)
  await page.keyboard.type('x')
  await page.waitForTimeout(300)
  expect(ran).toEqual([])
  // The script that would fill #generated did not run; <noscript> is parsed as elements.
  expect(await f.locator('#generated').evaluate((el) => el.childNodes.length)).toBe(0)
  await expect(f.locator('#noscript')).toHaveCount(1)
  expect((await state(page)).changes).toHaveLength(1)
})

test('changed text is highlighted without adding nodes to the document (V-04)', async ({
  page,
}) => {
  await open(page, 'basic.html')
  await caret(page, 'p.lead', '月次で', 2)
  await page.keyboard.type('XY')
  const info = await page.evaluate(() => {
    const iframe = document.querySelector('iframe')
    const win = iframe?.contentWindow as (Window & typeof globalThis) | null
    const doc = iframe?.contentDocument
    if (!win || !doc) throw new Error('no iframe')
    const ranges = [...(win.CSS.highlights.get('mend-changed') ?? [])] as Range[]
    return {
      highlighted: ranges.map((r) => r.toString()),
      styleElements: doc.querySelectorAll('style').length,
      adopted: doc.adoptedStyleSheets.length,
    }
  })
  expect(info.highlighted).toEqual(['XY'])
  expect(info.styleElements).toBe(1) // the document's own <style>
  expect(info.adopted).toBe(1)
})

test('hovering editable text shows a frame and the element name in the parent page (V-03)', async ({
  page,
}) => {
  await open(page, 'basic.html')
  const overlay = page.locator('[data-mend-overlay="hover"]')
  await frame(page)
    .locator('p.lead')
    .hover({ position: { x: 20, y: 8 } })
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveText('p.lead')
  // The body margin has no editable text.
  await frame(page)
    .locator('body')
    .hover({ position: { x: 5, y: 5 } })
  await expect(overlay).toBeHidden()
})

test('search finds matches across the document and steps through them (E-05)', async ({ page }) => {
  await open(page, 'basic.html')
  await page.evaluate(() => window.mendTest.editor().find('受注'))
  const s = await state(page)
  expect(s.search).toEqual({ query: '受注', count: 4, current: 0 })
  await page.evaluate(() => window.mendTest.editor().findPrevious())
  expect((await state(page)).search.current).toBe(3)
  await page.evaluate(() => window.mendTest.editor().findNext())
  expect((await state(page)).search.current).toBe(0)
  // Matches span element boundaries and ignore ASCII case.
  await page.evaluate(() => window.mendTest.editor().find('fr-01受注'))
  expect((await state(page)).search.count).toBe(1)
  await page.evaluate(() => window.mendTest.editor().clearFind())
  expect((await state(page)).search).toEqual({ query: '', count: 0, current: -1 })
})

test('Ctrl+S, Ctrl+Shift+S and Ctrl+F inside the iframe are reported to the app', async ({
  page,
}) => {
  await open(page, 'basic.html')
  await caret(page, 'p.lead', '月次', 0)
  await page.keyboard.press('ControlOrMeta+s')
  await page.keyboard.press('ControlOrMeta+Shift+s')
  await page.keyboard.press('ControlOrMeta+f')
  expect(await page.evaluate(() => window.mendTest.shortcuts)).toEqual(['save', 'saveAs', 'find'])
})

test('a document whose DOM differs from the parse opens read-only (requirements 5.2)', async ({
  page,
}) => {
  await page.goto('/')
  const opened = await page.evaluate(() =>
    window.mendTest.openMismatched('<!doctype html><p id="p">abc</p>'),
  )
  expect(opened.readOnly).toMatchObject({ code: 'mapping-mismatch' })
  expect(
    await frame(page)
      .locator('html')
      .evaluate((el) => el.ownerDocument.designMode),
  ).toBe('off')
  await frame(page).locator('#p').click()
  await page.keyboard.type('x')
  expect(await frame(page).locator('#p').textContent()).toBe('abc')
})

test('the state reports where the caret is', async ({ page }) => {
  await open(page, 'basic.html')
  expect((await state(page)).caret).toBeNull()
  await caret(page, 'p.lead', '月次', 0)
  await expect
    .poll(async () => (await state(page)).caret)
    .toEqual({ element: 'p.lead', label: '1. 背景と目的 › p' })
})

test('revealPath scrolls to and frames the element of a verification issue', async ({ page }) => {
  await open(page, 'basic.html')
  const found = await page.evaluate(() =>
    window.mendTest.editor().revealPath('table › tbody › tr:nth-of-type(2) › td:nth-of-type(3)'),
  )
  expect(found).toBe(true)
  const overlay = page.locator('[data-mend-overlay="hover"]')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveText('td')
  expect(await page.evaluate(() => window.mendTest.editor().revealPath('(document)'))).toBe(false)
  expect(await page.evaluate(() => window.mendTest.editor().revealPath('nav › ul'))).toBe(false)
})
