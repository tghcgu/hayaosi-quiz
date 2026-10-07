// ランクマッチの受付（Durable Object は全体で1つ）
// ・対戦相手さがし: 待っている人をレートの近い人どうしで組み、ランクマッチの部屋を用意する
// ・レートとランキング: プレイヤーごとのレート・対戦数を SQLite に保存する
// ・通報: 同じ名前に3人以上から通報が集まったら、その名前を使えなくする
// プレイヤーは端末ごとに自動でつくる（id と合言葉 token。token はハッシュにして保存）

import { DurableObject } from 'cloudflare:workers';
import { cleanName, isBadName } from './names.js';
import { START_RATING, rankTitle, updateRatings } from './rating.js';
import { send, randomHex, sha256 } from './util.js';

// size: 何人で対戦するか min: 待ち時間が長いときに、何人から始めてよいか
const MODES = {
  duel: { size: 2, min: 2 },
  four: { size: 4, min: 3 },
};
const MATCH_INTERVAL = 1000;      // 組み合わせを試す間隔
const RANGE_BASE = 150;           // はじめは、レートの差がこれ以内の人と組む
const RANGE_PER_SECOND = 15;      // 待つほど、組める差を広げる
const ANY_RANGE_AFTER = 30000;    // これだけ待ったら、レートに関係なく組む
const SHORT_HANDED_AFTER = 20000; // 4人対戦で、3人のまま始めるまでの待ち時間
const SILENT_TIMEOUT = 60 * 1000;
const RANKING_SIZE = 50;
const RANKING_MIN_GAMES = 3;      // ランキングに出るのに必要な対戦数
const REPORTS_TO_BAN = 3;         // この人数から通報されると、その名前は使えなくなる

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export class Ladder extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, token TEXT NOT NULL, name TEXT NOT NULL,
      rating INTEGER NOT NULL, games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL, updated INTEGER NOT NULL)`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS players_rating ON players (rating DESC)');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY, mode TEXT NOT NULL, players TEXT NOT NULL, created INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports (
      target TEXT NOT NULL, reporter TEXT NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (target, reporter))`);
    this.sql.exec('CREATE TABLE IF NOT EXISTS banned_names (player TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (player, name))');
    this.sockets = new Set();
    this.waiting = []; // { socket, mode, player: { id, name, rating }, blocks, since }
    this.timer = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ladder') return this.connect();
    if (request.method === 'GET' && url.pathname === '/api/ranking') return json(this.ranking());
    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'bad request' }, 400);
      }
      if (url.pathname === '/api/me') return json(await this.me(body));
      if (url.pathname === '/api/report') return json(await this.report(body));
      if (url.pathname === '/api/delete') return json(await this.remove(body));
    }
    return json({ error: 'not found' }, 404);
  }

  // ===== プレイヤー =====

  async auth(id, token) {
    if (typeof id !== 'string' || typeof token !== 'string') return null;
    const row = this.sql.exec('SELECT * FROM players WHERE id = ?', id).toArray()[0];
    return row && row.token === (await sha256(token)) ? row : null;
  }

  async me({ id, token }) {
    const p = await this.auth(id, token);
    if (!p) return { player: null };
    const place = p.games >= RANKING_MIN_GAMES
      ? 1 + this.sql.exec('SELECT COUNT(*) AS n FROM players WHERE games >= ? AND rating > ?', RANKING_MIN_GAMES, p.rating).one().n
      : null;
    return { player: { name: p.name, rating: p.rating, title: rankTitle(p.rating), games: p.games, wins: p.wins, place } };
  }

  ranking() {
    const rows = this.sql.exec('SELECT id, name, rating, games FROM players WHERE games >= ? ORDER BY rating DESC, games DESC LIMIT ?', RANKING_MIN_GAMES, RANKING_SIZE).toArray();
    return { minGames: RANKING_MIN_GAMES, players: rows.map((r) => ({ id: r.id, name: r.name, rating: r.rating, title: rankTitle(r.rating), games: r.games })) };
  }

  // 通報: 同じ名前を3人以上が通報したら、その人はその名前を使えなくなる（名前は「プレイヤー〇〇」に戻す）
  async report({ id, token, target }) {
    const reporter = await this.auth(id, token);
    if (!reporter || typeof target !== 'string' || target === reporter.id) return { ok: false };
    const t = this.sql.exec('SELECT id, name FROM players WHERE id = ?', target).toArray()[0];
    if (!t) return { ok: false };
    this.sql.exec('INSERT OR REPLACE INTO reports (target, reporter, name, created) VALUES (?, ?, ?, ?)', t.id, reporter.id, t.name, Date.now());
    const count = this.sql.exec('SELECT COUNT(*) AS n FROM reports WHERE target = ? AND name = ?', t.id, t.name).one().n;
    if (count >= REPORTS_TO_BAN) {
      this.sql.exec('INSERT OR IGNORE INTO banned_names (player, name) VALUES (?, ?)', t.id, t.name);
      this.sql.exec('UPDATE players SET name = ? WHERE id = ?', `プレイヤー${t.id.slice(0, 4)}`, t.id);
      this.sql.exec('DELETE FROM reports WHERE target = ?', t.id);
    }
    return { ok: true };
  }

  // ランクマッチの記録を消す
  async remove({ id, token }) {
    const p = await this.auth(id, token);
    if (!p) return { ok: false };
    this.sql.exec('DELETE FROM players WHERE id = ?', p.id);
    this.sql.exec('DELETE FROM reports WHERE target = ? OR reporter = ?', p.id, p.id);
    this.sql.exec('DELETE FROM banned_names WHERE player = ?', p.id);
    for (const e of this.waiting.filter((w) => w.player.id === p.id)) this.dequeue(e.socket);
    return { ok: true };
  }

  // ===== 対戦相手さがし =====

  connect() {
    const [client, ws] = Object.values(new WebSocketPair());
    ws.accept();
    const socket = { ws, entry: null, busy: false, lastSeen: Date.now() };
    this.sockets.add(socket);
    ws.addEventListener('message', (e) => this.onMessage(socket, e.data));
    ws.addEventListener('close', () => this.disconnect(socket));
    ws.addEventListener('error', () => this.disconnect(socket));
    this.startTimer();
    return new Response(null, { status: 101, webSocket: client });
  }

  async onMessage(socket, raw) {
    socket.lastSeen = Date.now();
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    try {
      if (msg?.type === 'queue') await this.enqueue(socket, msg);
      if (msg?.type === 'cancel') this.dequeue(socket);
    } catch (err) {
      console.error(err);
    }
  }

  disconnect(socket) {
    if (!this.sockets.delete(socket)) return;
    this.dequeue(socket);
  }

  refuse(socket, message) {
    send(socket, { type: 'error', message });
    socket.ws.close(1000, 'refused');
    this.disconnect(socket);
  }

  async enqueue(socket, msg) {
    if (socket.entry || socket.busy || !MODES[msg.mode]) return;
    socket.busy = true;
    try {
      const name = cleanName(msg.name);
      if (isBadName(name)) return this.refuse(socket, 'その名前はランクマッチでは使えません。別の名前にしてね');
      let player = await this.auth(msg.id, msg.token);
      const now = Date.now();
      if (player) {
        const banned = this.sql.exec('SELECT 1 FROM banned_names WHERE player = ? AND name = ?', player.id, name).toArray().length > 0;
        if (banned) return this.refuse(socket, '通報が多かったため、この名前は使えなくなりました。別の名前にしてね');
        this.sql.exec('UPDATE players SET name = ?, updated = ? WHERE id = ?', name, now, player.id);
      } else {
        // はじめてのランクマッチ: この端末のプレイヤーをつくる
        const id = randomHex(8);
        const token = randomHex(16);
        this.sql.exec('INSERT INTO players (id, token, name, rating, games, wins, created, updated) VALUES (?, ?, ?, ?, 0, 0, ?, ?)', id, await sha256(token), name, START_RATING, now, now);
        send(socket, { type: 'registered', id, token });
        player = { id, rating: START_RATING };
      }
      if (socket.ws.readyState !== 1) return; // 準備しているあいだに切れた
      // 同じプレイヤーが別の画面でも待っていたら、そちらはやめる
      for (const e of this.waiting.filter((w) => w.player.id === player.id)) {
        send(e.socket, { type: 'error', message: '別の画面で対戦相手をさがしはじめたので、こちらはやめました' });
        this.dequeue(e.socket);
      }
      const blocks = new Set(Array.isArray(msg.blocks) ? msg.blocks.filter((b) => typeof b === 'string').slice(0, 200) : []);
      socket.entry = { socket, mode: msg.mode, player: { id: player.id, name, rating: player.rating }, blocks, since: now };
      this.waiting.push(socket.entry);
      send(socket, { type: 'waiting', count: this.countWaiting(msg.mode), rating: player.rating, title: rankTitle(player.rating) });
      this.startTimer();
    } finally {
      socket.busy = false;
    }
  }

  dequeue(socket) {
    if (!socket.entry) return;
    this.waiting = this.waiting.filter((e) => e !== socket.entry);
    socket.entry = null;
  }

  countWaiting(mode) {
    return this.waiting.filter((e) => e.mode === mode).length;
  }

  startTimer() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), MATCH_INTERVAL);
  }

  tick() {
    const now = Date.now();
    for (const socket of [...this.sockets]) {
      if (now - socket.lastSeen > SILENT_TIMEOUT) {
        socket.ws.close(1000, 'timeout');
        this.disconnect(socket);
      }
    }
    for (const mode of Object.keys(MODES)) this.matchMode(mode, now);
    for (const e of this.waiting) send(e.socket, { type: 'waiting', count: this.countWaiting(e.mode) });
    if (this.sockets.size === 0) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // 長く待っている人から順に、レートの近い相手をさがす
  matchMode(mode, now) {
    const { size, min } = MODES[mode];
    let queue = this.waiting.filter((e) => e.mode === mode).sort((a, b) => a.since - b.since);
    while (queue.length >= min) {
      const anchor = queue[0];
      const waited = now - anchor.since;
      const range = waited >= ANY_RANGE_AFTER ? Infinity : RANGE_BASE + (waited / 1000) * RANGE_PER_SECOND;
      const diff = (e) => Math.abs(e.player.rating - anchor.player.rating);
      const group = [anchor];
      for (const e of queue.slice(1).filter((e) => diff(e) <= range).sort((a, b) => diff(a) - diff(b))) {
        if (group.length >= size) break;
        if (group.some((g) => g.blocks.has(e.player.id) || e.blocks.has(g.player.id))) continue; // ブロックした相手とは組まない
        group.push(e);
      }
      const ready = group.length === size || (group.length >= min && waited >= SHORT_HANDED_AFTER);
      if (ready) {
        this.startMatch(mode, group);
        queue = queue.filter((e) => !group.includes(e));
      } else {
        queue = queue.slice(1); // この人の相手はまだいない。次に長く待っている人で試す
      }
    }
  }

  async startMatch(mode, group) {
    this.waiting = this.waiting.filter((e) => !group.includes(e));
    const matchId = randomHex(16);
    const players = group.map((e) => ({
      ticket: randomHex(16),
      ladderId: e.player.id,
      name: e.player.name,
      rating: e.player.rating,
      title: rankTitle(e.player.rating),
    }));
    this.sql.exec('INSERT INTO matches (id, mode, players, created) VALUES (?, ?, ?, ?)', matchId, mode, JSON.stringify(players.map((p) => p.ladderId)), Date.now());
    try {
      const room = this.env.ROOMS.get(this.env.ROOMS.idFromName(`ranked:${matchId}`));
      if (!(await room.setupRanked({ matchId, mode, players }))) throw new Error('部屋を用意できない');
    } catch (err) {
      console.error(err);
      // 部屋の用意に失敗したら、もう一度待ってもらう
      for (const e of group) if (e.socket.ws.readyState === 1 && e.socket.entry === e) this.waiting.push(e);
      return;
    }
    group.forEach((e, i) => {
      e.socket.entry = null;
      send(e.socket, { type: 'matched', match: matchId, ticket: players[i].ticket, mode });
    });
  }

  // ===== 対戦結果（ランクマッチの部屋から呼ばれる） =====
  // standings: [{ ladderId, place }]。レートを計算して保存し、変化を返す
  async reportResult(matchId, standings) {
    const match = this.sql.exec('SELECT * FROM matches WHERE id = ?', matchId).toArray()[0];
    if (!match || match.done) return null;
    this.sql.exec('UPDATE matches SET done = 1 WHERE id = ?', matchId);
    const allowed = new Set(JSON.parse(match.players));
    const entries = [];
    for (const s of standings) {
      if (!allowed.has(s.ladderId)) continue;
      const row = this.sql.exec('SELECT id, rating, games FROM players WHERE id = ?', s.ladderId).toArray()[0];
      if (row) entries.push({ id: row.id, rating: row.rating, games: row.games, place: s.place });
    }
    if (entries.length < 2) return [];
    const changes = updateRatings(entries);
    const now = Date.now();
    for (const c of changes) {
      const won = entries.find((e) => e.id === c.id).place === 1 ? 1 : 0;
      this.sql.exec('UPDATE players SET rating = ?, games = games + 1, wins = wins + ?, updated = ? WHERE id = ?', c.after, won, now, c.id);
    }
    return changes.map((c) => ({ ...c, titleBefore: rankTitle(c.before), titleAfter: rankTitle(c.after) }));
  }
}
