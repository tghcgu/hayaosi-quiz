// 部屋（1つの部屋 = 1つの Durable Object）。早押しの判定はすべてここで行う
// 友だちと遊ぶ部屋（部屋番号で入る）と、ランクマッチの部屋（2人対戦・4人対戦）がある

import { DurableObject } from 'cloudflare:workers';
import QUESTIONS from './questions.generated.json';
import IMAGES from './images.generated.json';
import { isInputQuestion, letterChoices } from './kana.js';
import { cleanName } from './names.js';
import { send, randomHex, shuffle } from './util.js';

// ===== ゲームの設定 =====
const MAX_PLAYERS = 8;
const CHAR_INTERVAL = 130;   // 問題文を1文字出す間隔(ミリ秒)
const READY_TIME = 1500;     // 問題が始まるまでの間
const ANSWER_TIME = 8000;    // 押してから答えるまでの制限時間
const WAIT_TIME = 5000;      // 問題文が出きってから押せる時間
const FEEDBACK_TIME = 1200;  // 不正解のあと問題文を再開するまでの間
const REVEAL_TIME = 4000;    // 正解を見せてから次の問題に進むまでの間
const LETTER_TIME = 6000;    // 文字入力で1文字選ぶまでの制限時間
const QUESTION_COUNTS = [5, 10, 20]; // 選べる問題数
const ANSWER_MODES = ['mix', 'choice', 'input']; // 答え方: ミックス / 選択肢 / 文字入力
const MIX_INPUT_RATE = 0.3;  // ミックスのとき、文字入力で出す問題の割合
const IMAGE_STEP = 1500;     // 画像クイズで、次の段階まで引いていく間隔(ミリ秒)
const QUESTION_KINDS = ['mix', 'text', 'image']; // 出題: まぜる / 文章 / 画像
const IMAGE_MIX_RATE = 0.2;  // まぜるとき、画像クイズを出す割合
const IDLE_CLOSE_TIME = 30 * 60 * 1000; // 待合室・結果画面でだれも操作しなかったら部屋を閉じるまでの時間
const SILENT_TIMEOUT = 60 * 1000;       // スマホから何も届かなくなったら切断とみなすまでの時間

// ===== ランクマッチのきまり =====
// lives: ライフ（まちがえると1つ減り、0になると脱落） target: 先にこの点数を取った人の勝ち
// slots: 1問で答えられる人数 points: 正解したときの点数（早く押した順）
const RULES = {
  custom: { lives: null, target: null, slots: 1, points: [1] },
  duel: { lives: 3, target: 5, questions: 15, slots: 1, points: [1] },     // 2人対戦: 先に5問正解で勝ち。ライフがなくなると負け
  four: { lives: 3, target: null, questions: 10, slots: 3, points: [3, 2, 1] }, // 4人対戦: 3人まで答えられ、早く押した順に3・2・1点
};
const BUZZ_WINDOW = 3000;                // 4人対戦: 最初の早押しのあと、ほかの人も押せる時間
const RANKED_JOIN_TIME = 15000;          // ランクマッチ: 全員が部屋に入るのを待つ時間
const RANKED_START_DELAY = 3000;         // 全員そろってから始まるまでの間
const RANKED_CLOSE_TIME = 3 * 60 * 1000; // 結果を見せたあと、部屋を閉じるまでの時間

// ジャンルの一覧（問題ファイルにならんでいる順）
export const GENRES = [...new Set(QUESTIONS.map((q) => q.genre))];

const PLAYER_COLORS = ['#e5484d', '#1f6fd1', '#1f8a3e', '#c26a00', '#8e4ec6', '#0f8f8f', '#d6409f', '#6b665c'];

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
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
    this.answerMode = 'mix';
    this.questionKind = 'mix';
    this.genres = []; // 遊ぶジャンル（空ならすべて）
    this.ranked = null;          // ランクマッチのときだけ { matchId, mode, expected, results }
    this.rules = RULES.custom;
    this.phase = 'lobby'; // lobby → ready → reading ⇄ answering → feedback … → reveal → … → result
    this.message = '';
    this.questions = [];
    this.index = 0;
    this.chars = [];
    this.frames = null;       // 画像クイズの段階ごとの画像（文章の問題では null）
    this.shown = 0;           // 出した文字の数（画像クイズでは、見せた段階の数）
    this.choices = [];
    this.choicesVisible = false;
    this.mode = 'choice';     // この問題の答え方（choice / input）
    this.answerChars = [];    // 文字入力の正解を1文字ずつにしたもの
    this.typed = 0;           // 文字入力で、正しく選べた文字の数
    this.letters = null;      // 文字入力で、いま出している4つの文字
    this.slots = [];          // 4人対戦: 早押しした人（押した順）
    this.windowOpen = false;  // 4人対戦: まだほかの人も押せるか
    this.buzzer = null;
    this.winner = null;
    this.timer = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.searchParams.has('code')) this.code = url.searchParams.get('code');
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
      case 'ranked-join': return this.rankedJoin(socket, msg.ticket);
    }

    const player = socket.player;
    if (!player) return;
    const isHost = !this.ranked && this.hostId === player.id;
    const multi = this.rules.slots > 1;

    switch (msg.type) {
      case 'settings':
        if (isHost && this.phase === 'lobby') {
          if (QUESTION_COUNTS.includes(msg.questionCount)) this.questionCount = msg.questionCount;
          if (ANSWER_MODES.includes(msg.answerMode)) this.answerMode = msg.answerMode;
          if (QUESTION_KINDS.includes(msg.questionKind)) this.questionKind = msg.questionKind;
          if (Array.isArray(msg.genres)) this.genres = GENRES.filter((g) => msg.genres.includes(g));
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
        if (multi) this.answerMulti(player, msg.choice);
        else this.answer(player, msg.choice);
        break;
      case 'letter':
        if (multi) this.letterMulti(player, msg.index, msg.pos);
        else this.pickLetter(player, msg.index, msg.pos);
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
    if (this.ranked) return this.refuse(socket, 'error', 'この部屋には入れません');
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
    this.rebind(player, socket);
    this.broadcast();
  }

  rebind(player, socket) {
    if (player.socket && player.socket !== socket) {
      const old = player.socket;
      old.player = null;
      old.ws.close(1000, 'replaced');
    }
    this.attach(player, socket);
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
      lives: null,   // ランクマッチのライフ（友だちの部屋では null）
      out: false,    // ライフがなくなって脱落した
      left: false,   // ランクマッチの途中で自分から抜けた
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
    const where = this.ranked ? { match: this.ranked.matchId } : { room: this.code };
    send(socket, { type: 'joined', ...where, id: player.id, token: player.token });
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

    const playing = this.phase !== 'lobby' && this.phase !== 'result';
    // ランクマッチの途中で抜けたら、その対戦は最下位あつかい
    if (this.ranked && intentional && playing) {
      player.left = true;
      player.locked = true;
    }
    // 名簿から消すのはロビーで自分から出たときだけ。それ以外は「オフライン」として残し、戻ってこられるようにする
    if (intentional && this.phase === 'lobby') this.players = this.players.filter((p) => p !== player);
    if (this.players.length === 0) {
      this.reset();
      return;
    }

    if (this.hostId === player.id) {
      const next = this.players.find((p) => p.socket) || this.players[0];
      this.hostId = next.id;
    }
    if (this.ranked && playing && this.decided()) return this.finish();
    if ((this.phase === 'reading' || this.phase === 'waiting') && this.allLocked()) {
      this.revealAnswer(null, '全員お手つき！');
      return;
    }
    if (this.phase === 'answering' && this.rules.slots > 1) this.checkSlots();
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
      if (idle && !this.ranked && now - this.lastActivity > IDLE_CLOSE_TIME) this.close('しばらく操作がなかったので、部屋を閉じました');
    }, 30000);
  }

  stopSweep() {
    clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  // 部屋を閉じて、全員をはじめの画面にもどす
  close(message) {
    for (const socket of [...this.sockets]) {
      send(socket, { type: 'closed', message });
      socket.ws.close(1000, 'closed');
      this.sockets.delete(socket);
    }
    this.reset();
    this.stopSweep();
  }

  // ===== ランクマッチ =====

  // 対戦の組み合わせが決まったら、受付（Ladder）が呼ぶ。players: [{ ticket, ladderId, name, rating, title }]
  setupRanked({ matchId, mode, players }) {
    if (this.players.length > 0 || this.ranked || !RULES[mode]) return false;
    this.reset();
    this.ranked = { matchId, mode, expected: players, results: null, reported: false };
    this.rules = RULES[mode];
    this.questionCount = this.rules.questions;
    this.lastActivity = Date.now();
    this.message = '対戦相手を待っています…';
    this.timeout = setTimeout(() => this.startRanked(), RANKED_JOIN_TIME);
    this.startSweep();
    return true;
  }

  rankedJoin(socket, ticket) {
    if (socket.player) return;
    const info = this.ranked?.expected.find((p) => p.ticket === ticket);
    if (!info) return this.refuse(socket, 'closed', 'この対戦は終わっているか、入れません');
    const existing = this.players.find((p) => p.ladderId === info.ladderId);
    if (existing) {
      this.rebind(existing, socket);
      this.broadcast();
      return;
    }
    if (this.phase !== 'lobby') return this.refuse(socket, 'closed', 'この対戦はもう始まっています');
    const player = this.addPlayer(socket, info.name);
    Object.assign(player, { ladderId: info.ladderId, rating: info.rating, title: info.title });
    if (this.players.length === this.ranked.expected.length) {
      // 全員そろった
      clearTimeout(this.timeout);
      this.message = 'まもなく始まります';
      this.timer = { duration: RANKED_START_DELAY, endsAt: Date.now() + RANKED_START_DELAY };
      this.timeout = setTimeout(() => this.startRanked(), RANKED_START_DELAY);
    }
    this.broadcast();
  }

  startRanked() {
    this.timeout = null;
    this.timer = null;
    if (!this.ranked || this.phase !== 'lobby') return;
    if (this.players.filter((p) => p.socket).length < 2) return this.close('相手がそろわなかったので、対戦を中止しました（レートは変わりません）');
    this.startGame();
  }

  // ランクマッチで、もう勝負がついたか
  decided() {
    if (!this.ranked) return false;
    const alive = this.players.filter((p) => !p.out && !p.left);
    if (alive.length <= 1) return true;
    return this.rules.target !== null && this.players.some((p) => p.score >= this.rules.target);
  }

  // 順位。抜けた人は最下位、2人対戦ではライフがなくなった人が負け、あとは点数・残りライフの順。同じ成績なら同じ順位
  standings() {
    const duel = this.ranked?.mode === 'duel';
    const key = (p) => [p.left ? 1 : 0, duel && p.out ? 1 : 0, -p.score, -(p.lives ?? 0)];
    const cmp = (a, b) => {
      const ka = key(a), kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return 0;
    };
    const sorted = [...this.players].sort(cmp);
    return sorted.map((p) => ({ player: p, place: 1 + sorted.filter((o) => cmp(o, p) < 0).length }));
  }

  async reportRanked() {
    if (this.ranked.reported) return;
    this.ranked.reported = true;
    const standings = this.standings();
    let changes = null;
    try {
      const ladder = this.env.LADDER.get(this.env.LADDER.idFromName('main'));
      changes = await ladder.reportResult(this.ranked.matchId, standings.map((s) => ({ ladderId: s.player.ladderId, place: s.place })));
    } catch (err) {
      console.error(err);
    }
    if (!this.ranked) return; // 待っているあいだに部屋が閉じた
    this.ranked.results = standings.map((s) => {
      const change = changes?.find((c) => c.id === s.player.ladderId);
      return { id: s.player.id, place: s.place, ...(change ? { before: change.before, after: change.after, delta: change.delta, titleBefore: change.titleBefore, titleAfter: change.titleAfter } : {}) };
    });
    this.broadcast();
    this.timeout = setTimeout(() => this.close('対戦は終わりました'), RANKED_CLOSE_TIME);
  }

  // ===== ゲームの進行 =====

  startGame() {
    const count = this.questionCount;
    // ランクマッチは、ジャンル・出題・答え方を選べない（すべてのジャンル・まぜる・ミックス）
    const kind = this.ranked ? 'mix' : this.questionKind;
    const answerMode = this.ranked ? 'mix' : this.answerMode;
    const genres = this.ranked ? [] : this.genres;
    const inGenre = (q) => genres.length === 0 || genres.includes(q.genre);
    const texts = QUESTIONS.filter(inGenre);
    const images = IMAGES.filter(inGenre);
    const wantImages = kind === 'image' ? count : kind === 'mix' ? Math.round(count * IMAGE_MIX_RATE) : 0;
    // 選んだジャンルに画像クイズが足りないときは、文章の問題でうめる
    const imageCount = Math.min(wantImages, images.length);
    const inputCount = answerMode === 'input' ? count : answerMode === 'mix' ? Math.round(count * MIX_INPUT_RATE) : 0;
    const imageInputs = answerMode === 'input' ? imageCount : Math.round(imageCount * inputCount / count);
    this.questions = shuffle([
      ...pickQuestions(images, imageCount, imageInputs),
      ...pickQuestions(texts, count - imageCount, inputCount - imageInputs),
    ]);
    if (this.questions.length === 0) return;
    this.index = 0;
    for (const p of this.players) {
      p.score = 0;
      p.lives = this.rules.lives;
      p.out = false;
      p.left = false;
    }
    this.startQuestion();
  }

  startQuestion() {
    this.clearTimers();
    this.lastActivity = Date.now();
    const q = this.questions[this.index];
    this.chars = Array.from(q.q);
    this.frames = q.image ? q.image.frames : null;
    this.shown = 0;
    this.choices = shuffle([
      { text: q.answer, correct: true },
      ...q.wrong.map((text) => ({ text, correct: false })),
    ]).map((c) => ({ ...c, out: false }));
    this.choicesVisible = false;
    this.mode = q.mode;
    this.answerChars = Array.from(q.answer);
    this.typed = 0;
    this.letters = null;
    this.slots = [];
    this.windowOpen = false;
    this.buzzer = null;
    this.winner = null;
    for (const p of this.players) p.locked = p.out || p.left;
    this.setPhase('ready', '');
    this.timeout = setTimeout(() => this.resumeReading(), READY_TIME);
    this.broadcast();
  }

  resumeReading() {
    this.clearTimers();
    this.buzzer = null;
    this.typed = 0;
    this.letters = null;
    // 文章の問題は1文字ずつ、画像クイズは1段階ずつ見せていく
    const total = this.frames ? this.frames.length : this.chars.length;
    if (this.frames && this.shown === 0) this.shown = 1; // 画像は、いちばん拡大したものをすぐに見せる
    if (this.shown >= total) return this.startWaiting();
    this.setPhase('reading', 'わかったら早押し！');
    this.textTimer = setInterval(() => {
      this.shown++;
      if (this.shown >= total) {
        this.startWaiting();
        return;
      }
      this.broadcast();
    }, this.frames ? IMAGE_STEP : CHAR_INTERVAL);
    this.broadcast();
  }

  startWaiting() {
    this.clearTimers();
    this.setPhase('waiting', this.frames ? 'これで全体です。わかったら早押し！' : '問題文はここまで。わかったら早押し！');
    this.startTimer(WAIT_TIME, () => this.revealAnswer(null, '時間切れ！'));
    this.broadcast();
  }

  buzz(player) {
    if (player.locked || player.out) return;
    if (this.rules.slots > 1) return this.buzzMulti(player);
    if (this.phase !== 'reading' && this.phase !== 'waiting') return;
    this.clearTimers();
    this.buzzer = player.id;
    this.setPhase('answering', `${player.name} が早押し！`);
    if (this.mode === 'input') {
      this.typed = 0;
      this.letters = letterChoices(this.answerChars[0]);
      this.startTimer(LETTER_TIME, () => this.judge(player, -1));
    } else {
      this.choicesVisible = true;
      this.startTimer(ANSWER_TIME, () => this.judge(player, -1));
    }
    this.broadcast();
  }

  // 文字入力: 4つの文字から1つ選ぶ。正しければ次の文字へ、まちがえたらお手つき
  // pos: スマホが何文字目のつもりで選んだか。連打で次の文字の選択にずれないよう、合わないものは無視する
  pickLetter(player, index, pos) {
    if (this.phase !== 'answering' || this.mode !== 'input' || this.buzzer !== player.id) return;
    if (!Number.isInteger(index) || !this.letters || !this.letters[index]) return;
    if (pos !== this.typed) return;
    this.clearTimers();
    if (this.letters[index] !== this.answerChars[this.typed]) return this.judge(player, -1, { missed: true });
    this.typed++;
    if (this.typed >= this.answerChars.length) return this.judge(player, -1, { completed: true });
    this.letters = letterChoices(this.answerChars[this.typed]);
    this.startTimer(LETTER_TIME, () => this.judge(player, -1));
    this.broadcast();
  }

  answer(player, index) {
    if (this.phase !== 'answering' || this.mode !== 'choice' || this.buzzer !== player.id) return;
    if (!Number.isInteger(index)) return;
    const choice = this.choices[index];
    if (!choice || choice.out) return;
    this.judge(player, index);
  }

  // index: 選んだ選択肢（時間切れや文字入力では -1）
  // missed: 文字入力でまちがった文字を選んだ / completed: 文字入力で最後の文字まで正しく選べた
  judge(player, index, { missed = false, completed = false } = {}) {
    this.clearTimers();
    const choice = this.mode === 'choice' ? this.choices[index] : null;
    if (completed || (choice && choice.correct)) {
      player.score += this.rules.points[0];
      this.revealAnswer(player, `正解！ ${player.name} に1ポイント`);
      return;
    }
    player.locked = true;
    if (choice) choice.out = true;
    this.letters = null;
    let message = choice || missed ? `ざんねん！ ${player.name} はお手つき` : `時間切れ！ ${player.name} はお手つき`;
    if (this.loseLife(player)) message += `。ライフがなくなり脱落`;
    this.setPhase('feedback', message);
    this.timeout = setTimeout(() => {
      if (this.decided()) this.revealAnswer(null, `${player.name} が脱落！`);
      else if (this.allLocked()) this.revealAnswer(null, '全員お手つき！');
      else this.resumeReading();
    }, FEEDBACK_TIME);
    this.broadcast();
  }

  // ランクマッチ: ライフを1つ減らす。0になったら脱落して true を返す
  loseLife(player) {
    if (player.lives === null) return false;
    player.lives = Math.max(0, player.lives - 1);
    if (player.lives > 0) return false;
    player.out = true;
    player.locked = true;
    return true;
  }

  // ===== 4人対戦: 3人まで早押しでき、押した順に点数が高い =====
  // 最初の早押しで問題文（画像）が止まり、少しのあいだ、ほかの人も押せる。
  // 押した人はそれぞれ自分だけに見える選択肢（文字）で答え、全員が答えたら正解発表

  buzzMulti(player) {
    const open = this.phase === 'reading' || this.phase === 'waiting' || (this.phase === 'answering' && this.windowOpen);
    if (!open || this.slots.length >= this.rules.slots || this.slotOf(player)) return;
    if (this.slots.length === 0) {
      this.clearTimers();
      this.windowOpen = true;
      this.setPhase('answering', '');
      this.timer = { duration: BUZZ_WINDOW, endsAt: Date.now() + BUZZ_WINDOW };
      this.windowTimer = setTimeout(() => this.closeWindow(), BUZZ_WINDOW);
    }
    const slot = { player, order: this.slots.length + 1, done: false, correct: false, points: 0, choice: -1, typed: 0, letters: null, timer: null, deadline: 0, duration: 0 };
    this.slots.push(slot);
    if (this.mode === 'input') slot.letters = letterChoices(this.answerChars[0]);
    this.startSlotTimer(slot, this.mode === 'input' ? LETTER_TIME : ANSWER_TIME);
    this.message = this.slots.map((s) => `${s.order}番 ${s.player.name}`).join('　');
    if (this.slots.length >= this.rules.slots || !this.canStillBuzz()) this.closeWindow();
    else this.broadcast();
  }

  slotOf(player) {
    return this.slots.find((s) => s.player === player);
  }

  // まだ押していて、押せる人がいるか
  canStillBuzz() {
    return this.players.some((p) => p.socket && !p.locked && !p.out && !this.slotOf(p));
  }

  closeWindow() {
    clearTimeout(this.windowTimer);
    this.windowOpen = false;
    this.timer = null;
    this.checkSlots();
    if (this.phase === 'answering') this.broadcast();
  }

  startSlotTimer(slot, ms) {
    clearTimeout(slot.timer);
    slot.duration = ms;
    slot.deadline = Date.now() + ms;
    slot.timer = setTimeout(() => this.finishSlot(slot, false), ms);
  }

  answerMulti(player, index) {
    const slot = this.slotOf(player);
    if (this.phase !== 'answering' || !slot || slot.done || this.mode !== 'choice') return;
    if (!Number.isInteger(index) || !this.choices[index]) return;
    slot.choice = index;
    this.finishSlot(slot, this.choices[index].correct);
  }

  letterMulti(player, index, pos) {
    const slot = this.slotOf(player);
    if (this.phase !== 'answering' || !slot || slot.done || this.mode !== 'input') return;
    if (!Number.isInteger(index) || !slot.letters || !slot.letters[index] || pos !== slot.typed) return;
    if (slot.letters[index] !== this.answerChars[slot.typed]) return this.finishSlot(slot, false);
    slot.typed++;
    if (slot.typed >= this.answerChars.length) return this.finishSlot(slot, true);
    slot.letters = letterChoices(this.answerChars[slot.typed]);
    this.startSlotTimer(slot, LETTER_TIME);
    this.broadcast();
  }

  finishSlot(slot, correct) {
    if (slot.done) return;
    clearTimeout(slot.timer);
    slot.done = true;
    slot.correct = correct;
    slot.letters = null;
    this.checkSlots();
    if (this.phase === 'answering') this.broadcast();
  }

  // 押せる時間が終わり、押した人が全員答えたら、点数とライフを計算して正解発表
  checkSlots() {
    if (this.phase !== 'answering' || this.rules.slots <= 1) return;
    if ((this.windowOpen && this.canStillBuzz()) || this.slots.some((s) => !s.done)) return;
    const results = [];
    for (const s of this.slots) {
      if (s.correct) {
        s.points = this.rules.points[s.order - 1];
        s.player.score += s.points;
        results.push(`${s.player.name} ○+${s.points}`);
      } else {
        results.push(`${s.player.name} ×${this.loseLife(s.player) ? '（脱落）' : ''}`);
      }
    }
    const first = this.slots.find((s) => s.correct);
    this.revealAnswer(first ? first.player : null, `${results.join('　')}　正解は「${this.questions[this.index].answer}」`, false);
  }

  // ===== 正解発表・結果 =====

  // withAnswer: メッセージのあとに「正解は〇〇」をつけるか（だれも正解しなかったとき）
  revealAnswer(winner, message, withAnswer = !winner) {
    this.clearTimers();
    const q = this.questions[this.index];
    this.choicesVisible = this.mode === 'choice';
    this.letters = null;
    this.windowOpen = false;
    this.winner = winner ? winner.id : null;
    this.setPhase('reveal', withAnswer ? `${message} 正解は「${q.answer}」` : message);
    const last = this.index >= this.questions.length - 1;
    this.startTimer(REVEAL_TIME, () => {
      if (last || this.decided()) {
        this.finish();
      } else {
        this.index++;
        this.startQuestion();
      }
    });
    this.broadcast();
  }

  finish() {
    this.clearTimers();
    this.lastActivity = Date.now();
    this.setPhase('result', '');
    if (this.ranked) this.reportRanked();
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
    clearTimeout(this.windowTimer);
    for (const s of this.slots ?? []) clearTimeout(s.timer);
    this.textTimer = null;
    this.timeout = null;
    this.windowTimer = null;
    this.timer = null;
  }

  // ===== 送信 =====

  // 部屋の今の様子。全員に同じものを送り、スマホ側はこれを画面に描くだけ
  // （4人対戦で自分が答えているときの選択肢だけは、その人にしか送らない → mineFor）
  snapshot() {
    const inQuestion = this.phase !== 'lobby' && this.phase !== 'result';
    const reveal = this.phase === 'reveal';
    const multi = this.rules.slots > 1;
    return {
      type: 'state',
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      message: this.message,
      questionCount: this.questionCount,
      questionCounts: QUESTION_COUNTS,
      answerMode: this.answerMode,
      answerModes: ANSWER_MODES,
      questionKind: this.questionKind,
      questionKinds: QUESTION_KINDS,
      genres: this.genres,
      genreList: GENRES,
      totalQuestions: QUESTIONS.length,
      totalImages: IMAGES.length,
      ranked: this.ranked ? {
        mode: this.ranked.mode,
        rules: { lives: this.rules.lives, target: this.rules.target, slots: this.rules.slots, points: this.rules.points, questions: this.rules.questions },
        waitingFor: Math.max(0, this.ranked.expected.length - this.players.length),
        results: this.ranked.results,
      } : null,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        score: p.score,
        locked: p.locked,
        lives: p.lives,
        out: p.out,
        left: p.left,
        title: p.title ?? null,
        rating: p.rating ?? null,
        ladderId: p.ladderId ?? null,
        online: Boolean(p.socket),
      })),
      question: inQuestion ? {
        number: this.index + 1,
        total: this.questions.length,
        text: this.frames ? this.chars.join('') : this.chars.slice(0, this.shown).join(''),
        rest: reveal && !this.frames ? this.chars.slice(this.shown).join('') : '',
        mode: this.mode,
        answer: reveal ? this.answerChars.join('') : null,
        choices: this.choicesVisible
          ? this.choices.map((c) => ({ text: c.text, out: c.out, correct: reveal && c.correct }))
          : null,
        // 文字入力: 何文字か・どこまで選べたか・いま選べる4文字（4人対戦では、答えている本人にだけ mine で送る）
        input: this.mode === 'input' && (reveal || (!multi && (this.phase === 'answering' || this.phase === 'feedback'))) ? {
          total: this.answerChars.length,
          typed: reveal ? this.answerChars.join('') : this.answerChars.slice(0, this.typed).join(''),
          letters: !multi && this.phase === 'answering' ? this.letters : null,
        } : null,
        image: this.frames ? this.imageState(reveal) : null,
        // 4人対戦: 押した人と順番（正解したかは正解発表まで見せない）
        slots: multi ? this.slots.map((s) => ({
          id: s.player.id,
          order: s.order,
          done: s.done,
          correct: reveal ? s.correct : null,
          points: reveal ? s.points : null,
        })) : null,
        window: multi && this.windowOpen,
      } : null,
      buzzer: this.buzzer,
      winner: this.winner,
      timer: this.timer ? { duration: this.timer.duration, remaining: Math.max(0, this.timer.endsAt - Date.now()) } : null,
    };
  }

  // 4人対戦で、自分が答えている問題の選択肢・文字（ほかの人には見せない）
  mineFor(player) {
    if (this.rules.slots <= 1 || this.phase !== 'answering') return null;
    const slot = this.slotOf(player);
    if (!slot) return null;
    return {
      order: slot.order,
      done: slot.done,
      choices: this.mode === 'choice' ? this.choices.map((c, i) => ({ text: c.text, picked: slot.choice === i })) : null,
      input: this.mode === 'input' ? {
        total: this.answerChars.length,
        typed: this.answerChars.slice(0, slot.typed).join(''),
        letters: slot.done ? null : slot.letters,
      } : null,
      timer: slot.done ? null : { duration: slot.duration, remaining: Math.max(0, slot.deadline - Date.now()) },
    };
  }

  // 画像クイズ: 見せている段階までと、先に読みこんでおく次の1段階だけを送る（全体は正解発表まで送らない）
  imageState(reveal) {
    const shown = reveal ? this.frames.length : this.shown;
    return {
      shown,
      frames: this.frames.slice(0, Math.min(this.frames.length, shown + 1)),
      step: IMAGE_STEP,
      credit: reveal ? this.questions[this.index].image.credit : null,
    };
  }

  broadcast() {
    const state = this.snapshot();
    for (const p of this.players) {
      if (p.socket) send(p.socket, { ...state, you: p.id, mine: this.mineFor(p) });
    }
  }
}

// pool から n問選び、そのうち inputs問を文字入力にする（文字入力に向く問題が足りなければ選択肢でうめる）
function pickQuestions(pool, n, inputs) {
  if (n <= 0) return [];
  // 答えがひらがな・カタカナだけで、選択肢なしでも答えが決まる問題は、文字入力でも出せる
  const forInput = shuffle(pool.filter(isInputQuestion)).slice(0, Math.max(0, inputs));
  const used = new Set(forInput);
  const forChoice = shuffle(pool.filter((q) => !used.has(q))).slice(0, n - forInput.length);
  return [...forInput.map((q) => ({ ...q, mode: 'input' })), ...forChoice.map((q) => ({ ...q, mode: 'choice' }))];
}
