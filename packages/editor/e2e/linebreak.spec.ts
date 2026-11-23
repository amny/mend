// Line breaks in text (stage 1): where line breaks are rendered (pre, pre-wrap, pre-line), Enter inserts "\n"
// into the text node; the file's line ending is used when saving.
import { expect, test } from '@playwright/test'
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

test.describe('preformatted text', () => {
  test('Enter and Shift+Enter insert a line break in <pre> and pre-wrap', async ({ page }) => {
    await open(page, 'pre.html')
    const before = await structure(page)
    await caret(page, '#pre1', '4スペース', 1)
    await page.keyboard.press('Enter')
    await caret(page, '#pw', '連続空白', 2)
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('x')
    expect(await structure(page)).toBe(before)
    expect(await innerHtml(page, '#pre1')).toContain('4\nスペースのインデント')
    expect(await innerHtml(page, '#pw')).toContain('連続\nx空白')
    expect((await state(page)).changes).toHaveLength(2)
    const { source } = await saveOk(page)
    expectSingleReplacement(
      fixtureSource('pre.html').replace('連続空白\n  と改行', '連続\nx空白\n  と改行'),
      source,
      '4スペース',
      '4\nスペース',
    )
  })

  test('undo removes the line break', async ({ page }) => {
    await open(page, 'pre.html')
    await caret(page, '#pre1', '4スペース', 1)
    await page.keyboard.press('Enter')
    await page.keyboard.press('ControlOrMeta+z')
    expect((await state(page)).changes).toEqual([])
  })

  test('the file line ending is used (CRLF)', async ({ page }) => {
    await page.goto('/')
    const source = '<!DOCTYPE html>\r\n<html><body>\r\n<pre id="p">ab</pre>\r\n</body></html>\r\n'
    await page.evaluate((s) => window.mendTest.openSource(s), source)
    await caret(page, '#p', 'ab', 1)
    await page.keyboard.press('Enter')
    const saved = await saveOk(page)
    expect(saved.source).toBe(source.replace('>ab<', '>a\r\nb<'))
  })

  test('pasted line breaks are kept in <pre>', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await open(page, 'pre.html')
    const before = await structure(page)
    await page.evaluate(() => navigator.clipboard.writeText('一行目\r\n二行目'))
    await caret(page, '#pre1', '4スペース', 1)
    await page.keyboard.press('ControlOrMeta+v')
    expect(await structure(page)).toBe(before)
    const { source } = await saveOk(page)
    expectSingleReplacement(
      fixtureSource('pre.html'),
      source,
      '4スペース',
      '4一行目\n二行目スペース',
    )
  })
})

test('Enter still does nothing in a normal paragraph', async ({ page }) => {
  await open(page, 'pre.html')
  const before = await structure(page)
  await caret(page, '#normal', '通常の', 2)
  await page.keyboard.press('Enter')
  expect(await structure(page)).toBe(before)
  expect((await state(page)).changes).toEqual([])
})

// Stage 2: Shift+Enter outside preformatted text inserts a new <br> (AC-12).
const LEAD = '現行システムでは受注データを月次で集計している。'
const ZWSP = String.fromCodePoint(0x200b)

test.describe('new <br> line breaks', () => {
  test('Shift+Enter splits the text with a <br> and saves only that', async ({ page }) => {
    await open(page, 'basic.html')
    await caret(page, 'p.lead', '月次で', 2)
    await page.keyboard.press('Shift+Enter')
    expect(await innerHtml(page, 'p.lead')).toBe(
      '現行システムでは受注データを月次<br>で集計している。',
    )
    const s = await state(page)
    expect(s.changes.map((c) => c.after)).toEqual([
      '現行システムでは受注データを月次\nで集計している。',
    ])
    expect(s.readOnly).toBeNull()
    const { source } = await saveOk(page)
    expectSingleReplacement(fixtureSource('basic.html'), source, '月次で', '月次<br>で')
  })

  test('typing on the new line, Backspace at its start joins, undo and redo step through', async ({
    page,
  }) => {
    await open(page, 'basic.html')
    const before = await structure(page)
    await caret(page, 'p.lead', '月次で', 2)
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('X')
    expect(await innerHtml(page, 'p.lead')).toBe(
      '現行システムでは受注データを月次<br>Xで集計している。',
    )
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    expect(await innerHtml(page, 'p.lead')).toBe(LEAD)
    expect(await structure(page)).toBe(before)
    expect((await state(page)).changes).toEqual([])

    // Typing X and deleting it right away is one typing step that cancels out (COALESCE_MS).
    await page.keyboard.press('ControlOrMeta+z')
    expect(await innerHtml(page, 'p.lead')).toBe(
      '現行システムでは受注データを月次<br>で集計している。',
    )
    await page.keyboard.press('ControlOrMeta+z')
    expect(await innerHtml(page, 'p.lead')).toBe(LEAD)
    await page.keyboard.press('ControlOrMeta+y')
    expect(await innerHtml(page, 'p.lead')).toBe(
      '現行システムでは受注データを月次<br>で集計している。',
    )
    await page.keyboard.press('ControlOrMeta+z')
    expect((await saveOk(page)).bytes.equals(fixtureBytes('basic.html'))).toBe(true)
  })

  test('Delete at the end of a line joins it with the next', async ({ page }) => {
    await open(page, 'basic.html')
    await caret(page, 'p.lead', '月次で', 2)
    await page.keyboard.press('Shift+Enter')
    await caret(page, 'p.lead', '受注データを月次', 8)
    await page.keyboard.press('Delete')
    expect(await innerHtml(page, 'p.lead')).toBe(LEAD)
    expect((await state(page)).changes).toEqual([])
  })

  test('a line break at the end, then typing', async ({ page }) => {
    await open(page, 'basic.html')
    await caret(page, 'p.lead', '集計している。', 7)
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('追記')
    expect(await innerHtml(page, 'p.lead')).toBe(`${LEAD}<br>追記`)
    const { source } = await saveOk(page)
    expectSingleReplacement(
      fixtureSource('basic.html'),
      source,
      '集計している。</p>',
      '集計している。<br>追記</p>',
    )
  })

  test('Shift+Enter replaces a selection', async ({ page }) => {
    await open(page, 'basic.html')
    await caret(page, 'p.lead', '月次で', 0, 2)
    await page.keyboard.press('Shift+Enter')
    expect(await innerHtml(page, 'p.lead')).toBe('現行システムでは受注データを<br>で集計している。')
  })

  test('the change list reverts a split text in one step, and undo brings it back', async ({
    page,
  }) => {
    await open(page, 'basic.html')
    await caret(page, 'p.lead', '月次で', 2)
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('X')
    await page.keyboard.press('Shift+Enter')
    const [change] = (await state(page)).changes
    if (!change) throw new Error('no change')
    await page.evaluate((id) => window.mendTest.editor().revertChange(id), change.recordId)
    expect(await innerHtml(page, 'p.lead')).toBe(LEAD)
    expect((await state(page)).changes).toEqual([])
    await page.keyboard.press('ControlOrMeta+z')
    expect(await innerHtml(page, 'p.lead')).toBe(
      '現行システムでは受注データを月次<br>X<br>で集計している。',
    )
    expect((await saveOk(page)).source).toContain('月次<br>X<br>で')
  })

  test('after saving, the <br> is part of the file: undo and Backspace keep it, other edits still undo', async ({
    page,
  }) => {
    await open(page, 'basic.html')
    const original = fixtureSource('basic.html')
    await caret(page, 'li', '受注登録', 4)
    await page.keyboard.type('Z')
    await caret(page, 'p.lead', '月次で', 2)
    await page.keyboard.press('Shift+Enter')
    const saved = await saveOk(page)
    expect(saved.source).toBe(
      original.replace('月次で', '月次<br>で').replace('<li>受注登録</li>', '<li>受注登録Z</li>'),
    )
    const after = await structure(page)
    // Backspace at the start of the saved line does not remove the <br>.
    await page.keyboard.press('Backspace')
    expect(await structure(page)).toBe(after)
    // Undo skips the line break and goes back to the earlier typing.
    await page.keyboard.press('ControlOrMeta+z')
    expect(await innerHtml(page, 'li')).toBe('受注登録')
    expect(await innerHtml(page, 'p.lead')).toBe(
      '現行システムでは受注データを月次<br>で集計している。',
    )
    const again = await saveOk(page)
    expect(again.source).toBe(original.replace('月次で', '月次<br>で'))
    // Each line is its own text now and can be edited and saved.
    await caret(page, 'p.lead', 'で集計', 0)
    await page.keyboard.type('Y')
    expect((await saveOk(page)).source).toBe(original.replace('月次で', '月次<br>Yで'))
  })

  test('the line break notation of the file is used', async ({ page }) => {
    await page.goto('/')
    const source =
      '<!DOCTYPE html><html><body><p id="a">一<br />二</p><p id="b">三四</p></body></html>'
    await page.evaluate((s) => window.mendTest.openSource(s), source)
    await caret(page, '#b', '三四', 1)
    await page.keyboard.press('Shift+Enter')
    expect((await saveOk(page)).source).toBe(source.replace('三四', '三<br />四'))
  })

  test('IME input on an empty new line at the end of the paragraph', async ({ page }) => {
    await open(page, 'basic.html')
    await caret(page, 'p.lead', '集計している。', 7)
    await page.keyboard.press('Shift+Enter')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'つ', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.imeSetComposition', { text: '追', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '追' })
    await page.keyboard.type('記')
    expect(await innerHtml(page, 'p.lead')).toBe(`${LEAD}<br>追記`)
    await page.keyboard.press('ControlOrMeta+z')
    await page.keyboard.press('ControlOrMeta+z')
    // The empty line holds a U+200B in the DOM only (so that the caret can be on it); it is never saved.
    expect(await innerHtml(page, 'p.lead')).toBe(`${LEAD}<br>${ZWSP}`)
    expect((await state(page)).changes.map((c) => c.after)).toEqual([`${LEAD}\n`])
    const { source } = await saveOk(page)
    expectSingleReplacement(
      fixtureSource('basic.html'),
      source,
      '集計している。</p>',
      '集計している。<br></p>',
    )
    await page.keyboard.press('ControlOrMeta+z')
    expect(await innerHtml(page, 'p.lead')).toBe(`${LEAD}<br>${ZWSP}`)
  })

  test('IME input on a new line', async ({ page }) => {
    await open(page, 'basic.html')
    await caret(page, 'p.lead', '月次で', 2)
    await page.keyboard.press('Shift+Enter')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'あ', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.imeSetComposition', { text: '亜', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '亜' })
    expect(await innerHtml(page, 'p.lead')).toBe(
      '現行システムでは受注データを月次<br>亜で集計している。',
    )
    expect((await state(page)).readOnly).toBeNull()
  })
})
