// 画像クイズを作る（npm run images）
// picks.js で選んだ Wikimedia Commons の画像（CC0）をダウンロードし、
// 「大きく拡大」→「全体」までの7段階の画像を public/q/ に書き出す。
// ファイル名は答えがわからない名前にし、スマホには今の段階と次の段階の画像しか送らない（先に全体を見られないように）。
// できるもの: public/q/*.webp, src/images.generated.json, public/credits.html
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import SUBJECTS, { KINDS } from './subjects.js';
import PICKS from './picks.js';
import { getJSON, getBuffer } from './search.js';
import { rng, shuffle } from '../lib.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..', '..');
const OUT_DIR = path.join(root, 'public', 'q');
const CACHE = path.join(dir, 'cache', 'orig');
const JSON_OUT = path.join(root, 'src', 'images.generated.json');
const CREDITS_OUT = path.join(root, 'public', 'credits.html');

const ZOOMS = [6, 4.5, 3.3, 2.45, 1.8, 1.35, 1]; // 段階ごとの拡大率（最後は全体）
const SIZE = 480;                                // 書き出す画像の1辺(px)
const BACKGROUND = '#151a33';                    // 縦長・横長の画像のすきま
const SALT = 'hayaoshi-image-v1';

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const strip = (html = '') => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

// 画像の情報（作者・ライセンス）と、横1920pxまでの画像を取ってくる（2回目からは手元の保存を使う）
async function fetchImage(file) {
  const key = sha(file).slice(0, 20);
  const metaFile = path.join(CACHE, `${key}.json`);
  const imageFile = path.join(CACHE, `${key}.img`);
  if (!fs.existsSync(metaFile)) {
    const params = new URLSearchParams({
      action: 'query', format: 'json', titles: file, prop: 'imageinfo',
      iiprop: 'url|size|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist', iiurlwidth: '1920',
    });
    const j = await getJSON(`https://commons.wikimedia.org/w/api.php?${params}`);
    const page = Object.values(j.query.pages)[0];
    if (!page.imageinfo) throw new Error(`画像が見つからない: ${file}`);
    const i = page.imageinfo[0];
    const meta = {
      title: file.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
      page: i.descriptionurl,
      url: i.thumburl || i.url,
      license: i.extmetadata?.LicenseShortName?.value ?? '',
      artist: strip(i.extmetadata?.Artist?.value) || '不明',
    };
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
  }
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  if (!/CC0|public domain/i.test(meta.license)) throw new Error(`CC0・パブリックドメインではない (${meta.license}): ${file}`);
  if (!fs.existsSync(imageFile)) fs.writeFileSync(imageFile, await getBuffer(meta.url));
  return { meta, buffer: fs.readFileSync(imageFile) };
}

// 拡大の中心 (fx, fy) から、段階ごとの正方形の画像を切り出す
async function frames(answer, file, buffer, [fx, fy]) {
  const { data, info } = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, side = Math.max(W, H);
  const padX = (side - W) / 2, padY = (side - H) / 2;
  const canvas = await sharp(data)
    .extend({ left: Math.floor(padX), right: Math.ceil(padX), top: Math.floor(padY), bottom: Math.ceil(padY), background: BACKGROUND })
    .toBuffer();
  const cx = padX + fx * W, cy = padY + fy * H;
  const out = [];
  for (const z of ZOOMS) {
    const v = Math.round(side / z);
    const left = Math.round(clamp(cx - v / 2, 0, side - v));
    const top = Math.round(clamp(cy - v / 2, 0, side - v));
    const name = `${sha(`${SALT}|${answer}|${file}|${z}`).slice(0, 16)}.webp`;
    await sharp(canvas).extract({ left, top, width: v, height: v }).resize(SIZE, SIZE).webp({ quality: 72 }).toFile(path.join(OUT_DIR, name));
    const r = (x) => Math.round((x / side) * 1e5) / 1e5;
    out.push({ src: `/q/${name}`, rect: [r(left), r(top), r(v)] });
  }
  return out;
}

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const questions = [];
const written = new Set();
for (const [answer, kind] of SUBJECTS) {
  const pick = PICKS[answer];
  if (!pick) continue;
  const [file, fx, fy] = pick;
  const { meta, buffer } = await fetchImage(file);
  const list = await frames(answer, file, buffer, [fx, fy]);
  for (const f of list) written.add(path.basename(f.src));
  const others = SUBJECTS.filter(([a, k]) => k === kind && a !== answer).map(([a]) => a);
  questions.push({
    q: KINDS[kind].prompt,
    answer,
    wrong: shuffle(others, rng(`image|${answer}`)).slice(0, 3),
    genre: KINDS[kind].genre,
    image: {
      frames: list,
      credit: { title: meta.title, artist: meta.artist, license: meta.license, page: meta.page },
    },
  });
  process.stdout.write('.');
}

// 使わなくなった画像を消す
for (const f of fs.readdirSync(OUT_DIR)) if (!written.has(f)) fs.unlinkSync(path.join(OUT_DIR, f));

fs.writeFileSync(JSON_OUT, JSON.stringify(questions));

const rows = questions.map((q) => `<li>${escape(q.answer)} … <a href="${escape(q.image.credit.page)}">${escape(q.image.credit.title)}</a>（${escape(q.image.credit.artist)}・${escape(q.image.credit.license)}）</li>`).join('\n');
fs.writeFileSync(CREDITS_OUT, `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>画像の出典 - 早押しクイズロワイヤル</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<main class="doc">
<h1>画像の出典</h1>
<p>画像クイズの写真は、すべて Wikimedia Commons で CC0（パブリックドメイン）として公開されているものです。撮影・公開してくださった方々に感謝します。</p>
<p>ゲームでは、写真の一部を切り出したり拡大したりして使っています。</p>
<ul>
${rows}
</ul>
<p><a href="/">ゲームにもどる</a></p>
</main>
</body>
</html>
`);

const size = fs.readdirSync(OUT_DIR).reduce((s, f) => s + fs.statSync(path.join(OUT_DIR, f)).size, 0);
console.log(`\n画像クイズ ${questions.length}問（${written.size}枚・${Math.round(size / 1024)}KB）→ ${path.relative(root, JSON_OUT)}`);
