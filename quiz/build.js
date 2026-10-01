// quiz/data/ の問題と questions.js の問題をまとめて、src/questions.generated.json を作る。
// 使い方: npm run quiz
// ・形がおかしい問題、選択肢に正解がまざっている問題、重複した問題はここで止める
// ・ジャンルごとに TARGET 問ちょうどにそろえる（questions.js に書いた問題は必ず残す）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GENRES, rng, shuffle } from './lib.js';
import handmade from '../questions.js';

const TARGET = 667; // 15ジャンル × 667問 ≒ 1万問
const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, 'data');
const outFile = path.join(root, '..', 'src', 'questions.generated.json');

const errors = [];
const byGenre = Object.fromEntries(GENRES.map((g) => [g, { fixed: [], pool: [] }]));
const seen = new Map(); // 正規化した問題文 → 出どころ
let duplicates = 0;

function normalize(text) {
  return text.replace(/[\s　、。，．・「」『』（）()？?！!]/g, '');
}

function check(item, source) {
  const where = `${source}: ${item?.q}`;
  if (!item || typeof item.q !== 'string' || typeof item.answer !== 'string' || !Array.isArray(item.wrong)) {
    errors.push(`形がおかしい ${where}`);
    return false;
  }
  if (!GENRES.includes(item.genre)) errors.push(`ジャンルが不明 (${item.genre}) ${where}`);
  if (item.q.length < 6 || item.q.length > 160) errors.push(`問題文の長さ ${where}`);
  if (!item.answer.trim() || item.answer.length > 40) errors.push(`正解の長さ ${where}`);
  if (item.wrong.length !== 3) errors.push(`まちがいの選択肢が3つでない ${where}`);
  const choices = [item.answer, ...item.wrong].map((c) => String(c).trim());
  if (new Set(choices).size !== choices.length) errors.push(`選択肢が重複 ${where} → ${choices.join(' / ')}`);
  if (choices.some((c) => !c || c.length > 40)) errors.push(`選択肢の長さ ${where}`);
  return true;
}

function add(item, source, fixed) {
  if (!check(item, source)) return;
  const key = normalize(item.q);
  if (seen.has(key)) {
    duplicates++;
    if (fixed) errors.push(`questions.js の問題が重複: ${item.q}`);
    return;
  }
  seen.set(key, source);
  const bucket = byGenre[item.genre];
  if (bucket) (fixed ? bucket.fixed : bucket.pool).push({ q: item.q, answer: item.answer, wrong: item.wrong, genre: item.genre, source });
}

// 手で書いた問題（必ず残す）
for (const item of handmade) add(item, 'questions.js', true);

// データから作る問題
const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.js')).sort();
for (const file of files) {
  const mod = (await import(pathToFileURL(path.join(dataDir, file)).href)).default;
  const items = mod.build();
  let count = 0;
  for (const item of items) {
    if (!item) continue;
    add({ ...item, genre: item.genre ?? mod.genre }, file, false);
    count++;
  }
  console.log(`${file.padEnd(24)} ${String(count).padStart(5)}問  (${mod.genre})`);
}

if (errors.length) {
  console.error(`\nエラー ${errors.length}件`);
  for (const e of errors.slice(0, 50)) console.error('  ' + e);
  process.exit(1);
}

// ジャンルごとに TARGET 問にそろえる。
// 作ったファイルごとに順番に1問ずつ選ぶので、ジャンルの中身（英単語ばかり、など）がかたよらない
function pickBalanced(pool, count, seed) {
  const bySource = new Map();
  for (const item of pool) {
    if (!bySource.has(item.source)) bySource.set(item.source, []);
    bySource.get(item.source).push(item);
  }
  const queues = [...bySource.keys()].sort().map((src) => shuffle(bySource.get(src), rng(seed + src)));
  const picked = [];
  while (picked.length < count && queues.some((q) => q.length)) {
    for (const q of queues) if (q.length && picked.length < count) picked.push(q.shift());
  }
  return picked;
}

const output = [];
console.log('\nジャンル          使う問題 / 作れた問題');
let short = false;
for (const genre of GENRES) {
  const { fixed, pool } = byGenre[genre];
  const picked = [...fixed, ...pickBalanced(pool, TARGET - fixed.length, genre)];
  if (picked.length < TARGET) short = true;
  output.push(...picked.map(({ source, ...q }) => q));
  console.log(`${genre.padEnd(12)} ${String(picked.length).padStart(6)} / ${String(fixed.length + pool.length).padStart(5)}${picked.length < TARGET ? '  ← 足りない' : ''}`);
}
console.log(`\n合計 ${output.length}問（重複して捨てた問題 ${duplicates}）`);

fs.writeFileSync(outFile, JSON.stringify(output));
console.log(`書き出し: ${path.relative(process.cwd(), outFile)} (${Math.round(fs.statSync(outFile).size / 1024)} KB)`);
if (short) process.exitCode = 2;
