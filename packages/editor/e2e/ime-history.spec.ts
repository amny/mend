// IME (AC-05), undo/redo across saves (AC-09), reverting one change (AC-11) and the U+00A0 rule after saving.
import { expect, test, type Page } from '@playwright/test'
import {
  caret,
  expectSingleReplacement,
  fixtureBytes,
  fixtureSource,
  innerHtml,
  NBSP,
  open,
  saveOk,
  state,
} from './helpers'

async function ime(page: Page): Promise<{
  compose: (text: string) => Promise<void>
  commit: (text: string) => Promise<void>
}> {
  const cdp = await page.context().newCDPSession(page)
  return {
    compose: async (text) => {
      await cdp.send('Input.imeSetComposition', {
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
      })
    },
    commit: async (text) => {
      await cdp.send('Input.insertText', { text })
    },
  }
}

test.describe('AC-05: IME', () => {
  test('compose, convert and commit; one undo step per composition', async ({ page }) => {
    await open(page, 'basic.html')
    await caret(page, 'p.lead', '月次で', 2)
    const { compose, commit } = await ime(page)
    await compose('に')
    await compose('にち')
    await compose('日')
    await commit('日')
    const s = await state(page)
    expect(s.changes.map((c) => c.after)).toEqual([
      '現行システムでは受注データを月次日で集計している。',
    ])
    const { source } = await saveOk(page)
    expectSingleReplacement(fixtureSource('basic.html'), source, '月次で', '月次日で')

    await page.keyboard.press('ControlOrMeta+z')
    expect(await innerHtml(page, 'p.lead')).toBe('現行システムでは受注データを月次で集計している。')
    expect((await saveOk(page)).bytes.equals(fixtureBytes('basic.html'))).toBe(true)
  })

  test('cancelling a composition leaves the text unchanged', async ({ page }) => {
    await open(page, 'basic.html')
    await caret(page, 'p.lead', '月次で', 2)
    const { compose, commit } = await ime(page)
    await compose('か')
    await compose('')
    await commit('')
    expect((await state(page)).changes).toEqual([])
    expect((await saveOk(page)).bytes.equals(fixtureBytes('basic.html'))).toBe(true)
  })

  test('composing at an element boundary', async ({ page }) => {
    await open(page, 'inline.html')
    await caret(page, '#p1', 'この文は', 4)
    const { compose, commit } = await ime(page)
    await compose('あ')
    await compose('亜')
    await commit('亜')
    expect((await state(page)).readOnly).toBeNull()
    const { source } = await saveOk(page)
    expectSingleReplacement(
      fixtureSource('inline.html'),
      source,
      'この文は<strong>',
      'この文は亜<strong>',
    )
  })
})

test.describe('AC-09: undo / redo', () => {
  test('undo everything and save is byte-identical; redo brings the edits back', async ({
    page,
  }) => {
    await open(page, 'entities.html')
    await caret(page, '#named', 'Jerry', 5)
    await page.keyboard.type('!')
    await caret(page, '#nbsp', '単語', 0)
    await page.keyboard.press('Delete')
    await caret(page, '#astral', 'サロゲート', 5)
    await page.keyboard.type('😀')
    const edited = await state(page)
    expect(edited.changes).toHaveLength(3)

    while ((await state(page)).canUndo) await page.keyboard.press('ControlOrMeta+z')
    expect((await state(page)).changes).toEqual([])
    expect((await saveOk(page)).bytes.equals(fixtureBytes('entities.html'))).toBe(true)

    while ((await state(page)).canRedo) await page.keyboard.press('ControlOrMeta+Shift+z')
    expect((await state(page)).changes).toEqual(edited.changes)
  })

  test('undo works across a save', async ({ page }) => {
    await open(page, 'crlf.html')
    const original = fixtureSource('crlf.html')
    const needle = original.match(/>([^<\r\n]{4,})</)?.[1]
    if (!needle) throw new Error('no text found in crlf.html')
    await caret(page, 'body', needle, 1)
    await page.keyboard.type('+')
    const first = await saveOk(page)
    expect(first.bytes.equals(fixtureBytes('crlf.html'))).toBe(false)
    expect((await state(page)).changes).toEqual([])
    await page.keyboard.press('ControlOrMeta+z')
    expect((await state(page)).changes).toHaveLength(1)
    expect((await saveOk(page)).bytes.equals(fixtureBytes('crlf.html'))).toBe(true)
    await page.keyboard.press('ControlOrMeta+y')
    expect((await saveOk(page)).bytes.equals(first.bytes)).toBe(true)
  })

  test('U+00A0 typed by Chrome is normalized in the DOM and the history after saving', async ({
    page,
  }) => {
    await open(page, 'basic.html')
    await caret(page, 'p.lead', '集計している。', 7)
    await page.keyboard.type(' ')
    const typed = (await state(page)).changes[0]?.after ?? ''
    // Chrome keeps a trailing typed space visible by inserting U+00A0.
    expect(typed).toContain(NBSP)
    await saveOk(page)
    const afterSave = await innerHtml(page, 'p.lead')
    // A lone space is written as a normal space; whatever Chrome put in the DOM now matches the source.
    expect(afterSave).toBe(typed.replaceAll(NBSP, ' '))
    expect((await state(page)).changes).toEqual([])
    await page.keyboard.press('ControlOrMeta+z')
    await page.keyboard.press('ControlOrMeta+y')
    // Redo restores the normalized value, so it is not a change against the saved source.
    expect((await state(page)).changes).toEqual([])
  })
})

test('AC-11: reverting one change keeps the others', async ({ page }) => {
  await open(page, 'basic.html')
  await caret(page, 'p.lead', '月次で', 2)
  await page.keyboard.type('A')
  await caret(page, 'p:nth-of-type(2)', '日次', 2)
  await page.keyboard.type('B')
  const s = await state(page)
  expect(s.changes).toHaveLength(2)
  const first = s.changes[0]
  if (!first) throw new Error('no change')
  await page.evaluate((id) => window.mendTest.editor().revertChange(id), first.recordId)
  const after = await state(page)
  expect(after.changes.map((c) => c.after)).toEqual([
    '営業部門からは日次Bでの把握が求められている。',
  ])
  // The revert itself is undoable.
  expect(after.canUndo).toBe(true)
  const { source } = await saveOk(page)
  expectSingleReplacement(fixtureSource('basic.html'), source, '日次で', '日次Bで')
  await page.keyboard.press('ControlOrMeta+z')
  expect(await innerHtml(page, 'p.lead')).toContain('月次Aで')
})
