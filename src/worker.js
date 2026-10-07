// 早押しクイズロワイヤル - 対戦サーバー（Cloudflare Workers + Durable Objects）
// 手元で試す: npm run dev / 公開する: npm run deploy
//
// /ws?room=1234  友だちと遊ぶ部屋に入る（/ws だけなら部屋をつくる）
// /ws?match=…    ランクマッチの部屋に入る
// /ladder        ランクマッチの対戦相手さがし
// /api/…         ランキング・自分の成績・通報・記録の削除

import { Room } from './room.js';
import { Ladder } from './ladder.js';
import { randomInt } from './util.js';

export { Room, Ladder };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ladder' || url.pathname.startsWith('/api/')) {
      if (url.pathname === '/ladder' && request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocketで接続してください', { status: 426 });
      return env.LADDER.get(env.LADDER.idFromName('main')).fetch(request);
    }

    if (url.pathname !== '/ws') return new Response('見つかりません', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocketで接続してください', { status: 426 });

    const match = url.searchParams.get('match');
    if (match !== null) {
      if (!/^[0-9a-f]{32}$/.test(match)) return new Response('対戦の番号がおかしいです', { status: 400 });
      return env.ROOMS.get(env.ROOMS.idFromName(`ranked:${match}`)).fetch(new Request(url, request));
    }

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
