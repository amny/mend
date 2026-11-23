// Editing through the app UI, checked against the bytes written to the (fake) file: AC-04, 05, 06, 07, 09, 11.
import { expect, test, type Page } from '@playwright/test'
import {
  caret,
  expectChanges,
  expectSaved,
  expectSingleReplacement,
  fixtureBytes,
  fixtureSource,
  frame,
  innerHtml,
  openFixture,
  pressSave,
  readFile,
  readText,
  selectAcross,
  structure,
  writes,
} from './helpers'

/** Saves with the button and returns the written file. */
async function saveFile(page: Page, name: string): Promise<{ bytes: Buffer; source: string }> {
  const before = await writes(page)
  await page.getByRole('button', { name: /^保存/ }).click()
  await expect.poll(() => writes(page)).toBe(before + 1)
  await expectSaved(page)
  return { bytes: await readFile(page, name), source: await readText(page, name) }
}

const unchanged = async (page: Page, name: string): Promise<void> => {
  const { bytes } = await saveFile(page, name)
  expect(bytes.equals(fixtureBytes(name))).toBe(true)
}

test.describe('AC-04: structure never changes', () => {
  // Shift+Enter inserts a new <br> (AC-12, tested below).
  test('Enter and Ctrl+B / I / U', async ({ page }) => {
    await openFixture(page, 'basic.html')
    const before = await structure(page)
    await caret(page, 'p.lead', '月次で', 2)
    await page.keyboard.press('Enter')
    await caret(page, 'p.lead', '受注データ', 0, 5)
    for (const key of ['b', 'i', 'u']) await page.keyboard.press(`ControlOrMeta+${key}`)
    expect(await structure(page)).toBe(before)
    await expectChanges(page, 0)
    await unchanged(page, 'basic.html')
  })

  test('deleting a selection across elements', async ({ page }) => {
    await openFixture(page, 'inline.html')
    const before = await structure(page)
    const html = await innerHtml(page, '#p1')
    await selectAcross(page, '#p1', ['この文は', 2], ['強調', 1])
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Delete')
    expect(await structure(page)).toBe(before)
    expect(await innerHtml(page, '#p1')).toBe(html)
    await unchanged(page, 'inline.html')
  })

  test('pasting rich text inserts plain text (E-03)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openFixture(page, 'basic.html')
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
    const { source } = await saveFile(page, 'basic.html')
    expectSingleReplacement(fixtureSource('basic.html'), source, '月次で', '月次太字 段落で')
  })

  test('dropping text onto the editing view', async ({ page }) => {
    await openFixture(page, 'inline.html')
    const before = await structure(page)
    const target = await frame(page).locator('#p6').boundingBox()
    if (!target) throw new Error('#p6 is not visible')
    await page.evaluate((selector) => {
      const doc = document.querySelector<HTMLIFrameElement>(selector)?.contentDocument
      doc?.addEventListener('drop', () => document.body.setAttribute('data-test-dropped', ''), {
        once: true,
      })
    }, 'iframe[title="Mend editing view"]')
    // Dispatched through CDP: Playwright's mouse drag waits for a drag that never starts.
    const cdp = await page.context().newCDPSession(page)
    const drag = {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
      data: { items: [{ mimeType: 'text/plain', data: 'DROPPED' }], dragOperationsMask: 1 },
    }
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
      await cdp.send('Input.dispatchDragEvent', { type, ...drag })
    }
    await expect(page.locator('body[data-test-dropped]')).toHaveCount(1)
    expect(await structure(page)).toBe(before)
    await expectChanges(page, 0)
    await unchanged(page, 'inline.html')
  })
})

test.describe('AC-05: IME', () => {
  test('commit and cancel', async ({ page }) => {
    await openFixture(page, 'basic.html')
    const cdp = await page.context().newCDPSession(page)
    const compose = (text: string): Promise<unknown> =>
      cdp.send('Input.imeSetComposition', {
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
      })
    const commit = (text: string): Promise<unknown> => cdp.send('Input.insertText', { text })

    // Cancelled composition: nothing changes.
    await caret(page, 'p:nth-of-type(2)', '営業部門', 2)
    await compose('か')
    await compose('')
    await commit('')
    await expectChanges(page, 0)

    await caret(page, 'p.lead', '月次で', 2)
    await compose('に')
    await compose('にち')
    await compose('日')
    await commit('日')
    await expect(page.locator('.change-after')).toHaveText(
      '現行システムでは受注データを月次日で集計している。',
    )
    const { source } = await saveFile(page, 'basic.html')
    expectSingleReplacement(fixtureSource('basic.html'), source, '月次で', '月次日で')
  })
})

test.describe('AC-06: emptying an element', () => {
  test('the element stays without <br> and saves as empty', async ({ page }) => {
    await openFixture(page, 'basic.html')
    const before = await structure(page)
    await caret(page, 'li', '受注登録', 0, 4)
    await page.keyboard.press('Backspace')
    expect(await structure(page)).toBe(before)
    expect(await innerHtml(page, 'li')).toBe('')
    await expect(page.locator('.change-after')).toHaveText('（空）')
    const { source } = await saveFile(page, 'basic.html')
    expectSingleReplacement(fixtureSource('basic.html'), source, '<li>受注登録</li>', '<li></li>')
  })
})

test('AC-07: scripts in the document never run while editing', async ({ page }) => {
  const ran: string[] = []
  page.on('console', (m) => {
    if (m.text().includes('MEND_SCRIPT_RAN')) ran.push(m.text())
  })
  page.on('dialog', (d) => {
    ran.push(`dialog: ${d.message()}`)
    void d.dismiss()
  })
  await openFixture(page, 'scripts.html')
  const f = frame(page)
  await f.locator('p[onmouseover]').hover()
  await f.locator('button').click()
  await f.locator('a').click()
  await caret(page, '#static', '静的な段落', 2)
  await page.keyboard.type('x')
  await page.waitForTimeout(300)
  expect(ran).toEqual([])
  expect(await f.locator('#generated').evaluate((el) => el.childNodes.length)).toBe(0)
  await expect(page.locator('.status-mode')).toHaveText('編集モード：スクリプト無効')
  const { source } = await saveFile(page, 'scripts.html')
  expectSingleReplacement(fixtureSource('scripts.html'), source, '静的な段落', '静的xな段落')
  expect(ran).toEqual([])
})

test.describe('AC-09: undo and redo', () => {
  test('buttons and keys move between states; undoing everything saves the original bytes', async ({
    page,
  }) => {
    await openFixture(page, 'basic.html')
    const undo = page.getByRole('button', { name: '元に戻す' })
    const redo = page.getByRole('button', { name: 'やり直す' })
    await expect(undo).toBeDisabled()

    await caret(page, 'p.lead', '月次で', 2)
    await page.keyboard.type('XY')
    await caret(page, 'li', '受注登録', 4)
    await page.keyboard.type('Z')
    await expectChanges(page, 2)

    await undo.click()
    expect(await innerHtml(page, 'li')).toBe('受注登録')
    await expect(redo).toBeEnabled()
    await redo.click()
    expect(await innerHtml(page, 'li')).toBe('受注登録Z')

    // Save in between: undo still works across the save (S-05).
    const saved = await saveFile(page, 'basic.html')
    expect(saved.source).toContain('月次XYで')
    expect(saved.source).toContain('<li>受注登録Z</li>')

    await frame(page).locator('li').first().click()
    await page.keyboard.press('ControlOrMeta+z')
    await page.keyboard.press('ControlOrMeta+z')
    expect(await innerHtml(page, 'p.lead')).toBe('現行システムでは受注データを月次で集計している。')
    expect(await innerHtml(page, 'li')).toBe('受注登録')
    await expect(undo).toBeDisabled()
    await unchanged(page, 'basic.html')
  })
})

test.describe('AC-11: reverting one change from the list', () => {
  test('that place returns to the original bytes and the other change stays', async ({ page }) => {
    await openFixture(page, 'basic.html')
    await caret(page, 'p.lead', '月次で', 2)
    await page.keyboard.type('XY')
    await caret(page, 'li', '受注登録', 4)
    await page.keyboard.type('Z')
    await expectChanges(page, 2)

    await page
      .locator('.change-list > li')
      .filter({ hasText: '月次XYで' })
      .getByRole('button', { name: 'この変更を戻す', exact: true })
      .click()
    await expectChanges(page, 1)
    expect(await innerHtml(page, 'p.lead')).toBe('現行システムでは受注データを月次で集計している。')

    await pressSave(page)
    await expectSaved(page)
    expectSingleReplacement(
      fixtureSource('basic.html'),
      await readText(page, 'basic.html'),
      '<li>受注登録</li>',
      '<li>受注登録Z</li>',
    )
  })
})

test.describe('AC-12: line breaks', () => {
  test('Shift+Enter inserts <br>, the change list shows it, and only that place is saved', async ({
    page,
  }) => {
    await openFixture(page, 'basic.html')
    await caret(page, 'p.lead', '月次で', 2)
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('X')
    await expect(page.locator('.change-after')).toHaveText(
      '現行システムでは受注データを月次↵Xで集計している。',
    )
    const { source } = await saveFile(page, 'basic.html')
    expectSingleReplacement(fixtureSource('basic.html'), source, '月次で', '月次<br>Xで')
  })

  test('undoing the line break saves the original bytes', async ({ page }) => {
    await openFixture(page, 'basic.html')
    await caret(page, 'p.lead', '月次で', 2)
    await page.keyboard.press('Shift+Enter')
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expectChanges(page, 0)
    await unchanged(page, 'basic.html')
  })

  test('Enter in <pre> inserts a line break character', async ({ page }) => {
    await openFixture(page, 'pre.html')
    await caret(page, '#pre1', '4スペース', 1)
    await page.keyboard.press('Enter')
    const { source } = await saveFile(page, 'pre.html')
    expectSingleReplacement(fixtureSource('pre.html'), source, '4スペース', '4\nスペース')
  })
})
