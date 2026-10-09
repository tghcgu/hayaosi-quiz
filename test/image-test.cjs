// 画像クイズのテスト（2人）
const URL = process.env.WS_URL || 'ws://127.0.0.1:8787/ws';
const HTTP = URL.replace(/^ws/, 'http').replace(/\/ws$/, '');
const ROOT = require('node:url').pathToFileURL(require('node:path').join(__dirname, '..')).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
};

function client(label, query = '') {
  const ws = new WebSocket(URL + query);
  const c = { ws, label, state: null, joined: null, waiters: [], seen: [] };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') { c.state = m; c.seen.push(m); }
    if (m.type === 'joined') c.joined = m;
    c.waiters = c.waiters.filter((w) => !w());
  };
  c.send = (m) => ws.send(JSON.stringify(m));
  c.until = (pred0, ms = 30000) => new Promise((res, rej) => {
    const pred = (x) => { try { return pred0(x); } catch { return false; } };
    if (pred(c)) return res();
    const t = setTimeout(() => rej(new Error(`${label}: timeout (phase=${c.state?.phase})`)), ms);
    c.waiters.push(() => { if (!pred(c)) return false; clearTimeout(t); res(); return true; });
  });
  c.open = new Promise((r) => { ws.onopen = r; });
  setInterval(() => { if (ws.readyState === 1) c.send({ type: 'ping' }); }, 20000);
  return c;
}

(async () => {
  const IMAGES = (await import(`${ROOT}/src/images.generated.json`, { with: { type: 'json' } })).default;
  const { isInputQuestion } = await import(`${ROOT}/src/kana.js`);
  // 最初の段階の画像から、どの問題かを調べる
  const byFirst = new Map(IMAGES.map((q) => [q.image.frames[0].src, q]));
  const current = (st) => byFirst.get(st.question.image.frames[0].src);

  const a = client('A');
  await a.open;
  a.send({ type: 'create', name: 'Aさん' });
  await a.until((x) => x.state?.phase === 'lobby');
  const b = client('B', `?room=${a.state.code}`);
  await b.open;
  b.send({ type: 'join', name: 'Bさん' });
  await a.until((x) => x.state.players.length === 2);

  assert(a.state.questionKind === 'mix' && a.state.questionKinds.join() === 'mix,text,image', '出題は「まぜる」が最初の設定');
  assert(a.state.totalImages === IMAGES.length && IMAGES.length >= 100, `画像クイズは ${a.state.totalImages} 問`);

  a.send({ type: 'settings', questionKind: 'image', answerMode: 'choice', questionCount: 5 });
  await b.until((x) => x.state.questionKind === 'image' && x.state.answerMode === 'choice');
  a.send({ type: 'start' });

  // 1問目: 段階を追ってたしかめる
  await a.until((x) => x.state.phase === 'ready');
  let im = a.state.question.image;
  assert(im && im.shown === 0 && im.frames.length === 1, '始まる前は、最初の段階の画像を先に読みこむだけ');
  assert(a.state.question.text === current(a.state).q, `問題文は「${a.state.question.text}」`);
  const res = await fetch(HTTP + im.frames[0].src);
  assert(res.ok && res.headers.get('content-type').includes('image/webp'), '画像ファイルが届く');
  await a.until((x) => x.state.phase === 'reading' && x.state.question.image.shown === 2, 10000);
  im = a.state.question.image;
  assert(im.frames.length === 3, '見せている段階の次までしか送られない（全体はまだ送らない）');
  const q1 = current(a.state);
  const full = q1.image.frames.at(-1).src;
  assert(a.seen.every((s) => !s.question?.image || s.question.image.shown >= 6 || !s.question.image.frames.some((f) => f.src === full)), 'ここまで全体の画像は一度も送られていない');
  const [, , s0] = im.frames[0].rect, [, , s1] = im.frames[1].rect;
  assert(s0 < s1, '段階が進むほど広い範囲が写る');

  b.send({ type: 'buzz' });
  await a.until((x) => x.state.phase === 'answering');
  const frozen = a.state.question.image.shown;
  await sleep(2000);
  assert(a.state.question.image.shown === frozen, '早押しされたら、引いていくのが止まる');
  const wrong = a.state.question.choices.findIndex((c) => c.text !== q1.answer);
  b.send({ type: 'answer', choice: wrong });
  await a.until((x) => x.state.phase === 'reading', 10000);
  await a.until((x) => x.state.question.image.shown > frozen, 5000);
  assert(true, 'お手つきのあと、また引いていく');
  await a.until((x) => x.state.phase === 'waiting', 15000);
  assert(a.state.question.image.shown === 7 && a.state.question.image.frames.length === 7, '最後まで引くと全体が見える');
  a.send({ type: 'buzz' });
  await a.until((x) => x.state.phase === 'answering');
  a.send({ type: 'answer', choice: a.state.question.choices.findIndex((c) => c.text === q1.answer) });
  await a.until((x) => x.state.phase === 'reveal');
  const credit = a.state.question.image.credit;
  assert(a.state.winner === a.joined.id && credit && credit.license && credit.artist, `正解発表で写真の出典が出る（${credit.artist}・${credit.license}）`);

  // 残りは早く答えて進める
  async function answerRest(from, total, check) {
    for (let n = from; n <= total; n++) {
      await a.until((x) => x.state.question?.number === n && x.state.phase === 'reading', 30000);
      const q = current(a.state);
      check?.(q, a.state.question, n);
      a.send({ type: 'buzz' });
      await a.until((x) => x.state.phase === 'answering');
      if (a.state.question.mode === 'choice') {
        a.send({ type: 'answer', choice: a.state.question.choices.findIndex((c) => c.text === q.answer) });
      } else {
        const chars = [...q.answer];
        for (let i = 0; i < chars.length; i++) {
          await a.until((x) => x.state.question.input?.typed.length === i && x.state.question.input.letters);
          a.send({ type: 'letter', index: a.state.question.input.letters.indexOf(chars[i]), pos: i });
        }
      }
      await a.until((x) => x.state.phase === 'reveal');
      assert(a.state.winner === a.joined.id, `問題${n}: 正解 (${q.answer})`);
    }
    await a.until((x) => x.state.phase === 'result', 30000);
    a.send({ type: 'lobby' });
    await a.until((x) => x.state.phase === 'lobby');
  }
  await answerRest(2, 5, (q, sq, n) => assert(sq.image && sq.mode === 'choice', `問題${n}: 画像クイズ`));

  // 文字入力: 答えがかなの画像クイズは文字入力で出る
  a.send({ type: 'settings', answerMode: 'input' });
  await a.until((x) => x.state.answerMode === 'input');
  a.send({ type: 'start' });
  await answerRest(1, 5, (q, sq, n) => assert(sq.mode === (isInputQuestion(q) ? 'input' : 'choice'), `問題${n}: ${sq.mode === 'input' ? '文字入力' : '選択肢'} (${q.answer})`));

  // ジャンルをしぼる
  a.send({ type: 'settings', answerMode: 'choice', genres: ['地理'] });
  await a.until((x) => x.state.genres.length === 1 && x.state.answerMode === 'choice');
  a.send({ type: 'start' });
  await answerRest(1, 5, (q, sq, n) => assert(q.genre === '地理', `問題${n}: 地理の画像クイズ (${q.answer})`));

  // まぜる: 10問のうち2問が画像
  a.send({ type: 'settings', questionKind: 'mix', genres: [], questionCount: 10 });
  await a.until((x) => x.state.questionKind === 'mix' && x.state.questionCount === 10 && x.state.genres.length === 0);
  a.send({ type: 'start' });
  const kinds = [];
  for (let n = 1; n <= 10; n++) {
    await a.until((x) => x.state.question?.number === n && x.state.phase === 'ready', 30000);
    kinds.push(a.state.question.image ? '画像' : '文章');
    // 早く進めるため、両方お手つきにする
    await a.until((x) => x.state.phase === 'reading');
    for (const p of [a, b]) {
      p.send({ type: 'buzz' });
      await a.until((x) => x.state.phase === 'answering');
      if (a.state.question.mode === 'choice') p.send({ type: 'answer', choice: a.state.question.choices.findIndex((c) => !c.out) });
      else p.send({ type: 'letter', index: 0, pos: 0 });
      await a.until((x) => x.state.phase === 'feedback' || x.state.phase === 'reveal');
      if (a.state.phase === 'reveal') break;
      await a.until((x) => x.state.phase === 'reading' || x.state.phase === 'waiting' || x.state.phase === 'reveal');
      if (a.state.phase === 'reveal') break;
    }
  }
  assert(kinds.filter((k) => k === '画像').length === 2, `まぜると10問中2問が画像 (${kinds.join(',')})`);
  console.log('ALL PASSED');
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
