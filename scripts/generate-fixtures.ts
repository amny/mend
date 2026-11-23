// Generates fixtures/ (requirements 7.2) with exact bytes.
// Fixtures are specifications: CRLF, BOM, tabs and trailing whitespace are intentional.
// Usage: pnpm fixtures:generate
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url))
// Invisible code points are built from numbers so formatters cannot silently rewrite them.
const cp = (...codes: readonly number[]): string => String.fromCodePoint(...codes)
const BOM = cp(0xfeff)

const lines = (...ls: readonly string[]): string => ls.join('\n') + '\n'

const basic = lines(
  '<!DOCTYPE html>',
  '<html lang="ja">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <title>基本動作</title>',
  '  <style>',
  '    body { font-family: sans-serif; margin: 2rem; }',
  '    table { border-collapse: collapse; }',
  '    th, td { border: 1px solid #ccc; padding: 4px 8px; }',
  '  </style>',
  '</head>',
  '<body>',
  '  <h1 id="title" class="page-title">受注管理システム 要件定義書</h1>',
  '  <h2>1. 背景と目的</h2>',
  '  <p class="lead">現行システムでは受注データを月次で集計している。</p>',
  '  <p>営業部門からは日次での把握が求められている。</p>',
  '  <ul>',
  '    <li>受注登録</li>',
  '    <li>在庫引当</li>',
  '    <li>出荷指示</li>',
  '  </ul>',
  '  <ol start="3" type="a">',
  '    <li>第一段階</li>',
  '    <li>第二段階</li>',
  '  </ol>',
  '  <h2>2. 機能要件</h2>',
  '  <table>',
  '    <thead>',
  '      <tr><th>ID</th><th>機能</th><th>要件</th></tr>',
  '    </thead>',
  '    <tbody>',
  '      <tr><td>FR-01</td><td>受注一覧</td><td>検索結果を最大1,000件まで表示する</td></tr>',
  '      <tr><td>FR-02</td><td>CSV出力</td><td>一覧の表示内容をCSVで出力する</td></tr>',
  '    </tbody>',
  '  </table>',
  '  <p>English text with   multiple   spaces and a trailing space. </p>',
  '</body>',
  '</html>',
)

const entities = lines(
  '<!DOCTYPE html>',
  '<html lang="ja">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <title>実体参照 &amp; 文字参照</title>',
  '</head>',
  '<body>',
  '  <h1 title="A&amp;B &quot;quoted&quot;">実体参照 &amp; 文字参照</h1>',
  '  <p id="named">Tom &amp; Jerry、&lt;tag&gt;、&quot;quote&quot;、&apos;apos&apos;</p>',
  '  <p id="nbsp">単語&nbsp;単語、連続&nbsp;&nbsp;&nbsp;空白、末尾&nbsp;</p>',
  '  <p id="numeric">10進 &#12354; と 16進 &#x3042; と 大文字X &#X3044; と ゼロ埋め &#0012356;</p>',
  '  <p id="legacy">セミコロンなし &copy 2026 &amp だけ、直後に文字 &copyright と &notin; と &not;</p>',
  '  <p id="raw">素の &amp;記号: AT&T、R&D、a & b、&unknown;</p>',
  '  <p id="upper">大文字 &AMP; と &COPY; と &LT;</p>',
  '  <p id="astral">サロゲート &#x1F600; と &#128512;</p>',
  '  <p id="mixed">あ&amp;い&nbsp;う&#x3048;え&copyお</p>',
  '  <p id="edge-start">&amp;先頭と末尾&amp;</p>',
  '  <p><a href="?a=1&amp;b=2&c=3">リンク &amp; 属性</a></p>',
  '</body>',
  '</html>',
)

const crlf =
  [
    '<!DOCTYPE html>',
    '<html lang="ja">',
    '<head>',
    '\t<meta charset="utf-8">',
    '\t<title>CRLF とタブ</title>',
    '</head>',
    '<body>',
    '\t<div class="card">',
    '\t\t<h2>改行コード CRLF</h2>',
    '\t\t<p>1行目の文章。',
    '\t\t2行目の文章（段落内のCRLF）。',
    '\t\t3行目の文章。</p>',
    '\t\t<p>単独CRを含む\r段落。</p>',
    '\t\t<ul>',
    '\t\t\t<li>タブで\tインデント</li>',
    '\t\t\t<li>末尾に空白 </li>\t',
    '\t\t</ul>',
    '\t</div>',
    '</body>',
    '</html>',
  ].join('\r\n') + '\r\n'

const emoji = lines(
  '<!DOCTYPE html>',
  '<html lang="ja">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <title>絵文字と結合文字</title>',
  '</head>',
  '<body>',
  '  <p id="basic">笑顔😀と猫🐱の間</p>',
  `  <p id="zwj">家族${cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466)}と虹の旗${cp(0x1f3f3, 0xfe0f, 0x200d, 0x1f308)}</p>`,
  `  <p id="skin">肌の色${cp(0x1f44d, 0x1f3fd)}と国旗${cp(0x1f1ef, 0x1f1f5)}</p>`,
  `  <p id="combining">結合文字：か${cp(0x3099)}（が）、e${cp(0x301)}（é）、한글</p>`,
  `  <p id="vs">異体字セレクタ：葛${cp(0xe0100)}と葛、☺${cp(0xfe0f)}と☺${cp(0xfe0e)}、#${cp(0xfe0f, 0x20e3)}</p>`,
  '  <p id="ref">参照の絵文字 &#x1F600; の後ろ</p>',
  '  <p id="edges">😀先頭と末尾😀</p>',
  '</body>',
  '</html>',
)

const inline = lines(
  '<!DOCTYPE html>',
  '<html lang="ja">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <title>インライン要素</title>',
  '</head>',
  '<body>',
  '  <p id="p1">この文は<strong>強調</strong>と<a href="https://example.com/">リンク</a>と<code>code()</code>を含む。</p>',
  '  <p id="p2"><strong>先頭が強調</strong>で始まり<em>末尾が斜体</em></p>',
  '  <p id="p3"><strong>強調の中に<a href="#x">リンク<code>と</code>コード</a>が入る</strong>文。</p>',
  '  <p id="p4"><b>隣接</b><i>する</i><code>要素</code></p>',
  '  <p id="p5">テキスト<span class="tag"></span>空の要素の後ろ</p>',
  '  <p id="p6">改行の<br>あとの文</p>',
  '  <p id="p7">画像<img src="data:," alt="">の隣</p>',
  '</body>',
  '</html>',
)

const scripts = lines(
  '<!DOCTYPE html>',
  '<html lang="ja">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <title>スクリプトを含む</title>',
  '  <script>console.log("MEND_SCRIPT_RAN:head"); alert("MEND_SCRIPT_RAN:alert");</script>',
  '  <script type="module">console.log("MEND_SCRIPT_RAN:module");</script>',
  '</head>',
  '<body>',
  '  <h1>スクリプトのテスト</h1>',
  '  <p id="static">静的な段落。</p>',
  '  <div id="generated"></div>',
  '  <script>',
  '    // Contains markup-like strings that must not end the script early.',
  '    const html = "<p>JSで生成した段落<\\/p></div>";',
  '    document.getElementById("generated").innerHTML = html;',
  '    console.log("MEND_SCRIPT_RAN:body");',
  '  </script>',
  '  <button type="button" onclick="console.log(\'MEND_SCRIPT_RAN:onclick\')">ボタン</button>',
  '  <p onmouseover="console.log(\'MEND_SCRIPT_RAN:onmouseover\')">ホバーで発火する段落。</p>',
  '  <img src="data:," alt="" onerror="console.log(\'MEND_SCRIPT_RAN:onerror\')">',
  '  <a href="javascript:console.log(\'MEND_SCRIPT_RAN:href\')">javascript: リンク</a>',
  '  <noscript><p id="noscript">スクリプト無効時の段落。</p></noscript>',
  '  <p id="after">スクリプトの後の段落。</p>',
  '</body>',
  '</html>',
)

const implicit = lines(
  '<meta charset="utf-8">',
  '<title>暗黙の要素</title>',
  '<style>p { margin: 0.5em 0; }</style>',
  '<h1>html・head・body の省略</h1>',
  '<p>閉じタグのない段落1',
  '<p>閉じタグのない段落2',
  '<ul>',
  '  <li>閉じタグのない項目1',
  '  <li>閉じタグのない項目2',
  '</ul>',
  '<dl>',
  '  <dt>用語',
  '  <dd>説明',
  '</dl>',
  '<p>表の前の段落<table><tr><td>セル</table>',
  '<p>最後の段落',
)

const malformed = lines(
  '<!DOCTYPE html>',
  '<html lang="ja">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <title>壊れたHTML</title>',
  '</head>',
  '<body>',
  '  <table>',
  '    表の直下のテキスト',
  '    <tr><td>セル1</td><td>セル2</td></tr>',
  '    <b>表の直下の太字</b>',
  '  </table>',
  '  <div class="unclosed">',
  '    <p>閉じ忘れたdivの中</p>',
  '  <p><b><i>入れ子違反</b>の続き</i>の文</p>',
  '  <p>段落の中に<div>ブロック要素</div>が入る</p>',
  '  </p>',
  '  <span>閉じ忘れたspan',
  '  <ul><li>リスト<p>リスト内の段落</ul>',
  '  <h2>見出し<h3>入れ子の見出し</h2></h3>',
  '</body>',
  '</html>',
)

const pre = lines(
  '<!DOCTYPE html>',
  '<html lang="ja">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <title>空白の扱い</title>',
  '  <style>',
  '    .pw { white-space: pre-wrap; }',
  '    .nw { white-space: nowrap; }',
  '  </style>',
  '</head>',
  '<body>',
  '<pre id="pre1">',
  'pre の先頭の改行は無視される',
  '    4スペースのインデント',
  '\tタブのインデント',
  '連続   空白&nbsp;&nbsp;と nbsp</pre>',
  '<pre id="pre2">',
  '',
  '先頭に改行が2つ（1つ目だけ無視される）</pre>',
  '<div id="pw" class="pw">pre-wrap の   連続空白',
  '  と改行</div>',
  '<p id="nw" class="nw">nowrap の   連続空白</p>',
  '<p id="normal">通常の   連続空白と&nbsp;nbsp</p>',
  '<textarea id="ta">',
  'textarea は編集対象外</textarea>',
  '</body>',
  '</html>',
)

const comments = lines(
  '<!-- comment before doctype -->',
  '<!DOCTYPE html>',
  '<!-- comment before html -->',
  '<html lang="ja">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <title>コメントとテンプレート</title>',
  '  <!--[if lt IE 9]><script src="html5shiv.js"></script><![endif]-->',
  '</head>',
  '<body>',
  '  <!-- 通常のコメント -->',
  '  <p id="p1">コメントの<!-- 文中のコメント -->前後</p>',
  '  <!--[if IE]><p>IE だけに表示</p><![endif]-->',
  '  <![if !IE]><p id="p2">IE 以外に表示</p><![endif]>',
  '  <!-- 複数行の',
  '       コメント -- 二重ハイフンを含む -->',
  '  <!---->',
  '  <template id="tpl">',
  '    <p>テンプレートの中身（編集対象外）</p>',
  '  </template>',
  '  <p id="p3">テンプレートの後の段落</p>',
  '</body>',
  '</html>',
  '<!-- comment after html -->',
)

const bom = BOM + basic.replace('<title>基本動作</title>', '<title>BOM付き</title>')

// Large synthetic document (~1MB) for the performance test. fixtures/ai-sample.html is a real AI output and is
// not generated.
function large(targetBytes: number): string {
  const head = lines(
    '<!DOCTYPE html>',
    '<html lang="ja">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>受注管理システム 要件定義書</title>',
    '<style>',
    '  :root { --navy: #0f2d4d; --accent: #2FA39A; --bg: #f5f7fa; }',
    '  * { box-sizing: border-box; }',
    '  body { margin: 0; font-family: "Noto Sans JP", sans-serif; background: var(--bg); color: #1f2933; }',
    '  .doc { max-width: 960px; margin: 32px auto; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.1); }',
    '  .hero { background: var(--navy); color: #fff; padding: 40px; }',
    '  .hero .eyebrow { letter-spacing: .1em; font-size: 12px; opacity: .8; }',
    '  section { padding: 24px 40px; }',
    '  h2 { border-bottom: 2px solid var(--navy); padding-bottom: 8px; }',
    '  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }',
    '  .card { background: #f1f5f9; border-radius: 8px; padding: 16px; }',
    '  .card h3 { margin: 0 0 8px; font-size: 15px; }',
    '  table { width: 100%; border-collapse: collapse; }',
    '  th { background: var(--navy); color: #fff; text-align: left; padding: 8px; }',
    '  td { border-bottom: 1px solid #e5e7eb; padding: 8px; }',
    '  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #FFE08A; font-size: 12px; }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="doc">',
    '  <header class="hero">',
    '    <div class="eyebrow">REQUIREMENTS DEFINITION</div>',
    '    <h1>受注管理システム 要件定義書</h1>',
    '    <p>版数 1.2 ／ 作成日 2026-11-10</p>',
    '  </header>',
  )
  const tail = lines(
    '</div>',
    '<script>',
    '  document.querySelectorAll(".card").forEach(function (el) {',
    '    el.addEventListener("click", function () { el.classList.toggle("open"); });',
    '  });',
    '  console.log("MEND_SCRIPT_RAN:large");',
    '</script>',
    '</body>',
    '</html>',
  )
  const section = (n: number): string =>
    lines(
      `  <section id="s${n}">`,
      `    <h2>${n}. 機能群 ${n} の要件 <span class="badge">v${(n % 3) + 1}</span></h2>`,
      `    <p class="lead">機能群 ${n} では、受注データを日次で集計し、営業部門が当日の受注状況を把握できるようにする。対象は国内拠点の受注で、海外拠点は次期以降の対象とする。</p>`,
      '    <div class="grid">',
      `      <div class="card"><h3>受注登録</h3><p>画面およびEDIから受注を登録する。登録時に与信限度額 &amp; 在庫数を確認する。</p></div>`,
      `      <div class="card"><h3>在庫引当</h3><p>受注確定時に引当し、不足時は担当者へ通知する（通知はメール&nbsp;および社内チャット）。</p></div>`,
      `      <div class="card"><h3>出荷指示</h3><p>倉庫システムへ出荷指示を連携する。締め時刻は15:00とする。</p></div>`,
      '    </div>',
      '    <table>',
      '      <thead><tr><th>ID</th><th>機能</th><th>要件</th></tr></thead>',
      '      <tbody>',
      `        <tr><td>FR-${n}-01</td><td>受注一覧</td><td>検索結果を最大1,000件まで表示する</td></tr>`,
      `        <tr><td>FR-${n}-02</td><td>CSV出力</td><td>一覧の表示内容をCSVで出力する（文字コードは UTF-8 &#x2F; BOM付き）</td></tr>`,
      `        <tr><td>FR-${n}-03</td><td>承認</td><td>金額が100万円以上の受注は上長の承認を必要とする</td></tr>`,
      '      </tbody>',
      '    </table>',
      `    <!-- section ${n} generated -->`,
      '  </section>',
    )
  const encoder = new TextEncoder()
  const base = encoder.encode(head + tail).length
  const parts: string[] = []
  let size = base
  for (let n = 1; size < targetBytes; n++) {
    const s = section(n)
    parts.push(s)
    size += encoder.encode(s).length
  }
  return head + parts.join('') + tail
}

const fixtures: ReadonlyArray<readonly [string, string]> = [
  ['basic.html', basic],
  ['entities.html', entities],
  ['crlf.html', crlf],
  ['emoji.html', emoji],
  ['inline.html', inline],
  ['scripts.html', scripts],
  ['implicit.html', implicit],
  ['malformed.html', malformed],
  ['pre.html', pre],
  ['comments.html', comments],
  ['bom.html', bom],
  ['large.html', large(1_000_000)],
]

async function main(): Promise<void> {
  await mkdir(fixturesDir, { recursive: true })
  for (const [name, content] of fixtures) {
    await writeFile(join(fixturesDir, name), content, 'utf8')
    console.log(`wrote fixtures/${name}`)
  }
}

main().catch((error: unknown) => {
  console.error('generate-fixtures failed:', error)
  process.exitCode = 1
})
