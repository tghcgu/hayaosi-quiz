'use strict';
// スマホ側。サーバーから届く「部屋の今の様子(state)」を画面に描き、押したボタンをサーバーに送るだけ

const $ = (id) => document.getElementById(id);
const SCREENS = ['home', 'matching', 'leaderboard', 'lobby', 'game', 'result'];

let socket = null;
let state = null;
let session = load('sessionStorage', 'session');
let timerEnd = 0;
let timerDuration = 0;
let view = 'home';       // 部屋に入っていないときの画面（home / matching / leaderboard）
let ladder = null;       // ランクマッチの相手さがしの接続
let matching = null;     // 相手さがし中の { mode, since, count }
let lastRankedMode = 'duel';

const RANKED_NAMES = { duel: '2人対戦', four: '4人対戦' };
const RANKED_RULES = {
  duel: '先に5問正解した方の勝ち。ライフは3つで、まちがえると1つ減り、なくなると負け',
  four: '1問に3人まで答えられ、早く押した順に3点・2点・1点。ライフは3つで、なくなると脱落。全10問',
};

// ===== 保存（ブラウザが保存を禁止していても動くように） =====

function load(storage, key) {
  try {
    return JSON.parse(window[storage].getItem(key));
  } catch {
    return null;
  }
}

function save(storage, key, value) {
  try {
    if (value === null) window[storage].removeItem(key);
    else window[storage].setItem(key, JSON.stringify(value));
  } catch {
    // 保存できなくても遊べる
  }
}

function setSession(value) {
  session = value;
  save('sessionStorage', 'session', value);
}

// ===== 通信 =====
// 「部屋をつくる」「部屋に入る」を押したときに、その部屋へつなぐ。切れたら自動でつなぎなおす

function wsBase() {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
}

function connect(query, firstMessage) {
  if (socket) socket.close();
  const ws = new WebSocket(`${wsBase()}/ws${query}`);
  let opened = false;
  socket = ws;
  ws.addEventListener('open', () => {
    opened = true;
    $('conn').hidden = true;
    ws.send(JSON.stringify(firstMessage));
  });
  ws.addEventListener('message', (e) => onMessage(JSON.parse(e.data)));
  ws.addEventListener('close', () => {
    if (socket !== ws) return; // 新しい接続に切りかえたあとの古い接続
    socket = null;
    if (session) {
      $('conn').textContent = '接続が切れました。つなぎなおしています…';
      $('conn').hidden = false;
      setTimeout(reconnect, 1500);
    } else if (!opened) {
      $('error').textContent = 'サーバーにつながりませんでした';
    }
  });
}

function reconnect() {
  if (!session || socket) return;
  const query = session.match ? `?match=${session.match}` : `?room=${session.room}`;
  connect(query, { type: 'rejoin', id: session.id, token: session.token });
}

function send(msg) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(msg));
  return true;
}

function onMessage(msg) {
  switch (msg.type) {
    case 'joined':
      setSession(msg.match ? { match: msg.match, id: msg.id, token: msg.token } : { room: msg.room, id: msg.id, token: msg.token });
      break;
    case 'expired':
      setSession(null);
      state = null;
      goHome();
      break;
    case 'error':
      $('error').textContent = msg.message;
      break;
    case 'closed':
      setSession(null);
      state = null;
      goHome();
      $('error').textContent = msg.message;
      break;
    case 'state': {
      const prev = state;
      state = msg;
      playEffects(prev, state);
      render();
      break;
    }
  }
}

// ===== 画面 =====

function me() {
  return state.players.find((p) => p.id === state.you);
}

function isHost() {
  return state.hostId === state.you;
}

function render() {
  let screen = view;
  if (state) screen = state.phase === 'lobby' || state.phase === 'result' ? state.phase : 'game';
  document.body.dataset.phase = state ? state.phase : '';
  for (const id of SCREENS) $(id).hidden = id !== screen;
  if (screen === 'matching') renderMatching();
  if (screen === 'lobby') renderLobby();
  if (screen === 'game') renderGame();
  if (screen === 'result') renderResult();
}

function renderLobby() {
  const ranked = state.ranked;
  $('room-info').hidden = Boolean(ranked);
  $('ranked-title').hidden = !ranked;
  renderPlayers($('lobby-players'), state.players);
  if (ranked) {
    // ランクマッチ: 設定はなく、全員がそろったら自動で始まる
    $('ranked-title').textContent = `ランクマッチ・${RANKED_NAMES[ranked.mode]}`;
    $('host-controls').hidden = true;
    $('lobby-wait').hidden = false;
    $('lobby-wait').textContent = ranked.waitingFor > 0
      ? `対戦相手が見つかりました。全員がそろうのを待っています…\n${RANKED_RULES[ranked.mode]}`
      : `まもなく始まります！\n${RANKED_RULES[ranked.mode]}`;
    return;
  }
  const host = isHost();
  $('lobby-code').textContent = state.code;
  $('invite').textContent = `${location.origin}/?room=${state.code}`;

  $('host-controls').hidden = !host;
  $('lobby-wait').hidden = host;
  $('lobby-wait').textContent = `問題数: ${state.questionCount}問　出題: ${KIND_LABELS[state.questionKind]}　答え方: ${MODE_LABELS[state.answerMode]}　ジャンル: ${state.genres.length ? state.genres.join('・') : 'すべて'}　ホストがスタートするのを待っています…`;

  renderSeg($('counts'), state.questionCounts, state.questionCount, (n) => `${n}問`, (n) => ({ questionCount: n }));
  renderSeg($('kinds'), state.questionKinds, state.questionKind, (k) => KIND_LABELS[k], (k) => ({ questionKind: k }));
  renderSeg($('modes'), state.answerModes, state.answerMode, (m) => MODE_LABELS[m], (m) => ({ answerMode: m }));

  // ジャンル: 押すたびに選ぶ／外す。何も選ばなければ「すべて」
  const genres = $('genres');
  genres.textContent = '';
  const toggle = (g) => (state.genres.includes(g) ? state.genres.filter((x) => x !== g) : [...state.genres, g]);
  for (const g of ['すべて', ...state.genreList]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = g;
    button.classList.toggle('on', g === 'すべて' ? state.genres.length === 0 : state.genres.includes(g));
    button.addEventListener('click', () => send({ type: 'settings', genres: g === 'すべて' ? [] : toggle(g) }));
    genres.append(button);
  }
}

const MODE_LABELS = { mix: 'ミックス', choice: '選択肢', input: '文字入力' };
const KIND_LABELS = { mix: 'まぜる', text: '文章', image: '画像' };

function renderSeg(box, values, current, label, settings) {
  box.textContent = '';
  for (const v of values) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label(v);
    button.classList.toggle('on', v === current);
    button.addEventListener('click', () => send({ type: 'settings', ...settings(v) }));
    box.append(button);
  }
}

function renderPlayers(list, players, withScore = false) {
  list.textContent = '';
  for (const p of players) {
    const li = document.createElement('li');
    const tags = [];
    if (p.title) tags.push(p.title);
    if (p.id === state.hostId) tags.push('ホスト');
    if (p.id === state.you) tags.push('あなた');
    if (!p.online) tags.push('オフライン');
    if (withScore) li.append(`${1 + players.filter((o) => o.score > p.score).length}位`);
    li.append(dot(p.color), p.name);
    if (tags.length) li.append(span('tag', tags.join('・')));
    if (withScore) li.append(span('pts', `${p.score}点`));
    list.append(li);
  }
}

// ライフ（ランクマッチだけ）
function hearts(p) {
  if (p.lives === null || p.lives === undefined) return null;
  return span('hearts', p.out ? '脱落' : '♥'.repeat(p.lives));
}

function renderGame() {
  const q = state.question;
  const self = me();
  const own = state.mine;            // 4人対戦で、自分が答えているときだけ届く（自分の選択肢・文字）
  const multi = Boolean(q.slots);    // 4人対戦（3人まで答えられる）
  const mySlot = multi ? q.slots.find((s) => s.id === state.you) : null;
  const myTurn = multi ? Boolean(own && !own.done) : state.phase === 'answering' && state.buzzer === state.you;

  const modeName = state.ranked ? `・${RANKED_NAMES[state.ranked.mode]}` : '';
  $('q-number').textContent = `${q.number}/${q.total}問${modeName}${q.image ? '・画像' : ''}${q.mode === 'input' ? '・文字入力' : ''}`;

  const scores = $('scores');
  scores.textContent = '';
  for (const p of state.players) {
    const item = span('score', '');
    item.classList.toggle('me', p.id === state.you);
    item.classList.toggle('locked', p.locked && !p.out);
    item.classList.toggle('offline', !p.online || p.out);
    item.append(dot(p.color), `${p.name} ${p.score}`);
    const life = hearts(p);
    if (life) item.append(life);
    scores.append(item);
  }

  const text = $('q-text');
  text.textContent = q.text;
  if (q.rest) text.append(span('rest', q.rest));
  renderPhoto(q);

  let status = state.message;
  if (state.phase === 'ready') status = `第${q.number}問`;
  if (multi && state.phase === 'answering') {
    const order = q.slots.map((s) => `${s.order}番 ${state.players.find((p) => p.id === s.id)?.name ?? ''}${s.done ? '✓' : ''}`).join('　');
    if (myTurn) status = `あなたは${own.order}番！ ${q.mode === 'input' ? '1文字ずつ選んで答えて' : '答えをえらんで'}`;
    else if (mySlot) status = `答えました。みんなを待っています…　${order}`;
    else status = q.window && !self.out ? `いまなら押せる！（3人まで）　${order}` : order;
  } else if (myTurn) {
    status = q.mode === 'input' ? 'あなたが早押し！ 1文字ずつ選んで答えて' : 'あなたが早押し！ 答えをえらんで';
  }
  $('status').textContent = status;

  // 文字入力: 答えの文字数ぶんのマスと、選べる4文字
  const input = own?.input ?? q.input;
  $('input').hidden = !input;
  if (input) {
    const typed = Array.from(input.typed);
    const boxes = $('typed');
    boxes.textContent = '';
    boxes.classList.toggle('correct', state.phase === 'reveal' && (multi ? Boolean(mySlot?.correct) : Boolean(state.winner)));
    for (let i = 0; i < input.total; i++) {
      const box = span(typed[i] ? 'filled' : '', typed[i] || '');
      boxes.append(box);
    }
    const letters = $('letters');
    letters.textContent = '';
    (input.letters || []).forEach((ch, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = ch;
      button.disabled = !myTurn;
      button.addEventListener('click', () => {
        // 連打で次の文字まで選ばないよう、返事が来るまで押せなくする
        for (const b of letters.children) b.disabled = true;
        send({ type: 'letter', index: i, pos: typed.length });
      });
      letters.append(button);
    });
  }

  const choices = $('choices');
  choices.textContent = '';
  const list = own?.choices ?? q.choices ?? [];
  // 選択肢が長い問題（ことわざの意味など）は1列にならべる
  choices.classList.toggle('wide', list.some((c) => c.text.length > 9));
  list.forEach((c, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = `${i + 1}. ${c.text}`;
    button.classList.toggle('out', Boolean(c.out));
    button.classList.toggle('correct', Boolean(c.correct));
    button.classList.toggle('picked', Boolean(c.picked));
    button.disabled = !myTurn || Boolean(c.out);
    button.addEventListener('click', () => {
      for (const b of choices.children) b.disabled = true;
      send({ type: 'answer', choice: i });
    });
    choices.append(button);
  });

  // 早押しボタン: 4人対戦では、だれかが押したあとも少しのあいだ（3人まで）押せる
  const buzz = $('buzz');
  buzz.style.setProperty('--c', self.color);
  const open = state.phase === 'reading' || state.phase === 'waiting' || (multi && state.phase === 'answering' && q.window && !mySlot);
  buzz.disabled = !open || self.locked || self.out;
  buzz.textContent = self.out ? '脱落' : self.locked ? 'お手つき' : mySlot ? `${mySlot.order}番` : '早押し！';

  const timer = own?.timer ?? state.timer;
  if (timer) {
    timerEnd = performance.now() + timer.remaining;
    timerDuration = timer.duration;
  } else {
    timerDuration = 0;
  }
}

// ===== 画像クイズ =====
// サーバーは「何段階目まで見せたか」だけを送ってくる。
// 新しい段階の画像は、1つ前の段階と同じ見え方から始めて、その段階の全体までなめらかに引いていく。
// 早押しされたらその場で止め、続きになったらまた動かす

let photo = { key: null, shown: 0 };
const preloaded = new Set();

function preload(src) {
  if (preloaded.has(src)) return;
  preloaded.add(src);
  new Image().src = src;
}

// 1つ前の段階の範囲 (prev) が、いまの段階の画像 (cur) の中でどこにあたるか → それが画面いっぱいになる transform
function viewOf(prev, cur) {
  const [px, py, ps] = prev;
  const [cx, cy, cs] = cur;
  const f = ps / cs;
  return `scale(${1 / f}) translate(${(-(px - cx) / cs) * 100}%, ${(-(py - cy) / cs) * 100}%)`;
}

function moveTo(img, ms) {
  img.style.transition = `transform ${Math.max(0, Math.round(ms))}ms linear`;
  img.style.transform = 'none';
  photo.moving = { start: performance.now(), duration: ms, from: photo.progress };
}

function freeze(img) {
  if (!photo.moving) return;
  const m = photo.moving;
  const t = m.duration ? Math.min(1, (performance.now() - m.start) / m.duration) : 1;
  photo.progress = m.from + (1 - m.from) * t;
  const now = getComputedStyle(img).transform;
  img.style.transition = 'none';
  img.style.transform = now === 'none' ? 'none' : now;
  photo.moving = null;
}

function renderPhoto(q) {
  const box = $('photo');
  const img = $('photo-img');
  const im = q.image;
  $('game').classList.toggle('image', Boolean(im));
  box.hidden = !im;
  $('credit').hidden = !(im && im.credit);
  if (!im) {
    photo = { key: null, shown: 0 };
    return;
  }
  im.frames.forEach((f) => preload(f.src));
  if (im.credit) $('credit').textContent = `写真: ${im.credit.artist}（${im.credit.license}）`;
  if (photo.key !== q.number) {
    photo = { key: q.number, shown: 0, progress: 1, moving: null };
    img.style.transition = 'none';
    img.style.transform = 'none';
    img.removeAttribute('src');
  }
  if (im.shown === 0) return; // 問題が始まる前
  const cur = im.frames[im.shown - 1];
  if (state.phase === 'reveal') {
    // 正解発表: 全体をそのまま見せる
    photo = { ...photo, shown: im.shown, progress: 1, moving: null };
    if (img.getAttribute('src') !== cur.src) img.src = cur.src;
    img.style.transition = 'none';
    img.style.transform = 'none';
    return;
  }
  const running = state.phase === 'reading' || state.phase === 'waiting';
  if (im.shown !== photo.shown) {
    // 次の段階へ。正解発表や、途中から入ったときは、動かさずにそのまま見せる
    const prev = state.phase !== 'reveal' && im.shown === photo.shown + 1 ? im.frames[im.shown - 2] : null;
    photo.shown = im.shown;
    photo.moving = null;
    img.style.transition = 'none';
    img.src = cur.src;
    img.style.transform = prev ? viewOf(prev.rect, cur.rect) : 'none';
    photo.progress = prev ? 0 : 1;
    if (prev && running) {
      img.getBoundingClientRect(); // いまの見え方を確定させてから動かす
      moveTo(img, im.step);
    }
  } else if (running && !photo.moving && photo.progress < 1) {
    moveTo(img, im.step * (1 - photo.progress)); // お手つきのあと、続きから
  } else if (!running && photo.moving) {
    freeze(img); // 早押しされたら止める
  }
}

function renderResult() {
  $('again-ranked').hidden = !state.ranked;
  $('rating-change').hidden = !state.ranked;
  if (state.ranked) return renderRankedResult();
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const top = ranked[0].score;
  const winners = ranked.filter((p) => p.score === top);
  let text;
  if (ranked.length === 1) text = `${top}問正解！`;
  else if (top === 0) text = 'みんな0点…！';
  else if (winners.length > 1) text = '引き分け！';
  else text = `優勝は ${winners[0].name}！`;
  $('winner').textContent = text;
  renderPlayers($('ranking'), ranked, true);
  $('again').hidden = !isHost();
  $('result-wait').hidden = isHost();
}

// ランクマッチの結果: 順位とレートの変化。相手は通報・ブロックできる
function renderRankedResult() {
  $('again').hidden = true;
  $('result-wait').hidden = true;
  const results = state.ranked.results;
  if (!results) {
    $('winner').textContent = '結果を集計しています…';
    $('rating-change').textContent = '';
    $('ranking').textContent = '';
    return;
  }
  const mine = results.find((r) => r.id === state.you);
  const firsts = results.filter((r) => r.place === 1).length;
  if (state.ranked.mode === 'duel') $('winner').textContent = firsts > 1 ? '引き分け' : mine.place === 1 ? '勝ち！' : '負け…';
  else $('winner').textContent = mine.place === 1 && firsts === 1 ? '1位！' : `${mine.place}位`;
  const change = $('rating-change');
  change.textContent = '';
  if (mine.delta !== undefined) {
    change.append(`レート ${mine.before} → ${mine.after}（`, span(mine.delta >= 0 ? 'up' : 'down', `${mine.delta >= 0 ? '+' : ''}${mine.delta}`), '）');
    if (mine.titleAfter !== mine.titleBefore) change.append(document.createElement('br'), `${mine.titleBefore} → ${mine.titleAfter}${mine.delta > 0 ? ' ランクアップ！' : ' ランクダウン'}`);
    else change.append(`　${mine.titleAfter}`);
  }
  const list = $('ranking');
  list.textContent = '';
  for (const r of [...results].sort((a, b) => a.place - b.place)) {
    const p = state.players.find((x) => x.id === r.id);
    if (!p) continue;
    const li = document.createElement('li');
    li.append(`${r.place}位`, dot(p.color), p.name);
    const tags = [r.titleAfter ?? p.title];
    if (p.id === state.you) tags.push('あなた');
    if (p.left) tags.push('途中で退出');
    li.append(span('tag', tags.filter(Boolean).join('・')));
    if (r.delta !== undefined) li.append(span(r.delta >= 0 ? 'up' : 'down', `${r.delta >= 0 ? '+' : ''}${r.delta}`));
    li.append(span('pts', `${p.score}点`));
    if (p.id !== state.you && p.ladderId) {
      const actions = span('actions', '');
      actions.append(reportButton(p.ladderId, p.name), blockButton(p.ladderId, p.name));
      li.append(actions);
    }
    list.append(li);
  }
}

function dot(color) {
  const el = span('dot', '');
  el.style.setProperty('--c', color);
  return el;
}

function span(className, text) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

// 残り時間のバー
function drawTimer() {
  const rest = timerDuration ? Math.min(1, Math.max(0, (timerEnd - performance.now()) / timerDuration)) : 0;
  $('timer-bar').style.transform = `scaleX(${rest})`;
  requestAnimationFrame(drawTimer);
}

// ===== 効果音 =====

const sound = (() => {
  let ctx = null;

  // スマホは画面をさわるまで音を出せないので、最初のタッチで準備する
  function unlock() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!ctx && AudioContext) ctx = new AudioContext();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, start, duration, type = 'sine', volume = 0.2) {
    if (!ctx) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  return {
    unlock,
    buzz() { tone(988, 0, 0.12, 'square', 0.12); tone(1319, 0.1, 0.25, 'square', 0.12); },
    correct() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.3, 'triangle', 0.25)); },
    wrong() { tone(196, 0, 0.5, 'sawtooth', 0.12); tone(185, 0, 0.5, 'sawtooth', 0.12); },
    timeUp() { tone(440, 0, 0.2); tone(330, 0.2, 0.4); },
    finish() { [523, 659, 784, 659, 1047].forEach((f, i) => tone(f, i * 0.12, 0.35, 'triangle', 0.25)); },
    letter() { tone(1175, 0, 0.08, 'triangle', 0.2); },
  };
})();

function playEffects(prev, next) {
  // 文字入力で1文字正しく選べたとき
  const typedLength = (s) => {
    const input = s?.mine?.input ?? s?.question?.input;
    return input ? Array.from(input.typed).length : 0;
  };
  if (prev && prev.phase === 'answering' && next.phase === 'answering' && typedLength(next) > typedLength(prev)) sound.letter();
  // 4人対戦: 2人目・3人目が押したとき
  const slots = (s) => s?.question?.slots?.length ?? 0;
  if (prev && prev.phase === 'answering' && next.phase === 'answering' && slots(next) > slots(prev)) {
    sound.buzz();
    if (next.mine && !prev.mine && navigator.vibrate) navigator.vibrate(60);
  }
  if (prev && prev.phase === next.phase) return;
  if (next.phase === 'answering') {
    sound.buzz();
    if ((next.buzzer === next.you || next.mine) && navigator.vibrate) navigator.vibrate(60);
  }
  if (next.phase === 'feedback') sound.wrong();
  if (next.phase === 'reveal') {
    const mySlot = next.question?.slots?.find((s) => s.id === next.you);
    if (mySlot) mySlot.correct ? sound.correct() : sound.wrong();
    else next.winner ? sound.correct() : sound.timeUp();
  }
  if (next.phase === 'result') sound.finish();
}

// ===== 操作 =====

function enter(type) {
  const name = $('name').value.trim();
  const code = $('code').value.trim();
  if (!name) return ($('error').textContent = '名前を入れてね');
  if (type === 'join' && !/^\d{4}$/.test(code)) return ($('error').textContent = '4けたの部屋番号を入れてね');
  save('localStorage', 'name', name);
  $('error').textContent = '';
  if (type === 'create') connect('', { type: 'create', name });
  else connect(`?room=${code}`, { type: 'join', name });
}

function leaveRoom() {
  send({ type: 'leave' });
  setSession(null);
  state = null;
  goHome();
}

function goHome() {
  view = 'home';
  render();
  refreshRank();
}

// ===== ランクマッチ =====

function rankedId() {
  return load('localStorage', 'ranked');
}

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
  return res.json();
}

// はじめの画面に、自分の段級位とレートを出す
async function refreshRank() {
  const box = $('my-rank');
  const id = rankedId();
  if (!id) {
    box.textContent = 'ランクマッチで遊ぶと、段級位とレートがつきます';
    return;
  }
  try {
    const { player } = await api('/api/me', id);
    if (!player) {
      save('localStorage', 'ranked', null);
      box.textContent = 'ランクマッチで遊ぶと、段級位とレートがつきます';
      return;
    }
    box.textContent = `あなた: ${player.title}（レート ${player.rating}）　${player.games}戦${player.wins}勝${player.place ? `　${player.place}位` : ''}`;
  } catch {
    box.textContent = '';
  }
}

function startMatching(mode) {
  const name = $('name').value.trim();
  if (!name) return ($('error').textContent = '名前を入れてね');
  save('localStorage', 'name', name);
  $('error').textContent = '';
  lastRankedMode = mode;
  matching = { mode, since: Date.now(), count: 0 };
  view = 'matching';
  render();
  openLadder();
}

function openLadder() {
  const ws = new WebSocket(`${wsBase()}/ladder`);
  ladder = ws;
  ws.addEventListener('open', () => {
    const id = rankedId();
    ws.send(JSON.stringify({ type: 'queue', mode: matching.mode, name: load('localStorage', 'name') || $('name').value.trim(), id: id?.id, token: id?.token, blocks: load('localStorage', 'blocks') || [] }));
  });
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'registered') save('localStorage', 'ranked', { id: m.id, token: m.token });
    if (m.type === 'waiting' && matching) {
      matching.count = m.count;
      renderMatching();
    }
    if (m.type === 'matched') {
      closeLadder();
      matching = null;
      view = 'home';
      connect(`?match=${m.match}`, { type: 'ranked-join', ticket: m.ticket });
    }
    if (m.type === 'error') {
      stopMatching();
      $('error').textContent = m.message;
    }
  });
  ws.addEventListener('close', () => {
    if (ladder !== ws) return;
    ladder = null;
    // 相手さがしの途中で切れたら、つなぎなおす
    if (matching) setTimeout(() => { if (matching && !ladder) openLadder(); }, 2000);
  });
}

function closeLadder() {
  const ws = ladder;
  ladder = null;
  if (!ws) return;
  try {
    ws.send(JSON.stringify({ type: 'cancel' }));
  } catch {
    // つながる前ならそのまま閉じる
  }
  ws.close();
}

function stopMatching() {
  closeLadder();
  matching = null;
  goHome();
}

function renderMatching() {
  if (!matching) return;
  const seconds = Math.floor((Date.now() - matching.since) / 1000);
  $('matching-mode').textContent = `ランクマッチ・${RANKED_NAMES[matching.mode]}`;
  $('matching-info').textContent = `さがしている人: ${matching.count}人　${seconds}秒`;
  $('matching-rules').textContent = RANKED_RULES[matching.mode];
  $('matching-tip').hidden = seconds < 45;
}

// ランクマッチの結果から、もう一度さがす
function rankedAgain() {
  const mode = state?.ranked?.mode || lastRankedMode;
  send({ type: 'leave' });
  setSession(null);
  state = null;
  startMatching(mode);
}

async function openRanking() {
  view = 'leaderboard';
  render();
  const list = $('lb-list');
  list.textContent = '読みこみ中…';
  $('lb-me').textContent = '';
  const id = rankedId();
  try {
    const [ranking, mine] = await Promise.all([api('/api/ranking'), id ? api('/api/me', id) : { player: null }]);
    list.textContent = '';
    if (ranking.players.length === 0) list.append(`まだランキングに入っている人はいません（${ranking.minGames}戦以上で入ります）`);
    ranking.players.forEach((p, i) => {
      const li = document.createElement('li');
      li.append(span('place', `${i + 1}位`), p.name, span('tag', p.title), span('pts', String(p.rating)));
      if (id && p.id !== id.id) {
        const actions = span('actions', '');
        actions.append(reportButton(p.id, p.name));
        li.append(actions);
      }
      list.append(li);
    });
    const self = mine.player;
    $('lb-me').textContent = self
      ? `あなた: ${self.title}（レート ${self.rating}）${self.place ? `　${self.place}位` : `　あと${ranking.minGames - self.games}戦でランキングに入ります`}`
      : 'まだランクマッチで遊んでいません';
    $('lb-delete').hidden = !self;
  } catch {
    list.textContent = '読みこめませんでした';
  }
}

// ふさわしくない名前を通報する（3人以上から通報されると、その名前は使えなくなる）
function reportButton(target, name) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mini';
  button.textContent = '通報';
  button.addEventListener('click', async () => {
    const id = rankedId();
    if (!id || !confirm(`「${name}」を、ふさわしくない名前として通報しますか？`)) return;
    button.disabled = true;
    try {
      await api('/api/report', { ...id, target });
      button.textContent = '通報しました';
    } catch {
      button.disabled = false;
    }
  });
  return button;
}

// ブロックした人とは、ランクマッチで組み合わせにならない（この端末に保存）
function blockButton(target, name) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mini';
  const blocked = (load('localStorage', 'blocks') || []).includes(target);
  button.textContent = blocked ? 'ブロック中' : 'ブロック';
  button.disabled = blocked;
  button.addEventListener('click', () => {
    if (!confirm(`「${name}」をブロックしますか？ これからのランクマッチで同じ対戦になりません`)) return;
    const list = (load('localStorage', 'blocks') || []).filter((b) => b !== target);
    save('localStorage', 'blocks', [...list, target].slice(-200));
    button.textContent = 'ブロック中';
    button.disabled = true;
  });
  return button;
}

async function deleteRankedData() {
  const id = rankedId();
  if (!id || !confirm('ランクマッチの記録（レート・対戦数・ランキング）を消しますか？ 元にはもどせません')) return;
  try {
    await api('/api/delete', id);
  } catch {
    // 消せなかったときも、この端末の記録は消す
  }
  save('localStorage', 'ranked', null);
  openRanking();
}

function buzz() {
  if (!$('buzz').disabled) send({ type: 'buzz' });
}

$('create').addEventListener('click', () => enter('create'));
$('join').addEventListener('click', () => enter('join'));
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter('join'); });
$('start').addEventListener('click', () => send({ type: 'start' }));
$('again').addEventListener('click', () => send({ type: 'lobby' }));
$('leave-lobby').addEventListener('click', leaveRoom);
$('rank-duel').addEventListener('click', () => startMatching('duel'));
$('rank-four').addEventListener('click', () => startMatching('four'));
$('cancel-matching').addEventListener('click', stopMatching);
$('open-ranking').addEventListener('click', openRanking);
$('lb-back').addEventListener('click', goHome);
$('lb-delete').addEventListener('click', deleteRankedData);
$('again-ranked').addEventListener('click', rankedAgain);
$('leave-result').addEventListener('click', leaveRoom);
$('leave-game').addEventListener('click', () => {
  if (confirm('ゲームから抜けますか？')) leaveRoom();
});

// タッチした瞬間に反応させる（clickだと指を離すまで遅れる）
$('buzz').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  buzz();
});

// パソコン用: スペースで早押し、数字キーで選択肢
document.addEventListener('keydown', (e) => {
  if (e.repeat || !state || $('game').hidden) return;
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    buzz();
    return;
  }
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  const buttons = $('input').hidden ? $('choices').children : $('letters').children;
  const button = digit && buttons[digit[1] - 1];
  if (button && !button.disabled) button.click();
});

document.addEventListener('pointerdown', sound.unlock);
document.addEventListener('keydown', sound.unlock);

// 招待リンク（?room=1234）から開いたときは部屋番号を入れておく
$('name').value = load('localStorage', 'name') || '';
$('code').value = new URLSearchParams(location.search).get('room') || '';

render();
refreshRank();
reconnect(); // ページを開き直したときは、さっきまでいた部屋に戻る
drawTimer();

// 20秒ごとに「まだいるよ」を送る（サーバーは1分届かないと切断とみなす）
setInterval(() => {
  send({ type: 'ping' });
  if (ladder && ladder.readyState === WebSocket.OPEN) ladder.send(JSON.stringify({ type: 'ping' }));
}, 20000);

// 相手さがしの待ち時間の表示を1秒ごとに進める
setInterval(() => { if (!state && view === 'matching') renderMatching(); }, 1000);

// アプリとしてホーム画面に追加できるようにする（オフライン時の案内ページも用意される）
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
