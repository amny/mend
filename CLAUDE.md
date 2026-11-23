# Mend

AIが出力したHTMLを、独自形式に変換せずそのまま編集するエディタ。要件は `docs/requirements.md`。

## 絶対に守ること

- 編集していない部分は、保存後も1バイトも変えない（要件定義書の「レベルB」）。
- 元のHTML文字列だけを正本とする。画面上のDOMを書き出して保存してはいけない。
  保存は、変更箇所だけをソースに書き戻す差分（`{ start, end, text }` のパッチ）で行う。
- 保存前の検証に通らない限り、ファイルには絶対に書き込まない。迷ったら編集不可・保存中止の側に倒す。
- parse5 は `sourceCodeLocationInfo: true` と `scriptingEnabled: false` で使う。
- 編集用のiframeは `sandbox="allow-same-origin"`（`allow-scripts` は付けない）にし、`designMode` で編集可能にする。
  元のHTMLに属性やタグを足すような前処理はしない（`contenteditable` も `<base>` も付けない）。

## 検証で決めた構成（`spikes/README.md`）

- 編集用iframeは **blob URL** で読み込む（srcdoc は doctype なし文書で parse5 と描画モードが食い違うため）。
- プレビュー用iframeは `sandbox="allow-scripts"` のみ（`allow-same-origin` は付けない）、blob URL で読み込む。
- 強調表示は Highlight API ＋ `adoptedStyleSheets`、ホバー枠は親ページ側の重ねた層で描く。iframe のDOMにノードを足さない。

## 構成

```
packages/core     解析、文字位置の対応表、パッチ生成・適用、保存前検証（DOM非依存・Vitest）
packages/editor   iframe表示、構造ガード、IME、Undo/Redo、変更一覧（PlaywrightでE2E）
apps/web          React の画面、File System Access API の FileAdapter
fixtures/         テスト用HTML（バイト列そのものが仕様。手で整形・保存しない）
spikes/           技術検証（ワークスペース外）
```

## コマンド

```bash
pnpm install
pnpm test              # 全パッケージのユニットテスト
pnpm test:e2e          # packages/editor と apps/web の E2E（インストール済みの Chrome を使う）
pnpm typecheck
pnpm lint
pnpm dev               # apps/web の開発サーバー
VITE_MEND_TEST_HOOKS=1 pnpm dev  # テスト用フック（window.__mendTestHooks、AC-08）を有効にする。本番ビルドでは付けない
pnpm fixtures:generate # fixtures/ を生成し直す（バイト列が変わるので注意）
pnpm fixtures:check    # fixtures/ の性質（CRLF、BOM など）を確認
```

## fixtures の扱い

- `fixtures/` は `scripts/generate-fixtures.ts` から生成する。直接編集せず、生成スクリプトを直して再生成する。
- 例外：`fixtures/ai-sample.html` は実際のAI出力で、生成対象ではない。差し替えるときは実物をそのままコピーする（エディタで保存し直さない）。
- `.gitattributes` で `-text`、`.editorconfig`・`.prettierignore` で整形対象外にしている。外さないこと。

## 規約

- 応答・ドキュメントは日本語。コミットメッセージ、識別子、ログ出力は英語。
- `any` 禁止（`unknown` を使う）。エラーは握りつぶさず、文脈のわかるメッセージを付ける。
- 見えない文字（U+00A0、BOM、ZWJ、異体字セレクタ、結合文字など）はコード中に直接書かず `String.fromCodePoint(...)` で作る（Prettier が `\u` エスケープを実体の文字に書き換えるため）。
- 関数型・不変を優先し、副作用は境界（iframe 操作・ファイル操作）に閉じ込める。
- テストや型チェックを削除・無効化してエラーを回避しない。
- マイルストーン（M1〜M5）ごとに止まってレビューを受け、マイルストーンごとにコミットする。
