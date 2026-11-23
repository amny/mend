import { describe, expect, it } from 'vitest'
import {
  caretLocation,
  detectLineEnding,
  encodingLabel,
  formatOpenedAt,
  visibleText,
} from '../src/lib/format'
import { describeIssue, fileErrorMessage, saveErrorMessage } from '../src/lib/messages'

describe('formatOpenedAt', () => {
  const now = new Date(2026, 10, 20, 9, 0).getTime()
  it('uses relative words for today and yesterday, dates otherwise', () => {
    expect(formatOpenedAt(new Date(2026, 10, 20, 0, 1).getTime(), now)).toBe('今日')
    expect(formatOpenedAt(new Date(2026, 10, 19, 23, 59).getTime(), now)).toBe('昨日')
    expect(formatOpenedAt(new Date(2026, 10, 12).getTime(), now)).toBe('11月12日')
    expect(formatOpenedAt(new Date(2025, 10, 12).getTime(), now)).toBe('2025年11月12日')
  })
})

describe('line endings and encoding label', () => {
  it('detects the line ending style', () => {
    expect(detectLineEnding('a\r\nb\r\n')).toBe('CRLF')
    expect(detectLineEnding('a\nb')).toBe('LF')
    expect(detectLineEnding('a\rb')).toBe('CR')
    expect(detectLineEnding('a\r\nb\n')).toBe('混在')
    expect(detectLineEnding('ab')).toBe('なし')
  })
  it('builds the status bar label', () => {
    expect(encodingLabel(false, 'a\r\n')).toBe('UTF-8 ／ CRLF')
    expect(encodingLabel(true, 'a\n')).toBe('UTF-8（BOM付き） ／ LF')
    expect(encodingLabel(false, 'a')).toBe('UTF-8')
  })
})

describe('visibleText', () => {
  it('makes invisible characters visible', () => {
    expect(visibleText('')).toBe('（空）')
    expect(visibleText(`a${String.fromCodePoint(0xa0)}b\nc`)).toBe('a⍽b↵c')
  })
})

describe('messages', () => {
  it('describes verification issues in Japanese', () => {
    expect(
      describeIssue({ kind: 'child-count', path: 'table › tbody', expected: '2', actual: '3' }),
    ).toBe('子要素の数が 2 → 3 に変わっています')
  })
  it('always says the file was not changed when a save is stopped', () => {
    for (const code of [
      'verification-failed',
      'encode-failed',
      'non-editable',
      'unknown-record',
      'patch-failed',
      'rebase-failed',
    ] as const) {
      expect(saveErrorMessage({ code, message: '', issues: [] }).body).toContain(
        'ファイルは書き換えていません',
      )
    }
  })
  it('mentions non-UTF-8 encodings for undecodable files (F-01)', () => {
    expect(fileErrorMessage('invalid-utf8', 'a.html').body).toContain('Shift_JIS')
  })
})

describe('caretLocation', () => {
  it('replaces the last label step with the element', () => {
    expect(caretLocation({ element: 'p.lead', label: '1. 背景と目的 › p' })).toBe(
      '1. 背景と目的 › p.lead',
    )
    expect(caretLocation({ element: 'div.card', label: '概要 › .card' })).toBe('概要 › div.card')
    expect(caretLocation({ element: 'h1', label: '' })).toBe('h1')
    expect(caretLocation({ element: 'td', label: '2. 機能要件 › table' })).toBe(
      '2. 機能要件 › table › td',
    )
  })
})
