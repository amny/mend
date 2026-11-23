# spikes

本番コードに入れない技術検証の置き場。ワークスペース（`pnpm-workspace.yaml`）には含めない。

## sandbox-designmode（2026-11-20 実施）

編集用 iframe の構成が成り立つかを、実際の Chrome（Playwright `channel: 'chrome'`、headless）で確認した。

```bash
cd spikes/sandbox-designmode && pnpm install && node run.mjs
```

- `harness.html`：親ページ側。iframe の生成、designMode、イベント登録、MutationObserver、Highlight API をすべて親の権限で行う
- `run.mjs`：シナリオを流して結果を JSON で出力する

### 結果

| 確認項目 | 本命：blob URL ＋ `sandbox="allow-same-origin"` | 代替：`allow-scripts allow-same-origin` ＋ `csp="script-src 'none'"` |
| --- | --- | --- |
| 親から `contentDocument` を操作できる | ✅ | ✅ |
| `<script>`・`onerror`・`alert` が実行されない | ✅ | ✅ |
| `<noscript>` の中身が要素として解析される | ✅ | ❌ テキストになる（スクリプト有効扱い） |
| designMode で入力でき、親で登録したイベントが届く | ✅ | ✅ |
| `beforeinput` で Enter（insertParagraph）・Ctrl+B（formatBold）を止められる | ✅ ガードなしでは段落分割と `<b>` 挿入が起きることも確認 | ✅ |
| `getTargetRanges()` で要素をまたぐ削除を判定し止められる | ✅ | ✅ |
| テキストを全部消す削除を自前で `data = ''` にすると `<br>` が入らず、テキストノードも残る | ✅ ガードなしでは `<br>` が入る | ✅ |
| CDP（`Input.imeSetComposition` / `Input.insertText`）で IME の変換・確定・キャンセルを再現できる | ✅ composition イベントが届き、結果も正しい | ✅ |
| Highlight API と `adoptedStyleSheets` を親から使える | ✅ MutationObserver の記録は 0 件 | ✅ |
| プレビュー（`sandbox="allow-scripts"` のみ＋ blob URL） | ✅ スクリプトは動き、親からは中身にアクセスできない。`alert` は表示されない | — |

doctype なし文書の比較：

| 読み込み方 | `compatMode` | `<p>` の中に `<table>` が入るか | parse5 との一致 |
| --- | --- | --- | --- |
| blob URL | `BackCompat` | 入る | 一致（parse5 も quirks） |
| srcdoc | `CSS1Compat` | 入る | 木は一致するが描画モードが食い違う |

parse5 v8.1.1 は iframe srcdoc を特別扱いせず、doctype がなければ常に quirks モードで木を作る（`dist/parser/index.js` で確認）。

その他：プログラムで Selection を設定しただけでは入力を受け付けず、iframe をクリックしてフォーカスを移す必要があった。実際の操作と同じなので問題ない。E2E ではクリックから始める。

追加の確認（M3、2026-11-20）：

- `<meta http-equiv="refresh">`（遅延 0 秒・1 秒、URL 指定あり・なし）は、`allow-scripts` のない sandbox では Chrome が実行しない。遷移はほぼ起きないが、要件 5.1 のとおり、想定外の読み込みを検知したら最後に保存したソースを読み込み直し、未保存の変更と Undo の履歴を引き継ぐ。10 秒以内に 4 回以上続いた場合と、読み込み直した表示が解析結果と一致しない場合は、編集を止める（未保存の変更は保存できる）。
- Playwright の `locator.dragTo` と `page.mouse` によるドラッグは、`dragstart` を止めると完了を待ち続けて止まる。E2E では CDP の `Input.dispatchDragEvent` で外部からのドロップを再現し、`dragstart` が止まることは合成イベントで確認する。

### 決めたこと

- 編集用 iframe は **blob URL ＋ `sandbox="allow-same-origin"` ＋ `designMode = 'on'`** で読み込む（要件 5.1 の srcdoc から変更）。
- 代替案（`allow-scripts` ＋ `csp`）は採用しない。`<noscript>` の解析が parse5（`scriptingEnabled: false`）と食い違うため。
- プレビュー用 iframe は **`sandbox="allow-scripts"` のみ**（`allow-same-origin` と `allow-modals` は付けない）で、blob URL で読み込む。
- テキストを空にする削除は `beforeinput` で止めて、自前で `data = ''` にする（AC-06）。
- 変更箇所・検索結果の強調は Highlight API ＋ `adoptedStyleSheets` で描く。ホバー枠とラベルは親ページ側に重ねた層で描く。
- AC-05 の自動テストは CDP で IME を再現する。実際の IME での確認は `docs/manual-tests.md` に手順を残す。
