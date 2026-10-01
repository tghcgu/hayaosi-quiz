// 問題づくりの道具。
// 乱数の種を問題文から決めているので、何度作り直しても同じ問題・同じ選択肢になる

export const GENRES = ['ことば・文学', '歴史', '地理', '社会', '理数系', 'からだ・健康', '生き物・自然', '乗り物・テクノロジー', '芸術・伝統文化', 'エンタメ', 'スポーツ', '遊び・趣味', '食べ物・飲み物', '暮らし', '雑学'];

export function rng(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 候補の中から1つ選ぶ（言い回しを変えるときなどに使う）
export function pickOne(list, seed) {
  return list[Math.floor(rng(seed)() * list.length)];
}

// 正解以外の候補から、まちがいの選択肢を n 個えらぶ
export function wrongFrom(answer, pool, seed, { n = 3, filter } = {}) {
  const seen = new Set([answer]);
  const candidates = [];
  for (const x of pool) {
    if (seen.has(x) || (filter && !filter(x))) continue;
    seen.add(x);
    candidates.push(x);
  }
  return shuffle(candidates, rng(seed)).slice(0, n);
}

// 問題を1つ作る。まちがいの選択肢が足りないときは null（あとで捨てる）
export function makeQ(q, answer, pool, opts = {}) {
  const wrong = wrongFrom(answer, pool, q, opts);
  if (wrong.length < (opts.n ?? 3)) return null;
  return { q, answer, wrong };
}

// 正解と文字数が近いものだけを、まちがいの選択肢にする（読みの問題など）
export function similarLength(answer, diff = 1) {
  const len = Array.from(answer).length;
  return (x) => Math.abs(Array.from(x).length - len) <= diff;
}

// 数の問題で、正解の近くのまちがいを作る
export function nearNumbers(answer, seed, { n = 3, spread = [1, 2, 3, -1, -2, -3], min = 0 } = {}) {
  const random = rng(seed);
  const out = new Set();
  for (const d of shuffle(spread, random)) {
    const v = answer + d;
    if (v !== answer && v >= min) out.add(v);
    if (out.size >= n) break;
  }
  return [...out];
}

// ===== 都道府県 =====
export const REGIONS8 = {
  北海道: ['北海道'],
  東北: ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
  関東: ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'],
  中部: ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県'],
  近畿: ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'],
  中国: ['鳥取県', '島根県', '岡山県', '広島県', '山口県'],
  四国: ['徳島県', '香川県', '愛媛県', '高知県'],
  九州: ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'],
};
const NEXT_REGION = { 北海道: '東北', 東北: '関東', 関東: '中部', 中部: '近畿', 近畿: '中国', 中国: '四国', 四国: '九州', 九州: '中国' };
export const PREFS = Object.values(REGIONS8).flat();
export const regionOf = (pref) => Object.keys(REGIONS8).find((r) => REGIONS8[r].includes(pref));

// 同じ地方 → となりの地方 → 残り、の順にまちがいの都道府県を選ぶ
export function prefWrong(answer, seed) {
  const r = rng(seed);
  const region = regionOf(answer);
  if (!region) throw new Error(`都道府県名がおかしい: ${answer}`);
  const near = shuffle(REGIONS8[region].filter((p) => p !== answer), r);
  const next = shuffle(REGIONS8[NEXT_REGION[region]], r);
  const rest = shuffle(PREFS.filter((p) => p !== answer && !near.includes(p) && !next.includes(p)), r);
  return [...near, ...next, ...rest].slice(0, 3);
}
