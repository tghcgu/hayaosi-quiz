// ストア用の画像をつくる: 見出しつきスクリーンショット7枚、フィーチャーグラフィック、アイコン
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PROJECT = path.join(__dirname, '..', '..');
const sharp = require('sharp');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const PROFILE = path.join(require('node:os').tmpdir(), 'hayaoshi-chrome-compose');
const RAW = path.join(PROJECT, 'store', 'raw');
const OUT = path.join(PROJECT, 'store');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHOTS = [
  ['1-home', 'スマホで*早押し*対戦！', '友だちとも、全国のだれかとも'],
  ['2-lobby', '*15*ジャンル・*1万*問', '問題数・出題・答え方・ジャンルを選べる'],
  ['3-choice', 'わかったら*早押し*！', 'いちばん早く押した人だけが答えられる'],
  ['4-input', '*文字入力*でガチ勝負', '4つの文字から1文字ずつ選んで答える'],
  ['5-image', '*画像*クイズ', '写真がだんだん引いていく。これは何？'],
  ['6-image-reveal', '*正体*が見えた！', '動物・食べ物・名所など130問'],
  ['7-ranked-result', '*ランクマッチ*', '2人対戦・4人対戦。10級から名人をめざそう'],
];

async function connect() {
  let list;
  for (let i = 0; i < 50; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch { await sleep(200); }
  }
  const target = list.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let n = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    } else if (m.method && listeners.has(m.method)) {
      listeners.get(m.method)(m.params);
      listeners.delete(m.method);
    }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++n;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const once = (method) => new Promise((r) => listeners.set(method, r));
  await call('Page.enable');
  return { call, once };
}

async function render(p, url, width, height, out) {
  await p.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const loaded = p.once('Page.loadEventFired');
  await p.call('Page.navigate', { url });
  await loaded;
  const ready = `document.fonts.ready.then(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0))`;
  const { result } = await p.call('Runtime.evaluate', { expression: ready, awaitPromise: true, returnByValue: true });
  if (!result.value) throw new Error(`画像が読めない: ${out}`);
  // 見出しが端に寄りすぎたり、はみ出したりしていないか（左右40pxはあける）
  const { result: overflow } = await p.call('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('h1, p, li')].filter((e) => { const r = e.getBoundingClientRect(); return e.scrollWidth > e.clientWidth || r.left < 40 || r.right > innerWidth - 40; }).map((e) => e.textContent)`,
    returnByValue: true,
  });
  if (overflow.value.length) throw new Error(`はみ出し: ${overflow.value.join(' / ')}`);
  await sleep(200);
  const { data } = await p.call('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
  // Google Play は透明度なしの PNG（24ビット）が必要
  await sharp(Buffer.from(data, 'base64')).removeAlpha().png({ compressionLevel: 9 }).toFile(out);
  const meta = await sharp(out).metadata();
  console.log(path.basename(out), `${meta.width}x${meta.height}`, `${meta.channels}ch`, `${Math.round(fs.statSync(out).size / 1024)}KB`);
}

(async () => {
  fs.mkdirSync(`${OUT}/screenshots`, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank']);
  try {
    const p = await connect();
    const frame = pathToFileURL(path.join(__dirname, 'frame.html')).href;
    for (const [name, title, sub] of SHOTS) {
      const img = pathToFileURL(`${RAW}/${name}.png`).href;
      const query = new URLSearchParams({ title, sub, img });
      await render(p, `${frame}?${query}`, 1080, 1920, `${OUT}/screenshots/${name}.png`);
    }
    const feature = pathToFileURL(path.join(__dirname, 'feature.html')).href;
    const icon = pathToFileURL(`${PROJECT}/public/icon-512.png`).href;
    await render(p, `${feature}?${new URLSearchParams({ icon })}`, 1024, 500, `${OUT}/feature-graphic.png`);

    // アイコン（512×512、32ビット PNG のままでよい）
    fs.copyFileSync(`${PROJECT}/public/icon-512.png`, `${OUT}/icon-512.png`);
    const im = await sharp(`${OUT}/icon-512.png`).metadata();
    console.log('icon-512.png', `${im.width}x${im.height}`, `${im.channels}ch`, `${Math.round(fs.statSync(`${OUT}/icon-512.png`).size / 1024)}KB`);

    // 確認用の一覧（ストアには使わない）
    const thumbs = await Promise.all(SHOTS.map(([name]) => sharp(`${OUT}/screenshots/${name}.png`).resize(270, 480).toBuffer()));
    await sharp({ create: { width: 270 * 7 + 10 * 6, height: 480, channels: 3, background: '#000' } })
      .composite(thumbs.map((input, i) => ({ input, left: i * 280, top: 0 })))
      .png()
      .toFile(path.join(require('node:os').tmpdir(), 'store-sheet.png'));
    console.log('確認用の一覧:', path.join(require('node:os').tmpdir(), 'store-sheet.png'));
  } finally {
    chrome.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
