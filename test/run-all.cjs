// テストをまとめて動かす
//   npm test           サーバーのテスト（偽プレイヤーを WebSocket でつなぐ）
//   npm run test:ui    画面のテスト（ヘッドレス Chrome で2〜4人分のページを開く）
// 先に別のターミナルで `npx wrangler dev --port 8787` を動かしておく
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SERVER_TESTS = ['play-test', 'input-test', 'genre-test', 'image-test', 'ranked-test'];
const UI_TESTS = ['ui-test', 'ui-input', 'ui-image', 'ui-ranked'];
const BASE = (process.env.WS_URL || 'ws://127.0.0.1:8787/ws').replace(/^ws/, 'http').replace(/\/ws$/, '');

(async () => {
  try {
    await fetch(BASE);
  } catch {
    console.error(`${BASE} につながりません。別のターミナルで npx wrangler dev --port 8787 を動かしてください`);
    process.exit(1);
  }
  const tests = process.argv.includes('--ui') ? UI_TESTS : SERVER_TESTS;
  const failed = [];
  for (const name of tests) {
    console.log(`\n===== ${name} =====`);
    const { status } = spawnSync(process.execPath, [path.join(__dirname, `${name}.cjs`)], { stdio: 'inherit' });
    if (status !== 0) failed.push(name);
  }
  console.log(failed.length ? `\n失敗: ${failed.join(', ')}` : '\nすべて成功');
  process.exit(failed.length ? 1 : 0);
})();
