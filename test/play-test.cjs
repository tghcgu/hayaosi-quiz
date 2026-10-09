// 3人分の偽プレイヤーでサーバーを1ゲーム通して動かすテスト
let QUESTIONS;
const URL = process.env.WS_URL || 'ws://127.0.0.1:8787/ws';
const ROOT = require('node:url').pathToFileURL(require('node:path').join(__dirname, '..')).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
};

function client(label, query = '') {
  const ws = new WebSocket(URL + query);
  const c = { ws, label, state: null, joined: null, errors: [], expired: false, waiters: [] };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') c.state = m;
    if (m.type === 'joined') c.joined = m;
    if (m.type === 'error') c.errors.push(m.message);
    if (m.type === 'expired') c.expired = true;
    c.waiters = c.waiters.filter((w) => !w());
  };
  c.send = (m) => ws.send(JSON.stringify(m));
  c.until = (pred0, ms = 20000) => new Promise((res, rej) => {
    const safe = (x) => { try { return pred0(x); } catch { return false; } }; // まだ届いていないデータを読んでも止まらない
    const pred = safe;
    if (pred(c)) return res();
    const t = setTimeout(() => rej(new Error(`${label}: timeout (phase=${c.state?.phase})`)), ms);
    c.waiters.push(() => {
      if (!pred(c)) return false;
      clearTimeout(t);
      res();
      return true;
    });
  });
  c.open = new Promise((r) => { ws.onopen = r; });
  return c;
}

// 表示された問題文（と選択肢）に合う問題の候補
function candidates(state) {
  const texts = state.question.choices?.map((c) => c.text);
  return QUESTIONS.filter((q) => q.q.startsWith(state.question.text) && (!texts || [q.answer, ...q.wrong].every((t) => texts.includes(t))));
}
const answersOf = (state) => new Set(candidates(state).map((q) => q.answer));
// 正解の位置（答えが1つに決まらないときはテストのまちがいなので止める）
function correctIndex(state) {
  const answers = [...answersOf(state)];
  if (answers.length !== 1) throw new Error(`正解が1つに決まらない: ${state.question.text} → ${answers.join(' / ')}`);
  return state.question.choices.findIndex((c) => c.text === answers[0]);
}
// どの候補にとってもまちがいになる選択肢
function surelyWrongIndex(state) {
  const answers = answersOf(state);
  return state.question.choices.findIndex((c) => !answers.has(c.text) && !c.out);
}
const player = (c, id) => c.state.players.find((p) => p.id === id);
const canBuzz = (x) => x.state.phase === 'reading' || x.state.phase === 'waiting';
// 問題文が、答えが1つに決まるところまで出た
const decided = (x) => canBuzz(x) && answersOf(x.state).size === 1;

(async () => {
  QUESTIONS = (await import(`${ROOT}/src/questions.generated.json`, { with: { type: 'json' } })).default;
  const a = client('A');
  await a.open;

  a.send({ type: 'create', name: 'Aさん' });
  await a.until((x) => x.state?.phase === 'lobby');
  const code = a.state.code;
  assert(/^\d{4}$/.test(code), `部屋番号は4けた (${code})`);

  const wrong = client('W', `?room=${code === '1000' ? '1001' : '1000'}`);
  await wrong.open;
  wrong.send({ type: 'join', name: 'Bさん' });
  await wrong.until((x) => x.errors.length > 0);
  assert(wrong.errors[0].includes('見つかりません'), 'まちがった部屋番号ははじかれる');

  const b = client('B', `?room=${code}`), c = client('C', `?room=${code}`);
  await Promise.all([b.open, c.open]);
  b.send({ type: 'join', name: 'Bさん' });
  c.send({ type: 'join', name: 'Cさん' });
  await a.until((x) => x.state.players.length === 3);
  assert(new Set(a.state.players.map((p) => p.color)).size === 3, '3人が入り、色がかぶらない');

  b.send({ type: 'start' });
  await sleep(300);
  assert(a.state.phase === 'lobby', 'ホスト以外はスタートできない');

  a.send({ type: 'settings', questionCount: 5, answerMode: 'choice', questionKind: 'text' });
  await b.until((x) => x.state.questionCount === 5);
  a.send({ type: 'start' });
  await c.until((x) => x.state.phase === 'ready');
  assert(c.state.question.total === 5, '5問で始まる');

  // --- 1問目: Bがお手つき → Cが正解
  b.send({ type: 'buzz' });
  await a.until((x) => x.state.phase === 'reading' && x.state.question.text.length >= 3);
  assert(a.state.buzzer === null, '問題が出る前の早押しは無効');
  assert(a.state.question.choices === null, '読み上げ中は選択肢が見えない');

  b.send({ type: 'buzz' });
  await a.until((x) => x.state.phase === 'answering');
  c.send({ type: 'buzz' });
  await sleep(200);
  assert(a.state.buzzer === b.joined.id, '先に押したBだけが回答権を得る（あとから押したCは無視）');
  assert(a.state.question.choices.length === 4 && a.state.question.choices.every((ch) => !ch.correct), '選択肢は出るが正解はまだ送られない');
  const textAtBuzz = a.state.question.text;
  await sleep(500);
  assert(a.state.question.text === textAtBuzz, '押したら問題文が止まる');

  c.send({ type: 'answer', choice: 0 });
  await sleep(200);
  assert(a.state.phase === 'answering', '回答権のないCの回答は無視される');

  const wi = surelyWrongIndex(a.state);
  b.send({ type: 'answer', choice: wi });
  await a.until((x) => x.state.phase === 'feedback');
  assert(player(a, b.joined.id).locked, 'まちがえたBはお手つき');
  await a.until(canBuzz);
  assert(a.state.question.choices[wi].out, 'まちがえた選択肢に×がつく');

  b.send({ type: 'buzz' });
  await sleep(200);
  assert(a.state.phase !== 'answering', 'お手つきのBはもう押せない');

  await a.until(decided);
  c.send({ type: 'buzz' });
  await a.until((x) => x.state.phase === 'answering');
  const ci = correctIndex(a.state);
  c.send({ type: 'answer', choice: ci });
  await a.until((x) => x.state.phase === 'reveal');
  assert(a.state.winner === c.joined.id && player(a, c.joined.id).score === 1, 'Cが正解して1点');
  assert(a.state.question.choices[ci].correct, '正解発表で正解が送られる');

  // --- 2問目: だれも押さない → 時間切れ
  await a.until((x) => x.state.question?.number === 2 && x.state.phase === 'reading');
  await a.until((x) => x.state.phase === 'waiting');
  assert(a.state.timer && a.state.timer.duration === 5000, '問題文が出きると5秒のカウントダウン');
  await a.until((x) => x.state.phase === 'reveal', 10000);
  assert(a.state.winner === null && a.state.message.includes('正解は'), '時間切れで正解が発表される');

  // --- 3問目: 通信切れ→復帰、そのあと全員お手つき
  await a.until((x) => x.state.question?.number === 3 && x.state.phase === 'reading');
  const bj = b.joined;
  b.ws.close();
  await a.until((x) => !player(x, bj.id).online);
  assert(true, '通信が切れたBはオフライン表示');

  const b2 = client('B2', `?room=${code}`);
  await b2.open;
  b2.send({ type: 'rejoin', id: bj.id, token: bj.token });
  await b2.until((x) => x.state?.you === bj.id);
  await a.until((x) => player(x, bj.id).online);
  assert(true, 'Bが同じプレイヤーとして復帰できる');

  const z = client('Z', `?room=${code}`);
  await z.open;
  z.send({ type: 'rejoin', id: bj.id, token: 'bad' });
  await z.until((x) => x.expired);
  assert(true, 'ちがう合言葉ではなりすませない');
  z.ws.close();

  for (const p of [a, b2, c]) {
    await a.until(decided);
    p.send({ type: 'buzz' });
    await a.until((x) => x.state.phase === 'answering');
    const right = correctIndex(a.state);
    p.send({ type: 'answer', choice: a.state.question.choices.findIndex((ch, i) => i !== right && !ch.out) });
    await a.until((x) => x.state.phase === 'feedback');
  }
  await a.until((x) => x.state.phase === 'reveal');
  assert(a.state.message.includes('全員お手つき'), '全員お手つきで正解発表');

  // --- 4・5問目: Aが正解（変なデータも送ってみる）
  for (const n of [4, 5]) {
    await a.until((x) => x.state.question?.number === n && decided(x));
    a.send({ type: 'buzz' });
    await a.until((x) => x.state.phase === 'answering');
    a.send({ type: 'answer', choice: 'length' });
    a.send({ type: 'answer', choice: 99 });
    a.send({ type: 'answer' });
    a.ws.send('これはJSONではない');
    await sleep(150);
    assert(a.state.phase === 'answering', `${n}問目: おかしなデータは無視され、サーバーも落ちない`);
    a.send({ type: 'answer', choice: correctIndex(a.state) });
    await a.until((x) => x.state.phase === 'reveal');
  }

  await a.until((x) => x.state.phase === 'result', 10000);
  const scores = Object.fromEntries(a.state.players.map((p) => [p.name, p.score]));
  console.log('   最終得点', scores);
  assert(scores['Aさん'] === 2 && scores['Cさん'] === 1 && scores['Bさん'] === 0, '最終得点が正しい');

  const late = client('late', `?room=${code}`);
  await late.open;
  late.send({ type: 'join', name: 'おくれた人' });
  await late.until((x) => x.errors.length > 0);
  assert(late.errors[0].includes('ゲーム中'), 'ゲーム中は途中参加できない');
  late.ws.close();

  a.send({ type: 'lobby' });
  await c.until((x) => x.state.phase === 'lobby');
  assert(c.state.players.every((p) => p.score === 0), '「もう一度」で待合室に戻り、得点がリセット');

  a.send({ type: 'leave' });
  await c.until((x) => x.state.players.length === 2);
  assert(c.state.hostId !== a.joined.id, 'ホストが抜けたら別の人がホストになる');

  console.log('ALL PASSED');
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
