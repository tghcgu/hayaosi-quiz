// Chrome をスマホサイズで2台分開いて、実際の画面を操作・撮影するテスト
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const IMAGES = require(path.join(__dirname, '..', 'src/images.generated.json'));

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
const byFirst = Object.fromEntries(IMAGES.map((q) => [q.image.frames[0].src, q.answer]));
const transformJs = `getComputedStyle(document.getElementById('photo-img')).transform`;

setTimeout(() => { console.error('WATCHDOG timeout', errors); process.exit(2); }, 150000).unref();
(async () => {
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(OUT, 'chrome-profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank']);
  try {
    for (let i = 0; i < 50; i++) {
      try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); }
    }
    const host = await page('host');
    await host.goto(BASE);
    await host.until(`document.getElementById('conn').hidden`);
    await host.js(`document.getElementById('name').value = 'たろう'; document.getElementById('create').click()`);
    await host.until(`!document.getElementById('lobby').hidden`);
    const code = await host.js(`document.getElementById('lobby-code').textContent`);
    const guest = await page('guest', true);
    await guest.goto(`${BASE}/?room=${code}`);
    await guest.until(`document.getElementById('conn').hidden`);
    await guest.js(`document.getElementById('name').value = 'はなこ'; document.getElementById('join').click()`);
    await host.until(`document.querySelectorAll('#lobby-players li').length === 2`);
    // 出題: 画像 / 答え方: 選択肢 / 5問
    await host.js(`[...document.querySelectorAll('#kinds button')].find((b) => b.textContent === '画像').click()`);
    await host.js(`[...document.querySelectorAll('#modes button')].find((b) => b.textContent === '選択肢').click()`);
    await host.js(`document.querySelector('#counts button').click()`);
    await guest.until(`document.getElementById('lobby-wait').textContent.includes('出題: 画像')`);
    await host.shot('img-1-lobby');
    await host.js(`document.getElementById('start').click()`);

    await guest.until(`${phase('reading')} && document.getElementById('photo-img').complete && document.getElementById('photo-img').naturalWidth > 0`);
    await sleep(300);
    await guest.shot('img-2-reading-start-dark');
    const t1 = await guest.js(transformJs);
    await sleep(2500);
    const t2 = await guest.js(transformJs);
    console.log('引いていく動きがある:', t1 !== t2, t1, '→', t2);
    await host.shot('img-3-reading-host');
    await guest.js(buzzJs);
    await guest.until(phase('answering'));
    await sleep(400);
    const f1 = await guest.js(transformJs);
    await sleep(1200);
    const f2 = await guest.js(transformJs);
    console.log('早押しで止まる:', f1 === f2);
    await guest.shot('img-4-answering-dark');
    const first = await guest.js(`(() => { const u = new URL(document.getElementById('photo-img').src); return u.pathname; })()`);
    // 最初の段階の画像は、いま表示している画像とは限らないので、サーバーの state から調べる
    const answer = await guest.js(`(() => state.question.image.frames[0].src)()`).then((src) => byFirst[src]);
    console.log('正解:', answer, '表示中の画像:', first);
    await guest.js(`[...document.querySelectorAll('.choice')].find((b) => b.textContent.endsWith('${answer}')).click()`);
    await host.until(phase('reveal'));
    await sleep(500);
    await host.shot('img-5-reveal-host');
    console.log('出典:', await host.js(`document.getElementById('credit').hidden ? '(なし)' : document.getElementById('credit').textContent`));
    console.log('横スクロールなし:', await host.js(`document.documentElement.scrollWidth <= innerWidth`));
    console.log('早押しボタンが画面に入る:', await host.js(`document.getElementById('buzz').getBoundingClientRect().bottom <= innerHeight`));
    console.log('JSエラー:', errors.length ? errors : 'なし');
  } finally {
    chrome.kill();
  }
})().catch((e) => {
  console.error(e.message, errors);
  process.exit(1);
});
