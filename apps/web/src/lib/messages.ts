// Japanese UI text for errors and states. Error codes come from @mend/core, @mend/editor and the FileAdapter;
// their English messages are for logs only.
import type { SaveError, VerificationIssue } from '@mend/core'
import type { ReadOnlyReason } from '@mend/editor'
import type { FileErrorCode } from './fileAdapter'

export interface Message {
  readonly title: string
  readonly body: string
}

export function describeIssue(issue: VerificationIssue): string {
  switch (issue.kind) {
    case 'child-count':
      return `子要素の数が ${issue.expected} → ${issue.actual} に変わっています`
    case 'node-kind':
      return `ノードの種類が ${issue.expected} → ${issue.actual} に変わっています`
    case 'tag-name':
      return `要素が <${issue.expected}> → <${issue.actual}> に変わっています`
    case 'attributes':
      return '属性が変わっています'
    case 'text':
      return 'テキストが書き戻し後の期待値と一致しません'
    case 'comment':
      return 'コメントが変わっています'
    case 'doctype':
      return 'doctype が変わっています'
    case 'document-mode':
      return `描画モードが ${issue.expected} → ${issue.actual} に変わっています`
    case 'outside-patch':
      return '変更箇所以外のソースが変わっています'
  }
}

/** The dialog shown when a save was stopped before writing (requirements S-03, AC-08). */
export function saveErrorMessage(error: SaveError): Message {
  const unchanged = 'ファイルは書き換えていません。'
  switch (error.code) {
    case 'verification-failed':
      return {
        title: '保存を中止しました',
        body: `変更した文字以外の部分が、元のファイルと一致しませんでした。${unchanged}`,
      }
    case 'encode-failed':
      return {
        title: '保存を中止しました',
        body: `変更した文字を、元の表記を保ったままHTMLに書き戻せませんでした。${unchanged}`,
      }
    case 'non-editable':
    case 'unknown-record':
      return {
        title: '保存を中止しました',
        body: `編集できない箇所に変更が含まれていました。${unchanged}`,
      }
    case 'patch-failed':
    case 'rebase-failed':
      return {
        title: '保存を中止しました',
        body: `保存用のデータを作る途中で問題が見つかりました。${unchanged}`,
      }
  }
}

export function fileErrorMessage(code: FileErrorCode, fileName: string | undefined): Message {
  const name = fileName ? `${fileName} は、` : ''
  switch (code) {
    case 'invalid-utf8':
      return {
        title: 'ファイルを開けませんでした',
        body: `${name}UTF-8 として正しく読み込めませんでした。Shift_JIS など UTF-8 以外の文字コードで保存されている可能性があります。UTF-8 で保存し直してから開いてください。`,
      }
    case 'not-a-file':
      return {
        title: 'ファイルを開けませんでした',
        body: 'ドロップされたものはファイルではありません。HTML ファイルを1つドロップしてください。',
      }
    case 'permission-denied':
      return {
        title: 'ファイルにアクセスできませんでした',
        body: `${name}アクセスが許可されませんでした。もう一度操作して、ブラウザの確認で許可してください。`,
      }
    case 'read-failed':
      return {
        title: 'ファイルを開けませんでした',
        body: `${name}読み込めませんでした。移動・削除されていないか確認してください。`,
      }
    case 'write-failed':
      return {
        title: '保存できませんでした',
        body: `${name}書き込めませんでした。ファイルは書き換えていません。保存先の状態を確認してください。`,
      }
    case 'unsupported':
      return {
        title: 'このブラウザでは使えません',
        body: 'ファイルの読み書きに必要な機能（File System Access API）がありません。Chrome か Edge で開いてください。',
      }
  }
}

export function readOnlyMessage(reason: ReadOnlyReason): string {
  switch (reason.code) {
    case 'mapping-mismatch':
      return 'ブラウザでの表示と解析結果が一致しないため、読み取り専用で開きました。'
    case 'guard-failed':
      return '編集で崩れた構造を元に戻せなかったため、編集を止めました。保存はできます。'
    case 'resync-failed':
      return '保存は完了しましたが、表示との対応づけに失敗したため編集を止めました。ファイルを開き直してください。'
    case 'navigated':
      return '編集用の表示が別のページへの移動を繰り返したか、読み込み直せなかったため、編集を止めました。保存していない変更は保存できます。'
  }
}
