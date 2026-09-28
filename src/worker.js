// 早押しクイズロワイヤル - 対戦サーバー（Cloudflare Workers + Durable Objects）
// 手元で試す: npm run dev / 公開する: npm run deploy

import { DurableObject } from 'cloudflare:workers';
import QUESTIONS from '../questions.js';

// ===== ゲームの設定 =====
const MAX_PLAYERS = 8;
const CHAR_INTERVAL = 130;   // 問題文を1文字出す間隔(ミリ秒)
const READY_TIME = 1500;     // 問題が始まるまでの間
const ANSWER_TIME = 8000;    // 押してから答えるまでの制限時間
const WAIT_TIME = 5000;      // 問題文が出きってから押せる時間
const FEEDBACK_TIME = 1200;  // 不正解のあと問題文を再開するまでの間
const REVEAL_TIME = 4000;    // 正解を見せてから次の問題に進むまでの間
const QUESTION_COUNTS = [5, 10, 0]; // 選べる問題数（0は全問）
const IDLE_CLOSE_TIME = 30 * 60 * 1000; // 待合室・結果画面でだれも操作しなかったら部屋を閉じるまでの時間
const SILENT_TIMEOUT = 60 * 1000;       // スマホから何も届かなくなったら切断とみなすまでの時間

const PLAYER_COLORS = ['#e5484d', '#1f6fd1', '#1f8a3e', '#c26a00', '#8e4ec6', '#0f8f8f', '#d6409f', '#6b665c'];

// ===== 入口: /ws への接続を、部屋番号ごとの Durable Object に振り分ける =====

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') return new Response('見つかりません', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocketで接続してください', { status: 426 });

    const room = url.searchParams.get('room');
    if (room !== null) {
      if (!/^\d{4}$/.test(room)) return new Response('部屋番号がおかしいです', { status: 400 });
      return roomStub(env, room).fetch(roomRequest(request, room, false));
    }

    // 部屋をつくる: 使われていない番号が見つかるまで試す
    for (let i = 0; i < 20; i++) {
      const code = String(1000 + randomInt(9000));
      const response = await roomStub(env, code).fetch(roomRequest(request, code, true));
      if (response.status !== 409) return response;
    }
    return new Response('部屋がいっぱいです', { status: 503 });
  },
};

function roomStub(env, code) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

function roomRequest(request, code, create) {
  const url = new URL(request.url);
  url.searchParams.set('code', code);
  url.searchParams.set('create', create ? '1' : '0');
  return new Request(url, request);
}

// ===== 部屋（1つの部屋 = 1つの Durable Object） =====

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.code = null;
    this.sockets = new Set();
    this.reservedAt = 0;   // 「部屋をつくる」接続を受け付けた時刻（番号の取り合いを防ぐ）
    this.lastActivity = Date.now();
    this.sweepTimer = null;
    this.reset();
  }

  reset() {
    this.clearTimers();
    this.hostId = null;
    this.players = [];
    this.questionCount = 10;
    this.phase = 'lobby'; // lobby → ready → reading ⇄ answering → feedback … → reveal → … → result
    this.message = '';
    this.questions = [];
    this.index = 0;
    this.chars = [];
    this.shown = 0;
    this.choices = [];
    this.choicesVisible = false;
    this.buzzer = null;
    this.winner = null;
    this.timer = null;
    this.textTimer = null;
    this.timeout = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.code = url.searchParams.get('code');
    const create = url.searchParams.get('create') === '1';
    if (create) {
      if (this.players.length > 0 || Date.now() - this.reservedAt < 10000) return new Response('使用中', { status: 409 });
      this.reservedAt = Date.now();
    }

    const [client, ws] = Object.values(new WebSocketPair());
    ws.accept();
    const socket = { ws, player: null, create, lastSeen: Date.now() };
    this.sockets.add(socket);
    ws.addEventListener('message', (e) => this.onMessage(socket, e.data));
    ws.addEventListener('close', () => this.disconnect(socket));
    ws.addEventListener('error', () => this.disconnect(socket));
    this.startSweep();
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(socket, raw) {
    socket.lastSeen = Date.now();
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || msg.type === 'ping') return;
    this.lastActivity = Date.now();
    try {
      this.handle(socket, msg);
    } catch (err) {
      console.error(err); // 1つの不具合で部屋全体が止まらないように
    }
  }

  handle(socket, msg) {
    switch (msg.type) {
      case 'create': return this.create(socket, msg.name);
      case 'join': return this.join(socket, msg.name);
      case 'rejoin': return this.rejoin(socket, msg.id, msg.token);
    }

    const player = socket.player;
    if (!player) return;
    const isHost = this.hostId === player.id;

    switch (msg.type) {
      case 'settings':
        if (isHost && this.phase === 'lobby' && QUESTION_COUNTS.includes(msg.questionCount)) {
          this.questionCount = msg.questionCount;
          this.broadcast();
        }
        break;
      case 'start':
        if (isHost && this.phase === 'lobby') this.startGame();
        break;
      case 'buzz':
        this.buzz(player);
        break;
      case 'answer':
        this.answer(player, msg.choice);
        break;
      case 'lobby':
        if (isHost && this.phase === 'result') this.backToLobby();
        break;
      case 'leave':
        this.leave(socket, true);
        socket.ws.close(1000, 'leave');
        break;
    }
  }

  // ===== 入室・退室 =====

  create(socket, name) {
    if (!socket.create || socket.player) return;
    if (this.players.length > 0) return this.refuse(socket, 'error', '部屋をつくれませんでした。もう一度ためしてね');
    this.reset();
    const player = this.addPlayer(socket, name);
    this.hostId = player.id;
    this.broadcast();
  }

  join(socket, name) {
    if (socket.player) return;
    if (this.players.length === 0) return this.refuse(socket, 'error', 'その番号の部屋は見つかりませんでした');
    if (this.phase !== 'lobby') return this.refuse(socket, 'error', 'この部屋はゲーム中です。終わるまで待ってね');
    if (this.players.length >= MAX_PLAYERS) return this.refuse(socket, 'error', `この部屋は満員です（${MAX_PLAYERS}人まで）`);
    this.addPlayer(socket, name);
    this.broadcast();
  }

  // 通信が切れたスマホが戻ってきたとき、同じプレイヤーとして復帰させる
  rejoin(socket, id, token) {
    if (socket.player) return;
    const player = this.players.find((p) => p.id === id && p.token === token);
    if (!player) return this.refuse(socket, 'expired');
    if (player.socket && player.socket !== socket) {
      const old = player.socket;
      old.player = null;
      old.ws.close(1000, 'replaced');
    }
    this.attach(player, socket);
    this.broadcast();
  }

  refuse(socket, type, message) {
    send(socket, { type, message });
    socket.ws.close(1000, type);
  }

  addPlayer(socket, name) {
    const used = new Set(this.players.map((p) => p.color));
    const player = {
      id: randomHex(4),
      token: randomHex(16),
      name: cleanName(name),
      color: PLAYER_COLORS.find((c) => !used.has(c)),
      score: 0,
      locked: false,
      socket: null,
    };
    this.players.push(player);
    this.attach(player, socket);
    return player;
  }

  attach(player, socket) {
    player.socket = socket;
    socket.player = player;
    send(socket, { type: 'joined', room: this.code, id: player.id, token: player.token });
  }

  disconnect(socket) {
    if (!this.sockets.delete(socket)) return;
    this.leave(socket, false);
    if (this.sockets.size === 0) this.stopSweep();
  }

  // intentional: 自分で「部屋を出る」を押したとき。false は通信が切れただけ（あとで戻れる）
  leave(socket, intentional) {
    const player = socket.player;
    if (!player) return;
    socket.player = null;
    if (player.socket === socket) player.socket = null;

    // 名簿から消すのはロビーで自分から出たときだけ。それ以外は「オフライン」として残し、戻ってこられるようにする
    if (intentional && this.phase === 'lobby') this.players = this.players.filter((p) => p !== player);
    if (this.players.length === 0) return this.reset();

    if (this.hostId === player.id) {
      const next = this.players.find((p) => p.socket) || this.players[0];
      this.hostId = next.id;
    }
    if ((this.phase === 'reading' || this.phase === 'waiting') && this.allLocked()) {
      this.revealAnswer(null, '全員お手つき！');
      return;
    }
    this.broadcast();
  }

  // 30秒ごとに、黙って切れた接続と、放置された部屋を片付ける
  startSweep() {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const socket of this.sockets) {
        if (now - socket.lastSeen > SILENT_TIMEOUT) {
          socket.ws.close(1000, 'timeout');
          this.disconnect(socket);
        }
      }
      const idle = this.phase === 'lobby' || this.phase === 'result';
      if (idle && now - this.lastActivity > IDLE_CLOSE_TIME) {
        for (const socket of [...this.sockets]) {
          send(socket, { type: 'closed', message: 'しばらく操作がなかったので、部屋を閉じました' });
          socket.ws.close(1000, 'idle');
          this.sockets.delete(socket);
        }
        this.reset();
        this.stopSweep();
      }
    }, 30000);
  }

  stopSweep() {
    clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  // ===== ゲームの進行 =====

  startGame() {
    if (QUESTIONS.length === 0) return;
    this.questions = shuffle(QUESTIONS).slice(0, this.questionCount || QUESTIONS.length);
    this.index = 0;
    for (const p of this.players) p.score = 0;
    this.startQuestion();
  }

  startQuestion() {
    this.clearTimers();
    this.lastActivity = Date.now();
    const q = this.questions[this.index];
    this.chars = Array.from(q.q);
    this.shown = 0;
    this.choices = shuffle([
      { text: q.answer, correct: true },
      ...q.wrong.map((text) => ({ text, correct: false })),
    ]).map((c) => ({ ...c, out: false }));
    this.choicesVisible = false;
    this.buzzer = null;
    this.winner = null;
    for (const p of this.players) p.locked = false;
    this.setPhase('ready', '');
    this.timeout = setTimeout(() => this.resumeReading(), READY_TIME);
    this.broadcast();
  }

  resumeReading() {
    this.clearTimers();
    this.buzzer = null;
    if (this.shown >= this.chars.length) return this.startWaiting();
    this.setPhase('reading', 'わかったら早押し！');
    this.textTimer = setInterval(() => {
      this.shown++;
      if (this.shown >= this.chars.length) {
        this.startWaiting();
        return;
      }
      this.broadcast();
    }, CHAR_INTERVAL);
    this.broadcast();
  }

  startWaiting() {
    this.clearTimers();
    this.setPhase('waiting', '問題文はここまで。わかったら早押し！');
    this.startTimer(WAIT_TIME, () => this.revealAnswer(null, '時間切れ！'));
    this.broadcast();
  }

  buzz(player) {
    if (this.phase !== 'reading' && this.phase !== 'waiting') return;
    if (player.locked) return;
    this.clearTimers();
    this.buzzer = player.id;
    this.choicesVisible = true;
    this.setPhase('answering', `${player.name} が早押し！`);
    this.startTimer(ANSWER_TIME, () => this.judge(player, -1));
    this.broadcast();
  }

  answer(player, index) {
    if (this.phase !== 'answering' || this.buzzer !== player.id) return;
    if (!Number.isInteger(index)) return;
    const choice = this.choices[index];
    if (!choice || choice.out) return;
    this.judge(player, index);
  }

  judge(player, index) {
    this.clearTimers();
    const choice = this.choices[index];
    if (choice && choice.correct) {
      player.score++;
      this.revealAnswer(player, `正解！ ${player.name} に1ポイント`);
      return;
    }
    player.locked = true;
    if (choice) choice.out = true;
    this.setPhase('feedback', choice ? `ざんねん！ ${player.name} はお手つき` : `時間切れ！ ${player.name} はお手つき`);
    this.timeout = setTimeout(() => {
      if (this.allLocked()) this.revealAnswer(null, '全員お手つき！');
      else this.resumeReading();
    }, FEEDBACK_TIME);
    this.broadcast();
  }

  revealAnswer(winner, message) {
    this.clearTimers();
    const q = this.questions[this.index];
    this.choicesVisible = true;
    this.winner = winner ? winner.id : null;
    this.setPhase('reveal', winner ? message : `${message} 正解は「${q.answer}」`);
    const last = this.index >= this.questions.length - 1;
    this.startTimer(REVEAL_TIME, () => {
      if (last) {
        this.lastActivity = Date.now();
        this.setPhase('result', '');
        this.broadcast();
      } else {
        this.index++;
        this.startQuestion();
      }
    });
    this.broadcast();
  }

  backToLobby() {
    this.clearTimers();
    this.players = this.players.filter((p) => p.socket);
    for (const p of this.players) {
      p.score = 0;
      p.locked = false;
    }
    this.setPhase('lobby', '');
    this.broadcast();
  }

  // 接続中のプレイヤーが全員お手つきになったか
  allLocked() {
    const online = this.players.filter((p) => p.socket);
    return online.length > 0 && online.every((p) => p.locked);
  }

  setPhase(phase, message) {
    this.phase = phase;
    this.message = message;
  }

  startTimer(ms, onEnd) {
    this.timer = { duration: ms, endsAt: Date.now() + ms };
    this.timeout = setTimeout(() => {
      this.timer = null;
      onEnd();
    }, ms);
  }

  clearTimers() {
    clearInterval(this.textTimer);
    clearTimeout(this.timeout);
    this.textTimer = null;
    this.timeout = null;
    this.timer = null;
  }

  // ===== 送信 =====

  // 部屋の今の様子。全員に同じものを送り、スマホ側はこれを画面に描くだけ
  snapshot() {
    const inQuestion = this.phase !== 'lobby' && this.phase !== 'result';
    const reveal = this.phase === 'reveal';
    return {
      type: 'state',
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      message: this.message,
      questionCount: this.questionCount,
      questionCounts: QUESTION_COUNTS,
      totalQuestions: QUESTIONS.length,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        score: p.score,
        locked: p.locked,
        online: Boolean(p.socket),
      })),
      question: inQuestion ? {
        number: this.index + 1,
        total: this.questions.length,
        text: this.chars.slice(0, this.shown).join(''),
        rest: reveal ? this.chars.slice(this.shown).join('') : '',
        choices: this.choicesVisible
          ? this.choices.map((c) => ({ text: c.text, out: c.out, correct: reveal && c.correct }))
          : null,
      } : null,
      buzzer: this.buzzer,
      winner: this.winner,
      timer: this.timer ? { duration: this.timer.duration, remaining: Math.max(0, this.timer.endsAt - Date.now()) } : null,
    };
  }

  broadcast() {
    const state = this.snapshot();
    for (const p of this.players) {
      if (p.socket) send(p.socket, { ...state, you: p.id });
    }
  }
}

// ===== 小道具 =====

function send(socket, data) {
  try {
    socket.ws.send(JSON.stringify(data));
  } catch {
    // すでに切れている接続には送れない
  }
}

function cleanName(name) {
  const text = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return Array.from(text).slice(0, 10).join('') || 'ななし';
}

function randomInt(n) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % n;
}

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
