// Chrome をスマホサイズで2台分開いて、実際の画面を操作・撮影するテスト
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(require('node:os').tmpdir(), 'hayaoshi-ui-test');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:8787';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function page(label, dark = false) {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(`${label}: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(`${label}: console.error ${JSON.stringify(m.params.args.map((a) => a.value))}`);
  };
  const cmd = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    const timer = setTimeout(() => rej(new Error(`${label}: CDP ${method} no response`)), 10000);
    pending.set(i, (m) => { clearTimeout(timer); m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result); });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await cmd('Page.enable');
  await cmd('Runtime.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  if (dark) await cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  const js = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
  return {
    js,
    async shot(name) {
      await cmd('Page.bringToFront');
      const r = await cmd('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'));
      console.log('screenshot', name);
    },
    async until(expr, ms = 20000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await js(expr)) return;
        await sleep(80);
      }
      throw new Error(`${label}: timeout waiting for ${expr}`);
    },
    async goto(url) {
      await cmd('Page.navigate', { url });
      await sleep(1000);
    },
  };
}

const phase = (p) => `document.body.dataset.phase === '${p}'`;
const buzzJs = `document.getElementById('buzz').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))`;

setTimeout(() => { console.error('WATCHDOG timeout', errors); process.exit(2); }, 150000).unref();
(async () => {
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(OUT, 'chrome-profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank']);
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
    const host = await page('host');
    await host.goto(BASE);
    await host.js(`document.getElementById('name').value = 'たろう'; document.getElementById('create').click()`);
    await host.until(`!document.getElementById('lobby').hidden`);
    await host.js(`[...document.querySelectorAll('#modes button')].find((b) => b.textContent === '文字入力').click()`);
    await host.until(`document.querySelector('#modes .on')?.textContent === '文字入力'`);
    await host.shot('in-1-lobby');
    await host.js(`document.getElementById('start').click()`);
    await host.until(`(document.body.dataset.phase === 'reading' && document.getElementById('q-text').textContent.length > 6) || document.body.dataset.phase === 'waiting'`);
    await host.js(buzzJs);
    await host.until(`document.body.dataset.phase === 'answering'`);
    await sleep(300);
    await host.shot('in-2-answering');
    // 正しい1文字目を押す（答えは問題ファイルから探す）
    console.log('状態:', await host.js(`document.getElementById('q-number').textContent + ' / ' + document.getElementById('status').textContent + ' / マス' + document.querySelectorAll('#typed span').length + ' / 文字 ' + [...document.querySelectorAll('#letters button')].map((b) => b.textContent).join(' ')`));
    console.log('JSエラー:', errors.length ? errors : 'なし');
  } finally {
    chrome.kill();
  }
})().catch((e) => { console.error(e.message, errors); process.exit(1); });
