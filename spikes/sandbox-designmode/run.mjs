// Spike runner: verifies the editing-iframe assumptions in real Chrome.
// Usage: node run.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const harnessPath = fileURLToPath(new URL('./harness.html', import.meta.url));

const body = `
<style>#t1{color:rgb(1, 2, 3)}</style>
<script>console.log('SCRIPT_RAN'); try { parent.postMessage('SCRIPT_RAN', '*'); parent.__ran++; } catch (e) {} alert('ALERT_RAN');</script>
<p id="t1">Hello <b id="b1">bold</b> world</p>
<p id="t2">abc</p>
<p id="t3">xyz</p>
<img src="data:," onerror="console.log('ONERROR_RAN'); parent.postMessage('ONERROR_RAN', '*')">
<noscript><p id="ns">NS</p></noscript>
<p id="q">quirk<table><tr><td>cell</td></tr></table>`;
const withDoctype = `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
const noDoctype = `<html><head></head><body>${body}</body></html>`;

const server = createServer(async (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(await readFile(harnessPath));
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = {};

async function scenario(name, opts, source, fn) {
  const page = await browser.newPage();
  const consoleMsgs = [];
  const dialogs = [];
  page.on('console', (m) => consoleMsgs.push(m.text()));
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  await page.goto(url);
  await page.evaluate(([s, o]) => window.mount(s, o), [source, opts]);
  await page.waitForTimeout(200);
  const out = { inspect: await page.evaluate(() => window.inspect()) };
  out.scriptsRan = await page.evaluate(() => window.__ran);
  if (fn) Object.assign(out, await fn(page));
  out.console = consoleMsgs.filter((m) => /RAN/.test(m));
  out.dialogs = dialogs;
  results[name] = out;
  await page.close();
}

async function editingChecks(page) {
  const r = {};
  const frame = page.frameLocator('iframe');
  await page.evaluate(() => window.enableEditing({ guard: true }));
  r.designMode = await page.evaluate(() => window.frameEl.contentDocument.designMode);

  // 1. typing (focus the frame by a real click, as a user would)
  await frame.locator('#t1').click();
  await page.evaluate(() => window.selectText('t2', 'end'));
  await page.keyboard.type('X');
  r.typed = await page.evaluate(() => window.html('t2'));
  r.eventsAfterTyping = await page.evaluate(() => window.log.slice());

  // 2. Enter blocked
  const before = await page.evaluate(() => window.frameEl.contentDocument.body.innerHTML);
  await page.keyboard.press('Enter');
  r.enterBlocked = (await page.evaluate(() => window.frameEl.contentDocument.body.innerHTML)) === before;

  // 3. Ctrl+B blocked
  await page.evaluate(() => window.selectText('t3', 0, null, 2));
  await page.keyboard.press('ControlOrMeta+b');
  r.boldBlocked = (await page.evaluate(() => window.html('t3'))) === 'xyz';

  // 4. cross-node delete blocked
  await page.evaluate(() => { window.log.length = 0; window.selectText('t1', 2, 't1', 3); });
  await page.keyboard.press('Backspace');
  r.crossDeleteHtml = await page.evaluate(() => window.html('t1'));
  r.crossDeleteEvent = await page.evaluate(() => window.log.find((e) => e[0] === 'beforeinput'));

  // 5. emptying a text node (guarded) -> no <br>
  await page.evaluate(() => window.selectText('t3', 0, null, 'end'));
  await page.keyboard.press('Backspace');
  r.emptiedGuarded = await page.evaluate(() => ({
    html: window.html('t3'),
    childNodes: window.frameEl.contentDocument.getElementById('t3').childNodes.length,
  }));

  // 6. IME via CDP
  await page.evaluate(() => { window.log.length = 0; window.selectText('t2', 'end'); });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'あ', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.imeSetComposition', { text: 'あい', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.insertText', { text: '愛' });
  r.imeResult = await page.evaluate(() => window.html('t2'));
  r.imeEvents = await page.evaluate(() => window.log.map((e) => e.slice(0, 2).join(':')));
  // IME cancel: compose then commit empty
  await page.evaluate(() => { window.log.length = 0; });
  await cdp.send('Input.imeSetComposition', { text: 'う', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  await cdp.send('Input.insertText', { text: '' });
  r.imeCancelResult = await page.evaluate(() => window.html('t2'));
  r.imeCancelEvents = await page.evaluate(() => window.log.map((e) => e.slice(0, 2).join(':')));

  // 7. Highlight API + adoptedStyleSheets
  r.highlight = await page.evaluate(() => window.tryHighlight());

  r.mutationTypes = [...new Set(await page.evaluate(() => window.mutations.map((m) => m[0])))];
  return r;
}

async function unguardedControl(page) {
  await page.evaluate(() => window.enableEditing({ guard: false }));
  await page.frameLocator('iframe').locator('#t3').click();
  await page.evaluate(() => window.selectText('t3', 0, null, 2));
  await page.keyboard.press('ControlOrMeta+b');
  const bold = await page.evaluate(() => window.html('t3'));
  await page.evaluate(() => window.selectText('t2', 0, null, 'end'));
  await page.keyboard.press('Backspace');
  const emptied = await page.evaluate(() => window.html('t2'));
  await page.evaluate(() => window.selectText('t1', 2, 't1', 3));
  await page.keyboard.press('Backspace');
  const cross = await page.evaluate(() => window.html('t1'));
  return { unguardedBold: bold, emptiedUnguarded: emptied, unguardedCrossDelete: cross };
}

async function previewChecks(page) {
  await page.waitForTimeout(300);
  return {
    contentDocAccessible: await page.evaluate(() => !!window.frameEl.contentDocument),
    messagesFromFrame: await page.evaluate(() => window.messages),
  };
}

const editSandbox = { mode: 'blob', sandbox: 'allow-same-origin' };
await scenario('A_blob_sameorigin_doctype', editSandbox, withDoctype, editingChecks);
await scenario('B_blob_sameorigin_nodoctype', editSandbox, noDoctype);
await scenario('C_srcdoc_sameorigin_nodoctype', { mode: 'srcdoc', sandbox: 'allow-same-origin' }, noDoctype);
await scenario('D_blob_unguarded_empty', editSandbox, withDoctype, unguardedControl);
await scenario('E_preview_blob_scripts_only', { mode: 'blob', sandbox: 'allow-scripts' }, withDoctype, previewChecks);
await scenario('F_fallback_scripts_sameorigin_csp',
  { mode: 'blob', sandbox: 'allow-scripts allow-same-origin', csp: "script-src 'none'" }, withDoctype, editingChecks);
await scenario('G_fallback_srcdoc_csp',
  { mode: 'srcdoc', sandbox: 'allow-scripts allow-same-origin', csp: "script-src 'none'" }, withDoctype);

console.log(JSON.stringify(results, null, 2));
await browser.close();
server.close();
