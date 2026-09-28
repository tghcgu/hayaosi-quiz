'use strict';
// スマホ側。サーバーから届く「部屋の今の様子(state)」を画面に描き、押したボタンをサーバーに送るだけ

const $ = (id) => document.getElementById(id);
const SCREENS = ['home', 'lobby', 'game', 'result'];

let socket = null;
let state = null;
let session = load('sessionStorage', 'session');
let timerEnd = 0;
let timerDuration = 0;

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

function connect(query, firstMessage) {
  if (socket) socket.close();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws${query}`);
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
  if (session && !socket) connect(`?room=${session.room}`, { type: 'rejoin', id: session.id, token: session.token });
}

function send(msg) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(msg));
  return true;
}

function onMessage(msg) {
  switch (msg.type) {
    case 'joined':
      setSession({ room: msg.room, id: msg.id, token: msg.token });
      break;
    case 'expired':
      setSession(null);
      state = null;
      render();
      break;
    case 'error':
      $('error').textContent = msg.message;
      break;
    case 'closed':
      setSession(null);
      state = null;
      render();
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
  let screen = 'home';
  if (state) screen = state.phase === 'lobby' || state.phase === 'result' ? state.phase : 'game';
  document.body.dataset.phase = state ? state.phase : '';
  for (const id of SCREENS) $(id).hidden = id !== screen;
  if (screen === 'lobby') renderLobby();
  if (screen === 'game') renderGame();
  if (screen === 'result') renderResult();
}

function renderLobby() {
  const host = isHost();
  $('lobby-code').textContent = state.code;
  $('invite').textContent = `${location.origin}/?room=${state.code}`;
  renderPlayers($('lobby-players'), state.players);

  $('host-controls').hidden = !host;
  $('lobby-wait').hidden = host;
  $('lobby-wait').textContent = `問題数: ${countLabel(state.questionCount)}　ホストがスタートするのを待っています…`;

  const counts = $('counts');
  counts.textContent = '';
  for (const n of state.questionCounts) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = countLabel(n);
    button.classList.toggle('on', n === state.questionCount);
    button.addEventListener('click', () => send({ type: 'settings', questionCount: n }));
    counts.append(button);
  }
}

function countLabel(n) {
  return n ? `${n}問` : `全問(${state.totalQuestions})`;
}

function renderPlayers(list, players, withScore = false) {
  list.textContent = '';
  for (const p of players) {
    const li = document.createElement('li');
    const tags = [];
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

function renderGame() {
  const q = state.question;
  const mine = me();
  const myTurn = state.phase === 'answering' && state.buzzer === state.you;

  $('q-number').textContent = `${q.number}/${q.total}問`;

  const scores = $('scores');
  scores.textContent = '';
  for (const p of state.players) {
    const item = span('score', '');
    item.classList.toggle('me', p.id === state.you);
    item.classList.toggle('locked', p.locked);
    item.classList.toggle('offline', !p.online);
    item.append(dot(p.color), `${p.name} ${p.score}`);
    scores.append(item);
  }

  const text = $('q-text');
  text.textContent = q.text;
  if (q.rest) text.append(span('rest', q.rest));

  let status = state.message;
  if (state.phase === 'ready') status = `第${q.number}問`;
  if (myTurn) status = 'あなたが早押し！ 答えをえらんで';
  $('status').textContent = status;

  const choices = $('choices');
  choices.textContent = '';
  (q.choices || []).forEach((c, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = `${i + 1}. ${c.text}`;
    button.classList.toggle('out', c.out);
    button.classList.toggle('correct', c.correct);
    button.disabled = !myTurn || c.out;
    button.addEventListener('click', () => send({ type: 'answer', choice: i }));
    choices.append(button);
  });

  const buzz = $('buzz');
  buzz.style.setProperty('--c', mine.color);
  buzz.disabled = !(state.phase === 'reading' || state.phase === 'waiting') || mine.locked;
  buzz.textContent = mine.locked ? 'お手つき' : '早押し！';

  if (state.timer) {
    timerEnd = performance.now() + state.timer.remaining;
    timerDuration = state.timer.duration;
  } else {
    timerDuration = 0;
  }
}

function renderResult() {
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
  };
})();

function playEffects(prev, next) {
  if (prev && prev.phase === next.phase) return;
  if (next.phase === 'answering') {
    sound.buzz();
    if (next.buzzer === next.you && navigator.vibrate) navigator.vibrate(60);
  }
  if (next.phase === 'feedback') sound.wrong();
  if (next.phase === 'reveal') next.winner ? sound.correct() : sound.timeUp();
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
  render();
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
  const button = digit && $('choices').children[digit[1] - 1];
  if (button && !button.disabled) button.click();
});

document.addEventListener('pointerdown', sound.unlock);
document.addEventListener('keydown', sound.unlock);

// 招待リンク（?room=1234）から開いたときは部屋番号を入れておく
$('name').value = load('localStorage', 'name') || '';
$('code').value = new URLSearchParams(location.search).get('room') || '';

render();
reconnect(); // ページを開き直したときは、さっきまでいた部屋に戻る
drawTimer();

// 20秒ごとに「まだいるよ」を送る（サーバーは1分届かないと切断とみなす）
setInterval(() => send({ type: 'ping' }), 20000);
