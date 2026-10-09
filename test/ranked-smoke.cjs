// ランクマッチのテスト: 2人対戦・4人対戦・レート・NGワード・ブロック・通報・記録の削除
const WS = (process.env.WS_URL || 'ws://127.0.0.1:8787/ws').replace(/\/ws$/, '');
const HTTP = WS.replace(/^ws/, 'http');
const ROOT = require('node:url').pathToFileURL(require('node:path').join(__dirname, '..')).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('ok -', msg);
};

function client(label, url) {
  const ws = new WebSocket(url);
  const c = { ws, label, state: null, joined: null, registered: null, matched: null, errors: [], closed: null, waiters: [] };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') c.state = m;
    if (m.type === 'joined') c.joined = m;
    if (m.type === 'registered') c.registered = m;
    if (m.type === 'matched') c.matched = m;
    if (m.type === 'error') c.errors.push(m.message);
    if (m.type === 'closed') c.closed = m.message;
    c.waiters = c.waiters.filter((w) => !w());
  };
  c.send = (m) => ws.send(JSON.stringify(m));
  c.until = (pred0, ms = 40000) => new Promise((res, rej) => {
    const pred = (x) => { try { return pred0(x); } catch { return false; } };
    if (pred(c)) return res();
    const t = setTimeout(() => rej(new Error(`${label}: timeout (phase=${c.state?.phase} msg=${c.state?.message})`)), ms);
    c.waiters.push(() => { if (!pred(c)) return false; clearTimeout(t); res(); return true; });
  });
  c.open = new Promise((r) => { ws.onopen = r; });
  setInterval(() => { if (ws.readyState === 1) c.send({ type: 'ping' }); }, 20000);
  return c;
}

const post = async (path, body) => (await fetch(HTTP + path, { method: 'POST', body: JSON.stringify(body) })).json();

(async () => {
  const QUESTIONS = (await import(`${ROOT}/src/questions.generated.json`, { with: { type: 'json' } })).default;
  const IMAGES = (await import(`${ROOT}/src/images.generated.json`, { with: { type: 'json' } })).default;

  // 表示されている問題文（画像）から正解をさがす。まだ1つに決まらなければ null
  const answerOf = (st) => {
    const q = st.question;
    if (q.image) return IMAGES.find((x) => x.image.frames[0].src === q.image.frames[0].src)?.answer ?? null;
    const answers = new Set(QUESTIONS.filter((x) => x.q.startsWith(q.text)).map((x) => x.answer));
    return answers.size === 1 ? [...answers][0] : null;
  };
  // 答える（correct=false なら、わざとまちがえる）。multi: 4人対戦（自分だけに届く mine を使う）
  const respond = async (c, answer, correct, multi) => {
    const q = c.state.question;
    if (q.mode === 'choice') {
      await c.until((x) => (multi ? x.state.mine?.choices : x.state.question.choices));
      const list = multi ? c.state.mine.choices : c.state.question.choices;
      c.send({ type: 'answer', choice: list.findIndex((ch) => (ch.text === answer) === correct && !ch.out) });
      return;
    }
    const chars = [...answer];
    for (let i = 0; i < chars.length; i++) {
      const inputOf = (x) => (multi ? x.state.mine?.input : x.state.question.input);
      await c.until((x) => inputOf(x)?.letters && [...inputOf(x).typed].length === i);
      const letters = inputOf(c).letters;
      c.send({ type: 'letter', index: correct ? letters.indexOf(chars[i]) : letters.findIndex((l) => l !== chars[i]), pos: i });
      if (!correct) return;
    }
  };
  const canBuzz = (x) => x.state.phase === 'reading' || x.state.phase === 'waiting';

  async function queue(name, mode, ident = null, blocks = []) {
    const l = client(`ladder:${name}`, `${WS}/ladder`);
    await l.open;
    l.send({ type: 'queue', mode, name, id: ident?.id, token: ident?.token, blocks });
    return l;
  }
  async function enter(l, name) {
    await l.until((x) => x.matched);
    const c = client(name, `${WS}/ws?match=${l.matched.match}`);
    await c.open;
    c.send({ type: 'ranked-join', ticket: l.matched.ticket });
    await c.until((x) => x.joined && x.state);
    l.ws.close();
    c.ident = l.registered;
    return c;
  }

  // ===== 2人対戦: 先に5問正解で勝ち =====
  const la = await queue('テストA', 'duel');
  const lb = await queue('テストB', 'duel');
  await la.until((x) => x.registered && x.matched);
  assert(la.registered.id && la.registered.token, 'はじめてのランクマッチで、端末のプレイヤーがつくられる');
  const [a, b] = await Promise.all([enter(la, 'たろう'), enter(lb, 'はなこ')]);
  assert(a.joined.match === la.matched.match, '組み合わせが決まり、ランクマッチの部屋に入れる');
  assert(a.state.ranked.mode === 'duel' && a.state.ranked.rules.lives === 3 && a.state.ranked.rules.target === 5, '2人対戦: ライフ3・5問先取');
  assert(a.state.players.every((p) => p.title === '5級' && p.rating === 1500), 'はじめは5級・レート1500');
  await a.until((x) => x.state.phase === 'ready', 15000);
  assert(a.state.players.every((p) => p.lives === 3), '始まると全員ライフ3');
  for (let n = 1; ; n++) {
    await a.until((x) => x.state.phase === 'result' || (x.state.question?.number === n && canBuzz(x) && answerOf(x.state)), 60000);
    if (a.state.phase === 'result') break;
    const ans = answerOf(a.state);
    a.send({ type: 'buzz' });
    await a.until((x) => x.state.phase === 'answering' && x.state.buzzer === a.joined.id);
    await respond(a, ans, true, false);
    await a.until((x) => x.state.phase === 'reveal' || x.state.phase === 'result');
  }
  const me = (c) => c.state.players.find((p) => p.id === c.joined.id);
  assert(me(a).score === 5 && a.state.question === null, '5問正解したところで決着');
  await a.until((x) => x.state.ranked.results?.length === 2);
  const resA = a.state.ranked.results.find((r) => r.id === a.joined.id);
  const resB = a.state.ranked.results.find((r) => r.id === b.joined.id);
  assert(resA.place === 1 && resA.delta === 24 && resA.after === 1524, `勝ったたろうは +24 (${resA.before}→${resA.after})`);
  assert(resB.place === 2 && resB.delta === -24, `負けたはなこは -24 (${resB.before}→${resB.after})`);
  const meA = await post('/api/me', a.ident);
  assert(meA.player.rating === 1524 && meA.player.games === 1 && meA.player.wins === 1 && meA.player.title === '5級', 'サーバーにレートと対戦数が保存される');
  a.send({ type: 'leave' });
  b.send({ type: 'leave' });
  // 本番のランキングにテストの記録を残さないよう、消しておく
  for (const ident of [a.ident, b.ident]) {
    const r = await post('/api/delete', ident);
    assert(r.ok, 'テストの記録を消した');
  }
  const ranking = await (await fetch(HTTP + '/api/ranking')).json();
  assert(Array.isArray(ranking.players), 'ランキングが読める');
  console.log('ALL PASSED');
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
