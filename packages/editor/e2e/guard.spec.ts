// Structure guard (E-02, E-03, AC-04, AC-06).
import { expect, test } from '@playwright/test'
import {
  caret,
  expectSingleReplacement,
  fixtureBytes,
  fixtureSource,
  frame,
  innerHtml,
  open,
  saveOk,
  state,
  structure,
} from './helpers'

test.describe('AC-04: structure never changes', () => {
  // Shift+Enter inserts a new <br> since the line break change (requirements E-02, AC-12; linebreak.spec.ts).
  test('Enter (a new paragraph) is blocked', async ({ page }) => {
    await open(page, 'basic.html')
    const before = await structure(page)
    await caret(page, 'p.lead', '月次で', 2)
    await page.keyboard.press('Enter')
    expect(await structure(page)).toBe(before)
    expect((await state(page)).changes).toEqual([])
  })

  test('Ctrl+B / Ctrl+I / Ctrl+U on a selection', async ({ page }) => {
    await open(page, 'basic.html')
    const before = await structure(page)
    await caret(page, 'p.lead', '受注データ', 0, 5)
    for (const key of ['b', 'i', 'u']) await page.keyboard.press(`ControlOrMeta+${key}`)
    expect(await structure(page)).toBe(before)
    expect((await state(page)).changes).toEqual([])
  })

  test('deleting a selection across elements', async ({ page }) => {
    await open(page, 'inline.html')
    const before = await structure(page)
    const html = await innerHtml(page, '#p1')
    await frame(page).locator('#p1').click()
    await page.evaluate(() => window.mendTest.selectAcross('この文は', 2, '強調', 1))
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Delete')
    await page.keyboard.type('x')
    expect(await structure(page)).toBe(before)
    expect(await innerHtml(page, '#p1')).toBe(html)
  })

  test('Backspace at the start of a paragraph does not merge paragraphs', async ({ page }) => {
    await open(page, 'basic.html')
    const before = await structure(page)
    await caret(page, 'p:nth-of-type(2)', '営業部門', 0)
    await page.keyboard.press('Backspace')
    expect(await structure(page)).toBe(before)
    expect((await state(page)).changes).toEqual([])
  })

  test('dropping text from outside and dragging selected text', async ({ page }) => {
    await open(page, 'inline.html')
    const before = await structure(page)
    const html = await innerHtml(page, 'body')
    await caret(page, '#p1', 'この文は', 0, 4)
    // An external drop, dispatched through CDP (Playwright's mouse-driven drag waits for a drag that never starts).
    const target = await frame(page).locator('#p6').boundingBox()
    if (!target) throw new Error('#p6 is not visible')
    await page.evaluate(() => {
      const doc = document.querySelector('iframe')?.contentDocument
      // Marks the parent page (an attribute in the iframe would be reverted by the guard).
      doc?.addEventListener('drop', () => document.body.setAttribute('data-test-dropped', ''), {
        once: true,
      })
    })
    const cdp = await page.context().newCDPSession(page)
    const drag = {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
      data: { items: [{ mimeType: 'text/plain', data: 'DROPPED' }], dragOperationsMask: 1 },
    }
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
      await cdp.send('Input.dispatchDragEvent', { type, ...drag })
    }
    // The drop really reached the editing document.
    await expect(page.locator('body[data-test-dropped]')).toHaveCount(1)
    // Dragging the selection out never starts.
    const prevented = await frame(page)
      .locator('#p1')
      .evaluate((el) => {
        const e = new DragEvent('dragstart', { bubbles: true, cancelable: true })
        el.firstChild?.dispatchEvent(e)
        return e.defaultPrevented
      })
    expect(prevented).toBe(true)
    expect(await structure(page)).toBe(before)
    expect(await innerHtml(page, 'body')).toBe(html)
  })

  test('pasting rich text inserts plain text with line breaks as spaces (E-03)', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await open(page, 'basic.html')
    const before = await structure(page)
    await page.evaluate(async () => {
      const item = new ClipboardItem({
        'text/html': new Blob(['<b>太字</b><p>段落</p>'], { type: 'text/html' }),
        'text/plain': new Blob(['太字\n段落'], { type: 'text/plain' }),
      })
      await navigator.clipboard.write([item])
    })
    await caret(page, 'p.lead', '月次で', 2)
    await page.keyboard.press('ControlOrMeta+v')
    expect(await structure(page)).toBe(before)
    const { source } = await saveOk(page)
    expectSingleReplacement(fixtureSource('basic.html'), source, '月次で', '月次太字 段落で')
  })
})

test.describe('AC-06: emptying an element', () => {
  test('the element and its text node stay, no <br> is inserted, and it saves as empty', async ({
    page,
  }) => {
    await open(page, 'basic.html')
    const before = await structure(page)
    await caret(page, 'li', '受注登録', 0, 4)
    await page.keyboard.press('Backspace')
    expect(await structure(page)).toBe(before)
    expect(await innerHtml(page, 'li')).toBe('')
    const { source } = await saveOk(page)
    expectSingleReplacement(fixtureSource('basic.html'), source, '<li>受注登録</li>', '<li></li>')

    // The emptied node survives the save as a virtual node: undo brings the text back and saves byte-identically.
    await page.keyboard.press('ControlOrMeta+z')
    expect(await innerHtml(page, 'li')).toBe('受注登録')
    const restored = await saveOk(page)
    expect(restored.bytes.equals(fixtureBytes('basic.html'))).toBe(true)
  })

  test('deleting the last character with Backspace one by one', async ({ page }) => {
    await open(page, 'basic.html')
    const before = await structure(page)
    await caret(page, 'li', '受注登録', 4)
    for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace')
    expect(await structure(page)).toBe(before)
    expect(await innerHtml(page, 'li')).toBe('')
    // Typing again goes back into the same (empty) text node.
    await page.keyboard.type('新規')
    expect(await structure(page)).toBe(before)
    expect(await innerHtml(page, 'li')).toBe('新規')
  })
})

test('non-editable text (script, button, whitespace) cannot be changed', async ({ page }) => {
  await open(page, 'scripts.html')
  const html = await innerHtml(page, 'body')
  await frame(page).locator('button').click()
  await page.keyboard.type('abc')
  await page.keyboard.press('Backspace')
  expect(await innerHtml(page, 'body')).toBe(html)
  expect((await state(page)).changes).toEqual([])
})
