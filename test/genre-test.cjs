// ジャンル選びのテスト（2人）: ホストだけが選べる・選んだジャンルだけが出る・文字入力に向かない問題は出ない
const URL = process.env.WS_URL || 'ws://127.0.0.1:8787/ws';
const ROOT = require('node:url').pathToFileURL(require('node:path').join(__dirname, '..')).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
};

function client(label, query = '') {
  const ws = new WebSocket(URL + query);
  const c = { ws, label, state: null, joined: null, waiters: [] };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') c.state = m;
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
  // 本物のアプリと同じように、だまっている人も20秒ごとに生きていることを知らせる
  setInterval(() => { if (ws.readyState === 1) c.send({ type: 'ping' }); }, 20000);
  return c;
}

(async () => {
  const QUESTIONS = (await import(`${ROOT}/src/questions.generated.json`, { with: { type: 'json' } })).default;
  const { GENRES } = await import(`${ROOT}/quiz/lib.js`);
  const { isInputQuestion } = await import(`${ROOT}/src/kana.js`);
  const byText = new Map(QUESTIONS.map((q) => [q.q, q]));

  const a = client('A');
  await a.open;
  a.send({ type: 'create', name: 'Aさん' });
  await a.until((x) => x.state?.phase === 'lobby');
  const b = client('B', `?room=${a.state.code}`);
  await b.open;
  b.send({ type: 'join', name: 'Bさん' });
  await a.until((x) => x.state.players.length === 2);

  assert(JSON.stringify(a.state.genreList) === JSON.stringify(GENRES), `ジャンルは15個で、決めた順に並ぶ (${a.state.genreList.length})`);
  assert(a.state.genres.length === 0, '最初は「すべて」');
  assert(a.state.totalQuestions === QUESTIONS.length, `問題は全部で ${a.state.totalQuestions} 問`);

  b.send({ type: 'settings', genres: ['歴史'] });
  await sleep(300);
  assert(a.state.genres.length === 0, 'ホストでない人はジャンルを変えられない');

  a.send({ type: 'settings', genres: ['歴史', 'ないジャンル'], answerMode: 'input', questionCount: 5, questionKind: 'text' });
  await b.until((x) => x.state.genres.length === 1 && x.state.answerMode === 'input');
  assert(b.state.genres[0] === '歴史', '知らないジャンル名は無視して「歴史」だけになる');

  // 1ゲーム遊んで、出た問題を全部たしかめる
  async function playGame(check) {
    a.send({ type: 'start' });
    for (let n = 1; n <= 5; n++) {
      await a.until((x) => x.state.question?.number === n && x.state.phase === 'waiting', 60000);
      const q = byText.get(a.state.question.text);
      assert(q, `問題${n}: 問題文が見つかる`);
      check(q, a.state.question.mode, n);
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
      assert(a.state.winner === a.joined.id, `問題${n}: 正しく答えると正解になる`);
    }
    await a.until((x) => x.state.phase === 'result', 30000);
    a.send({ type: 'lobby' });
    await a.until((x) => x.state.phase === 'lobby');
  }

  await playGame((q, mode, n) => {
    assert(q.genre === '歴史', `問題${n}: ジャンルは歴史 (${q.q.slice(0, 20)}…)`);
    assert(mode === 'input' && isInputQuestion(q), `問題${n}: 文字入力に向く問題だけが出る (${q.answer})`);
  });

  const two = ['スポーツ', 'エンタメ'];
  a.send({ type: 'settings', genres: two, answerMode: 'choice' });
  await a.until((x) => x.state.genres.length === 2 && x.state.answerMode === 'choice');
  await playGame((q, mode, n) => {
    assert(two.includes(q.genre) && mode === 'choice', `問題${n}: スポーツかエンタメの選択肢問題 (${q.genre})`);
  });

  a.send({ type: 'settings', genres: [] });
  await b.until((x) => x.state.genres.length === 0);
  assert(true, '空にすると「すべて」にもどる');
  console.log('ALL PASSED');
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
