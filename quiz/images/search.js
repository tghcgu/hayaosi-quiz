// 画像クイズの候補さがし（作る人が使う道具）
// Wikimedia Commons で CC0 の画像を検索し、候補を番号つきで並べた一覧画像を作る。
//   node quiz/images/search.js            … picks.js でまだ選んでいない題材すべて
//   node quiz/images/search.js キリン ゾウ  … 指定した題材だけ（「キリン=giraffe calf」で検索語を変えられる）
// できるもの: quiz/images/cache/candidates/<正解>.json と quiz/images/cache/sheets/<正解>.jpg
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import SUBJECTS from './subjects.js';
import PICKS from './picks.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const CAND_DIR = path.join(dir, 'cache', 'candidates');
const SHEET_DIR = path.join(dir, 'cache', 'sheets');
fs.mkdirSync(CAND_DIR, { recursive: true });
fs.mkdirSync(SHEET_DIR, { recursive: true });

export const UA = 'HayaoshiQuizRoyale/0.1 (https://github.com/tghcgu/hayaosi-quiz)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJSON(url) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    await sleep(2000 * (i + 1));
  }
  throw new Error(`取得できない: ${url}`);
}

export async function getBuffer(url) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    await sleep(2000 * (i + 1));
  }
  throw new Error(`取得できない: ${url}`);
}

const strip = (html = '') => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function search(query) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '20',
    gsrsearch: `${query} incategory:CC-zero filetype:bitmap`,
    prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist', iiurlwidth: '330',
  });
  const j = await getJSON(`https://commons.wikimedia.org/w/api.php?${params}`);
  const pages = Object.values(j.query?.pages ?? {}).sort((a, b) => a.index - b.index);
  return pages
    .map((p) => ({ title: p.title, ...p.imageinfo[0] }))
    .filter((i) => Math.min(i.width, i.height) >= 700 && /CC0|public domain/i.test(i.extmetadata?.LicenseShortName?.value ?? ''))
    .slice(0, 8)
    .map((i, n) => ({
      n: n + 1,
      title: i.title,
      width: i.width,
      height: i.height,
      thumb: i.thumburl,
      page: i.descriptionurl,
      license: i.extmetadata.LicenseShortName.value,
      artist: strip(i.extmetadata.Artist?.value),
    }));
}

// 候補を 4×2 に並べた一覧画像
async function sheet(cands, file) {
  const CELL = 220, LABEL = 28, COLS = 4;
  const rows = Math.ceil(cands.length / COLS) || 1;
  const parts = [];
  for (const c of cands) {
    const img = await sharp(await getBuffer(c.thumb)).resize(CELL, CELL, { fit: 'contain', background: '#222' }).toBuffer();
    const x = ((c.n - 1) % COLS) * CELL, y = Math.floor((c.n - 1) / COLS) * (CELL + LABEL);
    parts.push({ input: img, left: x, top: y + LABEL });
    const label = `<svg width="${CELL}" height="${LABEL}"><rect width="100%" height="100%" fill="#000"/><text x="6" y="21" font-size="20" font-family="Arial" fill="#ff0">${c.n}  ${c.width}x${c.height}</text></svg>`;
    parts.push({ input: Buffer.from(label), left: x, top: y });
  }
  await sharp({ create: { width: CELL * COLS, height: rows * (CELL + LABEL), channels: 3, background: '#000' } })
    .composite(parts).jpeg({ quality: 80 }).toFile(file);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const targets = args.length
    ? args.map((a) => { const [ans, q] = a.split('='); const s = SUBJECTS.find(([x]) => x === ans); if (!s) throw new Error(`題材がない: ${ans}`); return [ans, q ?? s[2]]; })
    : SUBJECTS.filter(([a]) => !PICKS[a]).map(([a, , q]) => [a, q]);
  for (const [answer, query] of targets) {
    const cands = await search(query);
    fs.writeFileSync(path.join(CAND_DIR, `${answer}.json`), JSON.stringify(cands, null, 1));
    if (cands.length) await sheet(cands, path.join(SHEET_DIR, `${answer}.jpg`));
    console.log(`${answer} (${query}): 候補${cands.length}`);
    await sleep(300);
  }
}
