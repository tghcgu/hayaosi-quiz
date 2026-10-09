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
  const la = await queue('たろう', 'duel');
  const lb = await queue('はなこ', 'duel');
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

  // ===== 2人対戦: 3回まちがえると脱落して負け =====
  const lc = await queue('じろう', 'duel');
  const ld = await queue('さくら', 'duel');
  const [c, d] = await Promise.all([enter(lc, 'じろう'), enter(ld, 'さくら')]);
  for (let k = 1; k <= 3; k++) {
    await c.until((x) => x.state.question?.number === k && canBuzz(x) && answerOf(x.state), 60000);
    const ans = answerOf(c.state);
    c.send({ type: 'buzz' });
    await c.until((x) => x.state.phase === 'answering' && x.state.buzzer === c.joined.id);
    await respond(c, ans, false, false);
    await c.until((x) => x.state.phase === 'feedback');
    assert(me(c).lives === 3 - k, `じろうがまちがえてライフ ${3 - k}`);
    if (k < 3) {
      await d.until(canBuzz);
      d.send({ type: 'buzz' });
      await d.until((x) => x.state.phase === 'answering' && x.state.buzzer === d.joined.id);
      await respond(d, ans, true, false);
      await d.until((x) => x.state.phase === 'reveal');
    }
  }
  assert(me(c).out, 'ライフ0で脱落');
  await d.until((x) => x.state.phase === 'result' && x.state.ranked.results?.length === 2, 20000);
  const resD = d.state.ranked.results.find((r) => r.id === d.joined.id);
  assert(resD.place === 1, `点数に関係なく、脱落しなかったさくらの勝ち（さくら ${me(d).score}点・じろう ${me(c).score}点）`);
  c.send({ type: 'leave' });
  d.send({ type: 'leave' });

  // ===== 4人対戦: 3人まで答えられ、押した順に3・2・1点 =====
  const names4 = ['いち', 'にい', 'さん', 'よん'];
  const ladders = [];
  for (const n of names4) ladders.push(await queue(n, 'four'));
  const [e, f, g, h] = await Promise.all(ladders.map((l, i) => enter(l, names4[i])));
  assert(e.state.ranked.mode === 'four' && e.state.ranked.rules.slots === 3 && e.state.ranked.rules.points.join() === '3,2,1', '4人対戦: 3人まで・3/2/1点');
  // 1問目: いち・にい・さん が押し、よんは押せない。いちとさんが正解、にいがまちがい
  await e.until((x) => x.state.question?.number === 1 && canBuzz(x) && answerOf(x.state), 60000);
  let ans = answerOf(e.state);
  e.send({ type: 'buzz' });
  await e.until((x) => x.state.phase === 'answering' && x.state.question.slots.length === 1);
  assert(e.state.question.window === true, '最初の早押しのあと、ほかの人も押せる時間がある');
  assert(e.state.mine?.order === 1 && (e.state.mine.choices || e.state.mine.input), 'いちは1番。自分の選択肢（文字）が届く');
  assert(h.state.mine === null && (h.state.question.choices === null), '押していない人には選択肢が見えない');
  f.send({ type: 'buzz' });
  await e.until((x) => x.state.question.slots.length === 2);
  g.send({ type: 'buzz' });
  await e.until((x) => x.state.question.slots.length === 3);
  h.send({ type: 'buzz' });
  await sleep(300);
  assert(e.state.question.slots.length === 3 && !e.state.question.window, '3人押したら締め切り（4人目は押せない）');
  assert(e.state.question.slots.map((s) => s.order).join() === '1,2,3', '押した順に1番・2番・3番');
  await Promise.all([respond(e, ans, true, true), respond(f, ans, false, true), respond(g, ans, true, true)]);
  // 点数は各自の画面の状態から読むので、4人全員に正解発表が届くまで待つ
  await Promise.all([e, f, g, h].map((c) => c.until((x) => x.state.phase === 'reveal')));
  const pts = (c) => me(c).score;
  assert(pts(e) === 3 && pts(f) === 0 && pts(g) === 1, `1番で正解 +3・3番で正解 +1・2番はまちがい（${e.state.message}）`);
  assert(me(f).lives === 2 && me(e).lives === 3, 'まちがえたにいはライフ -1');
  assert(e.state.question.slots.every((s) => typeof s.correct === 'boolean'), '正解発表で、だれが正解したかが見える');
  // 2〜4問目: わざとまちがえて脱落させる → 1人だけ残ったら決着
  const plan = [[e, f, g], [e, f, g], [e, g, h]];
  for (const [i, group] of plan.entries()) {
    const n = i + 2;
    await e.until((x) => x.state.question?.number === n && canBuzz(x) && answerOf(x.state), 60000);
    ans = answerOf(e.state);
    for (const p of group) {
      p.send({ type: 'buzz' });
      await p.until((x) => x.state.mine?.order);
    }
    await Promise.all(group.map((p) => respond(p, ans, false, true)));
    await e.until((x) => x.state.phase === 'reveal' || x.state.phase === 'result');
  }
  await e.until((x) => x.state.phase === 'result' && x.state.ranked.results?.length === 4, 20000);
  assert(me(e).out && me(f).out && me(g).out && !me(h).out, '3人が脱落し、1人だけ残ったところで決着');
  const r4 = Object.fromEntries([e, f, g, h].map((p) => [p.label, e.state.ranked.results.find((r) => r.id === p.joined.id)]));
  assert(r4['いち'].place === 1 && r4['さん'].place === 2 && r4['よん'].place === 3 && r4['にい'].place === 4, '点数の順（同点ならライフの多い順）に順位がつく');
  assert(r4['いち'].delta === 24 && r4['さん'].delta === 8 && r4['よん'].delta === -8 && r4['にい'].delta === -24, `4人のレートの変化: ${Object.entries(r4).map(([k, v]) => `${k} ${v.delta > 0 ? '+' : ''}${v.delta}`).join(' ')}`);
  for (const p of [e, f, g, h]) p.send({ type: 'leave' });

  // ===== 名前のチェック =====
  const bad = await queue('ちんこ', 'duel');
  await bad.until((x) => x.errors.length > 0);
  assert(bad.errors[0].includes('使えません'), 'ふさわしくない名前はランクマッチで使えない');

  // ===== ブロックした相手とは組まない =====
  const lq = await queue('きゅう', 'duel');
  await lq.until((x) => x.registered);
  const lp = await queue('ぴい', 'duel', null, [lq.registered.id]);
  await sleep(2500);
  assert(!lp.matched && !lq.matched, 'ブロックした相手とは組み合わせにならない');
  const lr = await queue('あある', 'duel');
  await lr.until((x) => x.matched);
  await sleep(500);
  assert(!(lp.matched && lq.matched && lp.matched.match === lq.matched.match), 'ほかの人が来たら、その人と組む');
  for (const l of [lp, lq, lr]) { l.send({ type: 'cancel' }); l.ws.close(); }

  // ===== 通報: 3人から通報されると、その名前は使えなくなる =====
  for (const reporter of [a.ident, b.ident, c.ident]) {
    const r = await post('/api/report', { ...reporter, target: d.ident.id });
    assert(r.ok, '通報できる');
  }
  const meD = await post('/api/me', d.ident);
  assert(meD.player.name.startsWith('プレイヤー'), `通報が集まった名前は「${meD.player.name}」にもどる`);
  const again = await queue('さくら', 'duel', d.ident);
  await again.until((x) => x.errors.length > 0);
  assert(again.errors[0].includes('通報'), '同じ名前ではもう遊べない');

  // ===== ランキングと記録の削除 =====
  const ranking = await (await fetch(HTTP + '/api/ranking')).json();
  assert(Array.isArray(ranking.players) && ranking.minGames === 3, `ランキングは ${ranking.minGames} 戦以上の人だけ（いま ${ranking.players.length} 人）`);
  const del = await post('/api/delete', a.ident);
  const gone = await post('/api/me', a.ident);
  assert(del.ok && gone.player === null, 'ランクマッチの記録を消せる');

  console.log('ALL PASSED');
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
