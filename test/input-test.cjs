// 文字入力形式のテスト（2人）
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
    const safe = (x) => { try { return pred0(x); } catch { return false; } }; // まだ届いていないデータを読んでも止まらない
    const pred = safe;
    if (pred(c)) return res();
    const t = setTimeout(() => rej(new Error(`${label}: timeout (phase=${c.state?.phase})`)), ms);
    c.waiters.push(() => { if (!pred(c)) return false; clearTimeout(t); res(); return true; });
  });
  c.open = new Promise((r) => { ws.onopen = r; });
  return c;
}

(async () => {
  const QUESTIONS = (await import(`${ROOT}/src/questions.generated.json`, { with: { type: 'json' } })).default;
  const a = client('A');
  await a.open;
  a.send({ type: 'create', name: 'Aさん' });
  await a.until((x) => x.state?.phase === 'lobby');
  const b = client('B', `?room=${a.state.code}`);
  await b.open;
  b.send({ type: 'join', name: 'Bさん' });
  await a.until((x) => x.state.players.length === 2);

  a.send({ type: 'settings', questionCount: 5, answerMode: 'input', questionKind: 'text' });
  await b.until((x) => x.state.answerMode === 'input' && x.state.questionCount === 5);
  assert(true, '答え方を「文字入力」に設定できる');
  a.send({ type: 'start' });
  await a.until((x) => x.state.phase === 'ready');
  assert(a.state.question.mode === 'input', '文字入力の問題が出る');

  // 1問目: 問題文が出きるのを待って、答えを調べる
  await a.until((x) => x.state.phase === 'waiting');
  const answerOf = (st) => QUESTIONS.find((q) => q.q === st.question.text).answer;
  let answer = answerOf(a.state);
  assert(/^[ぁ-ゖァ-ヺー]+$/.test(answer), `答えはかなだけ (${answer})`);
  assert(a.state.question.choices === null && a.state.question.input === null, '押す前は選択肢も文字も出ない');

  // B が押して、1文字目でわざとまちがえる → お手つき
  b.send({ type: 'buzz' });
  await b.until((x) => x.state.phase === 'answering');
  const inp = b.state.question.input;
  assert(inp.total === [...answer].length && inp.typed === '' && inp.letters.length === 4, `${inp.total}文字のマスと4つの文字が出る (${inp.letters.join(' ')})`);
  assert(inp.letters.includes([...answer][0]), '4つの中に正しい1文字目がある');
  await a.until((x) => x.state.question.input?.letters); // ネット越しだと、Aへの知らせは少しおくれて届く
  assert(a.state.question.input.letters.length === 4, '押していない人にも文字が見える（押せないだけ）');
  a.send({ type: 'letter', index: 0, pos: 0 });
  await sleep(200);
  assert(b.state.phase === 'answering', '押していない人の文字選択は無視される');
  const wrongIndex = inp.letters.findIndex((l) => l !== [...answer][0]);
  b.send({ type: 'letter', index: wrongIndex, pos: 0 });
  await a.until((x) => x.state.phase === 'feedback');
  assert(a.state.players.find((p) => p.id === b.joined.id).locked, 'まちがった文字でお手つき');
  await a.until((x) => x.state.phase === 'waiting' || x.state.phase === 'reading');

  // A が押して、正しい文字を順に選ぶ（連打のずれも試す）
  a.send({ type: 'buzz' });
  await a.until((x) => x.state.phase === 'answering');
  const chars = [...answer];
  for (let i = 0; i < chars.length; i++) {
    await a.until((x) => x.state.question.input && x.state.question.input.typed.length === i && x.state.question.input.letters);
    const letters = a.state.question.input.letters;
    const idx = letters.indexOf(chars[i]);
    a.send({ type: 'letter', index: idx, pos: i });
    if (i === 0) a.send({ type: 'letter', index: (idx + 1) % 4, pos: 0 }); // 連打（古い位置の選択）は無視されるはず
  }
  await a.until((x) => x.state.phase === 'reveal');
  assert(a.state.winner === a.joined.id && a.state.question.input.typed === answer, `最後まで選ぶと正解 (${answer})`);
  assert(a.state.players.find((p) => p.id === a.joined.id).score === 1, '1ポイント入る');
  assert(a.state.question.answer === answer, '正解発表で答えが送られる');

  // 2問目: 時間切れ（押したあと何もしない）
  await a.until((x) => x.state.question?.number === 2 && x.state.phase === 'reading');
  a.send({ type: 'buzz' });
  await a.until((x) => x.state.phase === 'feedback', 15000);
  assert(a.state.message.includes('時間切れ'), '文字を選ばないと時間切れでお手つき');

  // ミックス
  await a.until((x) => x.state.phase === 'result', 120000);
  a.send({ type: 'lobby' });
  await a.until((x) => x.state.phase === 'lobby');
  a.send({ type: 'settings', questionCount: 5, answerMode: 'mix' });
  await a.until((x) => x.state.answerMode === 'mix' && x.state.questionCount === 5);
  a.send({ type: 'start' });
  const modes = [];
  // 1人ずつ、とりあえず1番目の選択肢（文字）を選んで、早く次の問題へ進める
  const quickAnswer = async (p) => {
    p.send({ type: 'buzz' });
    await a.until((x) => x.state.phase === 'answering');
    while (a.state.phase === 'answering') {
      const st = a.state;
      if (st.question.mode === 'choice') p.send({ type: 'answer', choice: st.question.choices.findIndex((c) => !c.out) });
      else p.send({ type: 'letter', index: 0, pos: [...st.question.input.typed].length });
      await sleep(150);
    }
  };
  for (let n = 1; n <= 5; n++) {
    await a.until((x) => x.state.question?.number === n && x.state.phase === 'ready', 60000);
    modes.push(a.state.question.mode);
    await a.until((x) => x.state.phase === 'reading');
    await quickAnswer(a);
    if (a.state.phase === 'feedback') {
      await a.until((x) => x.state.phase === 'reading' || x.state.phase === 'waiting' || x.state.phase === 'reveal');
      if (a.state.phase !== 'reveal') await quickAnswer(b);
    }
  }
  const inputs = modes.filter((m) => m === 'input').length;
  assert(inputs === 2, `ミックス5問のうち文字入力は2問 (${modes.join(',')})`);
  console.log('ALL PASSED');
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
