// AC-01 / AC-02 through the real editing iframe, and DOM/parse agreement for every fixture (requirements 5.2).
import { expect, test } from '@playwright/test'
import {
  caret,
  expectSingleReplacement,
  fixtureBytes,
  fixtureNames,
  fixtureSource,
  open,
  saveOk,
  state,
} from './helpers'

for (const name of fixtureNames()) {
  test(`${name}: the DOM matches the parse and an unedited save is byte-identical (AC-01)`, async ({
    page,
  }) => {
    const initial = await open(page, name)
    expect(initial.readOnly).toBeNull()
    expect(initial.changes).toEqual([])
    const { bytes } = await saveOk(page)
    expect(bytes.equals(fixtureBytes(name))).toBe(true)
  })
}

test('typing one character changes only that text (AC-02)', async ({ page }) => {
  await open(page, 'basic.html')
  await caret(page, 'p.lead', '月次で', 2)
  await page.keyboard.type('X')
  const s = await state(page)
  expect(s.changes).toHaveLength(1)
  expect(s.changes[0]).toMatchObject({
    before: '現行システムでは受注データを月次で集計している。',
    after: '現行システムでは受注データを月次Xで集計している。',
  })
  const { source } = await saveOk(page)
  expectSingleReplacement(fixtureSource('basic.html'), source, '月次で', '月次Xで')
  expect((await state(page)).changes).toEqual([])
})

test('editing next to a character reference keeps its notation (AC-03)', async ({ page }) => {
  await open(page, 'entities.html')
  await caret(page, '#named', 'Tom & Jerry', 4)
  await page.keyboard.press('Backspace')
  await page.keyboard.type('＆')
  await page.keyboard.press('Delete')
  const { source } = await saveOk(page)
  expectSingleReplacement(fixtureSource('entities.html'), source, 'Tom &amp; Jerry', 'Tom＆ Jerry')
})

test('typing at an element boundary is merged into the existing text node', async ({ page }) => {
  await open(page, 'inline.html')
  // Caret right after "この文は", just before <strong>.
  await caret(page, '#p1', 'この文は', 4)
  await page.keyboard.type('Z')
  const s = await state(page)
  expect(s.readOnly).toBeNull()
  expect(s.changes.map((c) => c.after)).toEqual(['この文はZ'])
  const { source } = await saveOk(page)
  expectSingleReplacement(
    fixtureSource('inline.html'),
    source,
    'この文は<strong>',
    'この文はZ<strong>',
  )
})

test('the save can be made to fail verification and nothing changes (AC-08 hook)', async ({
  page,
}) => {
  await open(page, 'basic.html')
  await caret(page, 'p.lead', '月次で', 2)
  await page.keyboard.type('X')
  const outcome = await page.evaluate(() => window.mendTest.save(true))
  expect(outcome).toMatchObject({ ok: false, code: 'verification-failed' })
  expect((await state(page)).changes).toHaveLength(1)
})
