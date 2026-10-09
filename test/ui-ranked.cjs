// Chrome をスマホサイズで2台分開いて、実際の画面を操作・撮影するテスト
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const QUESTIONS = require(path.join(__dirname, '..', 'src/questions.generated.json'));
const IMAGES = require(path.join(__dirname, '..', 'src/images.generated.json'));

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(require('node:os').tmpdir(), 'hayaoshi-ui-test');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:8787';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

// 1人ずつ別のブラウザコンテキスト（保存領域が別）でページを開く。同じ端末の別タブあつかいにならないように
async function ownContextTarget() {
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const bws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { bws.onopen = r; });
  let n = 0;
  const pending = new Map();
  bws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  };
  const call = (method, params = {}) => new Promise((res) => {
    const i = ++n;
    pending.set(i, res);
    bws.send(JSON.stringify({ id: i, method, params }));
  });
  const { browserContextId } = await call('Target.createBrowserContext');
  const { targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId });
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const t = list.find((x) => x.id === targetId);
    if (t) return t;
    await sleep(100);
  }
  throw new Error('page not found');
}

async function page(label, dark = false) {
  const t = await ownContextTarget();
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
// 画面の state から正解をさがす（まだ1つに決まらなければ null）
function answerOf(q) {
  if (!q) return null;
  if (q.image) return IMAGES.find((x) => x.image.frames[0].src === q.image.frames[0].src)?.answer ?? null;
  const answers = new Set(QUESTIONS.filter((x) => x.q.startsWith(q.text)).map((x) => x.answer));
  return answers.size === 1 ? [...answers][0] : null;
}
// 選択肢か文字ボタンを押して答える
async function answerOnPage(p, answer, correct = true) {
  const mode = await p.js(`state.question.mode`);
  if (mode === 'choice') {
    await p.until(`[...document.querySelectorAll('.choice')].some((b) => !b.disabled)`);
    await p.js(`[...document.querySelectorAll('.choice')].find((b) => (b.textContent.replace(/^\\d+\\. /, '') === ${JSON.stringify(answer)}) === ${correct} && !b.disabled).click()`);
    return;
  }
  const chars = [...answer];
  for (let i = 0; i < chars.length; i++) {
    await p.until(`document.querySelectorAll('#typed .filled').length === ${i} && [...document.querySelectorAll('#letters button')].some((b) => !b.disabled)`);
    await p.js(`[...document.querySelectorAll('#letters button')].find((b) => (b.textContent === ${JSON.stringify(chars[i])}) === ${correct}).click()`);
    if (!correct) return;
  }
}
async function fresh(p, name) {
  await p.goto(BASE);
  await p.js(`localStorage.clear(); sessionStorage.clear()`);
  await p.goto(BASE);
  await p.until(`document.getElementById('conn').hidden`);
  await p.js(`document.getElementById('name').value = ${JSON.stringify(name)}`);
}

setTimeout(() => { console.error('WATCHDOG timeout', errors); process.exit(2); }, 240000).unref();
(async () => {
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(OUT, 'chrome-profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank']);
  try {
    for (let i = 0; i < 50; i++) {
      try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); }
    }
    // ===== 2人対戦 =====
    const a = await page('a');
    const b = await page('b', true);
    await fresh(a, 'たろう');
    await fresh(b, 'はなこ');
    await a.shot('rk-1-home');
    await a.js(`document.getElementById('rank-duel').click()`);
    await a.until(`!document.getElementById('matching').hidden && document.getElementById('matching-info').textContent.includes('1人')`);
    await a.shot('rk-2-matching');
    await b.js(`document.getElementById('rank-duel').click()`);
    await a.until(`!document.getElementById('lobby').hidden`);
    await b.until(`!document.getElementById('lobby').hidden`);
    await sleep(300);
    await b.shot('rk-3-lobby-dark');
    await a.until(phase('reading'), 15000);
    await sleep(500);
    await a.shot('rk-4-reading');
    let n = 0;
    while (!(await a.js(`!document.getElementById('result').hidden`))) {
      await a.until(`!document.getElementById('result').hidden || ((${phase('reading')} || ${phase('waiting')}) && state.question.number > ${n})`, 60000);
      if (await a.js(`!document.getElementById('result').hidden`)) break;
      let q = await a.js(`state.question`);
      while (!answerOf(q)) { await sleep(150); q = await a.js(`state.question`); }
      n = q.number;
      const ans = answerOf(q);
      if (n === 2) {
        // 2問目: はなこが押してわざとまちがえる → ライフが減る
        await b.js(buzzJs);
        await b.until(phase('answering'));
        await answerOnPage(b, ans, false);
        await a.until(phase('feedback'));
        await a.shot('rk-5-life-lost');
        await a.until(`${phase('reading')} || ${phase('waiting')}`);
      }
      await a.js(buzzJs);
      await a.until(phase('answering'));
      await answerOnPage(a, ans, true);
      await a.until(`${phase('reveal')} || !document.getElementById('result').hidden`);
    }
    await a.until(`document.getElementById('rating-change').textContent.includes('レート')`, 15000);
    await b.until(`document.getElementById('rating-change').textContent.includes('レート')`, 15000);
    await a.shot('rk-6-result-win');
    await b.shot('rk-7-result-lose-dark');
    console.log('勝った方:', await a.js(`document.getElementById('winner').textContent + ' / ' + document.getElementById('rating-change').textContent`));
    console.log('負けた方:', await b.js(`document.getElementById('winner').textContent + ' / ' + document.getElementById('rating-change').textContent`));
    // ホームにもどって、自分の段級位とランキング
    await a.js(`document.getElementById('leave-result').click()`);
    await a.until(`!document.getElementById('home').hidden && document.getElementById('my-rank').textContent.includes('1戦')`);
    console.log('ホームの表示:', await a.js(`document.getElementById('my-rank').textContent`));
    await a.js(`document.getElementById('open-ranking').click()`);
    await a.until(`document.getElementById('lb-me').textContent.length > 0`);
    await a.shot('rk-8-ranking');
    console.log('ランキング:', await a.js(`document.getElementById('lb-me').textContent`));
    await a.js(`document.getElementById('lb-back').click()`);
    await b.js(`document.getElementById('leave-result').click()`);

    // ===== 4人対戦: 1問目だけ見る =====
    const c = await page('c');
    const d = await page('d', true);
    await fresh(c, 'じろう');
    await fresh(d, 'さくら');
    const ps = [a, b, c, d];
    for (const p of ps) {
      await p.until(`!document.getElementById('home').hidden`);
      await p.js(`document.getElementById('rank-four').click()`);
    }
    for (const p of ps) await p.until(phase('reading'), 30000);
    let q = await a.js(`state.question`);
    while (!answerOf(q)) { await sleep(150); q = await a.js(`state.question`); }
    const ans = answerOf(q);
    await a.js(buzzJs);
    await b.until(`${phase('answering')} && !document.getElementById('buzz').disabled`);
    await b.shot('rk-9-four-window-dark');
    console.log('ほかの人も押せる:', await b.js(`document.getElementById('status').textContent`));
    await b.js(buzzJs);
    await b.until(`state.mine && state.mine.order === 2`);
    await sleep(200);
    await b.shot('rk-10-four-second-dark');
    console.log('押していない人の選択肢:', await d.js(`document.querySelectorAll('.choice').length + '個 / 文字' + document.querySelectorAll('#letters button').length + '個'`));
    await d.shot('rk-11-four-spectator-dark');
    await answerOnPage(a, ans, true);
    await answerOnPage(b, ans, false);
    await a.until(phase('reveal'), 15000);
    await sleep(300);
    await a.shot('rk-12-four-reveal');
    console.log('正解発表:', await a.js(`document.getElementById('status').textContent`));
    console.log('横スクロールなし:', await a.js(`document.documentElement.scrollWidth <= innerWidth`));
    console.log('JSエラー:', errors.length ? errors : 'なし');
  } finally {
    chrome.kill();
  }
})().catch((e) => {
  console.error(e.message, errors);
  process.exit(1);
});
