// Chrome をスマホサイズで2台分開いて、実際の画面を操作・撮影するテスト
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const QUESTIONS = require(path.join(__dirname, '..', '..', 'src/questions.generated.json'));
const IMAGES = require(path.join(__dirname, '..', '..', 'src/images.generated.json'));

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(__dirname, '..', 'raw');
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
  await cmd('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 3, mobile: true });
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


// ===== Google Play 用のスクリーンショット（360×640 の3倍 = 1080×1920）=====
const PROFILE = path.join(require('node:os').tmpdir(), 'hayaoshi-chrome-store');
const click = (sel, text) => `[...document.querySelectorAll('${sel}')].find((b) => b.textContent === ${JSON.stringify(text)}).click()`;

// 部屋をつくって、2人目が入るところまで
async function makeRoom(host, guest, kind, mode) {
  await fresh(host, 'たろう');
  await fresh(guest, 'はなこ');
  await host.js(`document.getElementById('create').click()`);
  await host.until(`!document.getElementById('lobby').hidden`);
  const code = await host.js(`document.getElementById('lobby-code').textContent`);
  await guest.js(`document.getElementById('code').value = '${code}'; document.getElementById('join').click()`);
  await host.until(`document.querySelectorAll('#lobby-players li').length === 2`);
  if (kind) await host.js(click('#kinds button', kind));
  if (mode) await host.js(click('#modes button', mode));
  await sleep(300);
}

async function leave(...ps) {
  for (const p of ps) await p.js(`leaveRoom()`);
}

setTimeout(() => { console.error('WATCHDOG timeout', errors); process.exit(2); }, 300000).unref();
(async () => {
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', 'about:blank']);
  try {
    for (let i = 0; i < 50; i++) {
      try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); }
    }
    const a = await page('a');
    const b = await page('b');

    // 1. はじめの画面
    await fresh(a, 'たろう');
    await a.until(`document.getElementById('my-rank').textContent.length > 0`);
    await a.shot('1-home');

    // 2. 待合室（ホストの設定画面）
    await makeRoom(a, b, null, null);
    // 招待の文は本番の URL にする（ローカルのアドレスが写らないように）
    await a.js(`document.getElementById('invite').textContent = 'https://hayaoshi-quiz-royale.qoj.workers.dev/?room=' + state.code`);
    await sleep(200);
    await a.shot('2-lobby');

    // 3. 選択肢で答える
    await a.js(click('#kinds button', '文章'));
    await a.js(click('#modes button', '選択肢'));
    await sleep(300);
    await a.js(`document.getElementById('start').click()`);
    await b.until(`${phase('reading')} && document.getElementById('q-text').textContent.length >= 22`, 20000);
    await b.js(buzzJs);
    await b.until(`${phase('answering')} && document.querySelectorAll('.choice').length === 4`);
    await sleep(300);
    await b.shot('3-choice');
    await leave(a, b);

    // 4. 文字入力
    await makeRoom(a, b, '文章', '文字入力');
    await a.js(`document.getElementById('start').click()`);
    await a.until(phase('reading'), 20000);
    let q = await a.js(`state.question`);
    while (!answerOf(q) || q.text.length < 16) { await sleep(150); q = await a.js(`state.question`); }
    const ans = answerOf(q);
    await a.js(buzzJs);
    await a.until(`${phase('answering')} && document.querySelectorAll('#letters button').length === 4`);
    await a.js(`[...document.querySelectorAll('#letters button')].find((b) => b.textContent === ${JSON.stringify([...ans][0])}).click()`);
    await a.until(`document.querySelectorAll('#typed .filled').length === 1 && [...document.querySelectorAll('#letters button')].some((b) => !b.disabled)`);
    await sleep(300);
    await a.shot('4-input');
    await leave(a, b);

    // 5・6. 画像クイズ
    await makeRoom(a, b, '画像', '選択肢');
    await a.js(`document.getElementById('start').click()`);
    await a.until(`${phase('reading')} && state.question.image.shown >= 3`, 20000);
    await sleep(900);
    await a.shot('5-image');
    const img = answerOf(await a.js(`state.question`));
    await a.js(buzzJs);
    await a.until(`${phase('answering')} && document.querySelectorAll('.choice').length === 4`);
    await answerOnPage(a, img, true);
    await a.until(phase('reveal'));
    await a.until(`document.getElementById('photo-img').complete`);
    await sleep(700);
    await a.shot('6-image-reveal');
    await leave(a, b);

    // 7. ランクマッチの結果
    await fresh(a, 'たろう');
    await fresh(b, 'はなこ');
    await a.js(`document.getElementById('rank-duel').click()`);
    await b.js(`document.getElementById('rank-duel').click()`);
    await a.until(phase('reading'), 30000);
    let n = 0;
    while (!(await a.js(`!document.getElementById('result').hidden`))) {
      await a.until(`!document.getElementById('result').hidden || ((${phase('reading')} || ${phase('waiting')}) && state.question.number > ${n})`, 60000);
      if (await a.js(`!document.getElementById('result').hidden`)) break;
      let rq = await a.js(`state.question`);
      while (!answerOf(rq)) { await sleep(150); rq = await a.js(`state.question`); }
      n = rq.number;
      const r = answerOf(rq);
      if (n === 3) {
        // はなこも1問とって、0点で終わらないようにする
        await b.js(buzzJs);
        await b.until(phase('answering'));
        await answerOnPage(b, r, true);
        await a.until(`${phase('reveal')} || !document.getElementById('result').hidden`);
        continue;
      }
      await a.js(buzzJs);
      await a.until(phase('answering'));
      await answerOnPage(a, r, true);
      await a.until(`${phase('reveal')} || !document.getElementById('result').hidden`);
    }
    await a.until(`document.getElementById('rating-change').textContent.includes('レート')`, 15000);
    await sleep(300);
    await a.shot('7-ranked-result');
    console.log('JSエラー:', errors.length ? errors : 'なし');
  } finally {
    chrome.kill();
  }
})().catch((e) => {
  console.error(e.message, errors);
  process.exit(1);
});
