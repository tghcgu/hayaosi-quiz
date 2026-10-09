// Chrome をスマホサイズで2台分開いて、実際の画面を操作・撮影するテスト
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const QUESTIONS = require(path.join(__dirname, '..', 'src/questions.generated.json'));

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
// 画面の選択肢から問題をさがして、正解が何番目かを返す
async function correctIndex(p) {
  const texts = await p.js(`[...document.querySelectorAll('.choice')].map((b) => b.textContent.replace(/^\\d+\\. /, ''))`);
  const q = QUESTIONS.find((x) => x.wrong.length + 1 === texts.length && [x.answer, ...x.wrong].every((t) => texts.includes(t)));
  return texts.indexOf(q.answer);
}
const buzzJs = `document.getElementById('buzz').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))`;

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
    await host.shot('1-home');

    // 名前なしで押すとエラー
    await host.js(`document.getElementById('name').value = ''; document.getElementById('create').click()`);
    const err = await host.js(`document.getElementById('error').textContent`);
    console.log('名前なしエラー:', err);

    await host.js(`document.getElementById('name').value = 'たろう'; document.getElementById('create').click()`);
    await host.until(`!document.getElementById('lobby').hidden`);
    const code = await host.js(`document.getElementById('lobby-code').textContent`);
    await host.js('location.reload()');
    await sleep(1500);
    await host.until(`!document.getElementById('lobby').hidden`);
    console.log('開き直しても同じ部屋に戻る:', (await host.js(`document.getElementById('lobby-code').textContent`)) === code);

    const guest = await page('guest', true);
    await guest.goto(`${BASE}/?room=${code}`);
    await guest.until(`document.getElementById('conn').hidden`);
    const prefilled = await guest.js(`document.getElementById('code').value`);
    console.log('招待リンクから部屋番号が入る:', prefilled === code);
    await guest.js(`document.getElementById('name').value = 'はなこ'; document.getElementById('join').click()`);
    await guest.until(`!document.getElementById('lobby').hidden`);
    await host.until(`document.querySelectorAll('#lobby-players li').length === 2`);
    await host.shot('2-lobby-host');
    console.log('招待リンク:', await host.js(`document.getElementById('invite').textContent`));
    await guest.shot('3-lobby-guest-dark');

    await host.js(`document.querySelector('#counts button').click()`); // 5問
    await guest.until(`document.getElementById('lobby-wait').textContent.includes('5問')`);
    // 文章の問題を選択肢で（文字入力と画像は ui-input・ui-image で確かめる）
    await host.js(`[...document.querySelectorAll('#kinds button')].find((b) => b.textContent === '文章').click()`);
    await host.js(`[...document.querySelectorAll('#modes button')].find((b) => b.textContent === '選択肢').click()`);
    await sleep(300);
    await host.js(`document.getElementById('start').click()`);

    // 1問目: はなこ(ゲスト)が押して正解
    await guest.until(`${phase('reading')} && document.getElementById('q-text').textContent.length >= 14`);
    await guest.shot('4-reading-guest-dark');
    await guest.js(buzzJs);
    await guest.until(phase('answering'));
    await host.until(phase('answering'));
    await guest.shot('5-answering-guest-dark');
    await host.shot('6-answering-host');
    const hostCanChoose = await host.js(`[...document.querySelectorAll('.choice')].some((b) => !b.disabled)`);
    console.log('押していない人は選択肢を押せない:', !hostCanChoose);
    const ci = await correctIndex(guest);
    await guest.js(`document.querySelectorAll('.choice')[${ci}].click()`);
    await host.until(phase('reveal'));
    await host.shot('7-reveal-host');

    // 2〜5問目: たろう(ホスト)がパソコンのスペースキーで押して正解
    for (let n = 2; n <= 5; n++) {
      console.log('step question', n, await host.js(`document.body.dataset.phase + ' ' + document.getElementById('q-number').textContent`));
      await host.until(`${phase('reading')} && document.getElementById('q-number').textContent.startsWith('${n}/')`);
      await host.js(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))`);
      await host.until(phase('answering'));
      const i = await correctIndex(host);
      await host.js(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit${i + 1}', bubbles: true }))`);
      await host.until(phase('reveal'));
    }

    await host.until(`!document.getElementById('result').hidden`, 10000);
    await guest.until(`!document.getElementById('result').hidden`, 10000);
    await host.shot('8-result-host');
    await guest.shot('9-result-guest-dark');
    console.log('結果:', await host.js(`document.getElementById('winner').textContent`));
    console.log('順位:', await host.js(`[...document.querySelectorAll('#ranking li')].map((li) => li.textContent)`));
    console.log('横スクロールなし:', await host.js(`document.documentElement.scrollWidth <= innerWidth`));
    console.log('JSエラー:', errors.length ? errors : 'なし');
  } finally {
    chrome.kill();
  }
})().catch((e) => {
  console.error(e.message, errors);
  process.exit(1);
});
