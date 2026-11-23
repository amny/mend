// Opening and saving through the app: AC-01/02 for every fixture, AC-08 (save stopped by verification) and AC-10
// (overwrite, save as, unsaved-changes warnings, external modification). The native pickers are replaced by
// fakeFileSystem.ts.
import { expect, test, type Page } from '@playwright/test'
import {
  caret,
  expectChanges,
  expectSaved,
  expectSingleReplacement,
  fixtureBytes,
  fixtureNames,
  fixtureSource,
  launch,
  openFixture,
  openWithPicker,
  pressSave,
  readFile,
  readText,
  writes,
} from './helpers'

const ORIGINAL = fixtureSource('basic.html')
const EDITED = (): string => ORIGINAL.replace('月次で集計', '月次XYで集計')

/** Types "XY" into the lead paragraph of basic.html. */
async function editLead(page: Page): Promise<void> {
  await caret(page, 'p.lead', '月次で', 2)
  await page.keyboard.type('XY')
  await expect(page.locator('.dirty-badge')).toHaveText('未保存の変更 1件')
}

const dialog = (page: Page) => page.getByRole('dialog')

test.describe('AC-01 / AC-02 through the app', () => {
  for (const name of fixtureNames()) {
    test(`${name}: saving without edits writes the original bytes`, async ({ page }) => {
      await openFixture(page, name)
      await page.getByRole('button', { name: /^保存/ }).click()
      await expectSaved(page)
      await expect(page.getByRole('status')).toContainText('変更はありません')
      expect((await readFile(page, name)).equals(fixtureBytes(name))).toBe(true)
    })
  }

  test('one edit changes only that text', async ({ page }) => {
    await openFixture(page, 'basic.html')
    await editLead(page)
    await pressSave(page)
    await expectSaved(page)
    expectSingleReplacement(ORIGINAL, await readText(page, 'basic.html'), '月次で', '月次XYで')
  })
})

test.describe('AC-08: a save stopped by verification', () => {
  test('nothing is written and the reason is shown', async ({ page }) => {
    await openFixture(page, 'basic.html')
    await editLead(page)
    await page.evaluate(() => {
      if (!window.__mendTestHooks) throw new Error('test hooks are not compiled in')
      window.__mendTestHooks.failNextSave()
    })
    await pressSave(page)
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page)).toContainText('ファイルは書き換えていません')
    await expect(dialog(page).locator('pre.issue')).not.toBeEmpty()
    expect(await writes(page)).toBe(0)
    expect((await readFile(page, 'basic.html')).equals(fixtureBytes('basic.html'))).toBe(true)
    // The change is kept, and the next save (no fault) goes through.
    await dialog(page).getByRole('button', { name: '閉じる' }).click()
    await expectChanges(page, 1)
    await page.getByRole('button', { name: /^保存/ }).click()
    await expectSaved(page)
    expect(await readText(page, 'basic.html')).toBe(EDITED())
  })
})

test.describe('AC-10: saving and warnings', () => {
  test('overwrite save (F-02), then saving again does not report a conflict', async ({ page }) => {
    await openFixture(page, 'basic.html')
    await editLead(page)
    await expect(page).toHaveTitle('● basic.html - Mend')
    await pressSave(page)
    await expectSaved(page)
    expect(await readText(page, 'basic.html')).toBe(EDITED())
    await expect(page).toHaveTitle('basic.html - Mend')
    await expect(page.locator('.dirty-badge')).toHaveCount(0)
    await expectChanges(page, 0)

    // Mend's own write must not look like an external change.
    await caret(page, 'li', '受注登録', 4)
    await page.keyboard.type('Z')
    await pressSave(page)
    await expect(dialog(page)).toHaveCount(0)
    await expect.poll(() => writes(page)).toBe(2)
    expect(await readText(page, 'basic.html')).toBe(
      EDITED().replace('<li>受注登録</li>', '<li>受注登録Z</li>'),
    )
  })

  test('save as (F-03) writes a new file and later saves go there', async ({ page }) => {
    await openFixture(page, 'basic.html')
    await editLead(page)

    // Cancelling the picker writes nothing and keeps the changes.
    await page.evaluate(() => {
      window.__fakeFs.nextSave = null
    })
    await page.getByRole('button', { name: '別名で保存' }).click()
    await expect(page.getByRole('button', { name: '別名で保存' })).toBeEnabled()
    expect(await writes(page)).toBe(0)
    await expectChanges(page, 1)

    await page.evaluate(() => {
      window.__fakeFs.nextSave = 'copy.html'
    })
    await page.getByRole('button', { name: '別名で保存' }).click()
    await expectSaved(page)
    expect(await page.evaluate(() => window.__fakeFs.lastSuggestedName)).toBe('basic.html')
    expect(await readText(page, 'copy.html')).toBe(EDITED())
    expect((await readFile(page, 'basic.html')).equals(fixtureBytes('basic.html'))).toBe(true)
    await expect(page.locator('.file-name')).toHaveText('copy.html')
    await expect(page).toHaveTitle('copy.html - Mend')

    await caret(page, 'li', '受注登録', 4)
    await page.keyboard.type('Z')
    await pressSave(page)
    await expect.poll(() => writes(page)).toBe(2)
    expect(await readText(page, 'copy.html')).toContain('<li>受注登録Z</li>')
    expect((await readFile(page, 'basic.html')).equals(fixtureBytes('basic.html'))).toBe(true)
  })

  test('unsaved changes ask before leaving the file (F-04)', async ({ page }) => {
    await launch(page, {
      'basic.html': fixtureBytes('basic.html'),
      'inline.html': fixtureBytes('inline.html'),
    })
    await openWithPicker(page, 'basic.html')
    const beforeUnloadPrevented = (): Promise<boolean> =>
      page.evaluate(() => {
        const e = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(e)
        return e.defaultPrevented
      })
    await expect.poll(beforeUnloadPrevented).toBe(false)

    await editLead(page)
    await expect.poll(beforeUnloadPrevented).toBe(true)

    // Back to the start screen: cancel keeps the editor and the changes.
    await page.getByRole('button', { name: 'Mend' }).click()
    await expect(dialog(page)).toContainText('保存されていない変更があります')
    await dialog(page).getByRole('button', { name: 'キャンセル' }).click()
    await expect(dialog(page)).toHaveCount(0)
    await expectChanges(page, 1)

    // Ctrl+O asks too; discarding opens the other file.
    await page.evaluate(() => {
      window.__fakeFs.nextOpen = 'inline.html'
    })
    await page.locator('.file-name').click()
    await page.keyboard.press('ControlOrMeta+o')
    await expect(dialog(page)).toContainText('保存されていない変更があります')
    await dialog(page).getByRole('button', { name: '変更を破棄して続ける' }).click()
    await expect(page.locator('.file-name')).toHaveText('inline.html')
    await expect(page).toHaveTitle('inline.html - Mend')
    await expect.poll(beforeUnloadPrevented).toBe(false)
    expect(await writes(page)).toBe(0)
    expect((await readFile(page, 'basic.html')).equals(fixtureBytes('basic.html'))).toBe(true)
  })

  test('a file changed on disk is not overwritten without asking (F-05)', async ({ page }) => {
    await openFixture(page, 'basic.html')
    await editLead(page)
    const external = ORIGINAL.replace('基本動作', '外部で変更')
    const putExternal = (): Promise<void> =>
      page.evaluate(
        (b) => window.__fakeFs.modifyExternally('basic.html', b),
        Buffer.from(external).toString('base64'),
      )
    await putExternal()

    // Cancel: the external version stays.
    await pressSave(page)
    await expect(dialog(page)).toContainText('ファイルが別の場所で更新されています')
    await dialog(page).getByRole('button', { name: 'キャンセル' }).click()
    expect(await readText(page, 'basic.html')).toBe(external)
    await expectChanges(page, 1)

    // Save as from the conflict dialog: the new file gets Mend's version, the original keeps the external one.
    await page.evaluate(() => {
      window.__fakeFs.nextSave = 'mine.html'
    })
    await pressSave(page)
    await dialog(page).getByRole('button', { name: '別名で保存' }).click()
    await expectSaved(page)
    expect(await readText(page, 'mine.html')).toBe(EDITED())
    expect(await readText(page, 'basic.html')).toBe(external)
  })

  test('overwriting after an external change writes Mend’s version (F-05)', async ({ page }) => {
    await openFixture(page, 'basic.html')
    await editLead(page)
    await page.evaluate(
      (b) => window.__fakeFs.modifyExternally('basic.html', b),
      Buffer.from('<p>external</p>').toString('base64'),
    )
    await pressSave(page)
    await dialog(page).getByRole('button', { name: '上書きする' }).click()
    await expectSaved(page)
    expect(await readText(page, 'basic.html')).toBe(EDITED())
  })
})
