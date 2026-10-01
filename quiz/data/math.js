// 数学: 正解はすべてプログラムで計算する（計算・単位換算・ローマ数字・図形・素数・2進数・数列など）
import { rng, shuffle } from '../lib.js';

// 数の問題を作る。候補から正解と違うものを3つ選び、足りなければ近い数でうめる
function numQ(q, answer, candidates, fmt = String) {
  const seen = new Set([answer]);
  const wrong = [];
  const pool = [...candidates];
  for (let d = 1; wrong.length + pool.length < 12 && d < 50; d++) pool.push(answer + d, answer - d);
  for (const c of pool) {
    if (!Number.isFinite(c) || c < 0 || seen.has(c)) continue;
    if (Number.isInteger(answer) && !Number.isInteger(c)) continue; // 答えが整数なら小数の選択肢は出さない
    seen.add(c);
    wrong.push(c);
    if (wrong.length === 3) break;
  }
  return { q, answer: fmt(answer), wrong: wrong.map(fmt) };
}

const comma = (n) => n.toLocaleString('en-US');
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

function roman(n) {
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of table) while (n >= v) { s += r; n -= v; }
  return s;
}

function isPrime(n) {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
}

function factorize(n) {
  const parts = [];
  for (let p = 2; p * p <= n; p++) {
    let e = 0;
    while (n % p === 0) { n /= p; e++; }
    if (e) parts.push(e === 1 ? `${p}` : `${p}^${e}`);
  }
  if (n > 1) parts.push(`${n}`);
  return parts.join('×');
}

export default {
  genre: '理数系',
  build() {
    const out = [];
    const r = rng('数学');
    const int = (a, b) => a + Math.floor(r() * (b - a + 1));

    // かけ算（2けた×1けた、2けた×2けた）
    for (let i = 0; i < 90; i++) {
      const a = int(12, 99), b = int(3, 9);
      out.push(numQ(`${a}×${b}は？`, a * b, [a * b + b, a * b - b, a * b + 10, a * b - 10]));
    }
    for (let i = 0; i < 90; i++) {
      const a = int(11, 39), b = int(11, 29);
      out.push(numQ(`${a}×${b}は？`, a * b, [a * b + a, a * b - b, a * b + 10, a * b - 10, a * b + 100]));
    }
    // たし算・ひき算
    for (let i = 0; i < 60; i++) {
      const a = int(120, 899), b = int(110, 899);
      out.push(numQ(`${a}＋${b}は？`, a + b, [a + b + 10, a + b - 10, a + b + 100, a + b - 1]));
    }
    for (let i = 0; i < 60; i++) {
      const a = int(500, 999), b = int(101, a - 50);
      out.push(numQ(`${a}−${b}は？`, a - b, [a - b + 10, a - b - 10, a - b + 100, a - b + 2]));
    }
    // わり算（わりきれる）
    for (let i = 0; i < 70; i++) {
      const b = int(3, 19), c = int(6, 49);
      out.push(numQ(`${b * c}÷${b}は？`, c, [c + 1, c - 1, c + 2, c + 10]));
    }
    // 2乗・平方根・3乗
    for (let n = 11; n <= 35; n++) out.push(numQ(`${n}の2乗は？`, n * n, [n * n + n, n * n - n, (n + 1) * (n + 1), (n - 1) * (n - 1)]));
    for (let n = 11; n <= 30; n++) out.push(numQ(`2乗すると${n * n}になる正の数は？`, n, [n + 1, n - 1, n + 2]));
    for (let n = 2; n <= 12; n++) out.push(numQ(`${n}の3乗は？`, n ** 3, [n ** 3 + n, n * n * 3, (n + 1) ** 3, (n - 1) ** 3]));
    for (let n = 2; n <= 12; n++) out.push(numQ(`2の${n}乗は？`, 2 ** n, [2 ** (n + 1), 2 ** (n - 1), 2 * n * 2]));

    // 割合
    const percents = [10, 20, 25, 30, 40, 50, 60, 75, 80, 5, 15, 35];
    for (let i = 0; i < 60; i++) {
      const p = percents[i % percents.length], base = int(2, 40) * 20;
      const ans = (base * p) / 100;
      if (!Number.isInteger(ans)) continue;
      out.push(numQ(`${base}の${p}%はいくつ？`, ans, [ans * 2, ans + 10, Math.round(ans / 2), ans + p]));
    }
    for (let i = 0; i < 30; i++) {
      const price = int(4, 40) * 100, off = [10, 20, 30, 50][i % 4];
      const ans = (price * (100 - off)) / 100;
      out.push(numQ(`${comma(price)}円の品物の${off}%引きの値段は？`, ans, [price - off, (price * off) / 100, ans - 100, ans + 100], (x) => `${comma(x)}円`));
    }

    // 分数のたし算（答えは約分）
    const frac = (n, d) => { const g = gcd(n, d); return d / g === 1 ? `${n / g}` : `${n / g}/${d / g}`; };
    const fracSeen = new Set();
    for (let i = 0; i < 80 && fracSeen.size < 40; i++) {
      const d1 = int(2, 6), d2 = int(2, 7);
      if (d1 === d2) continue;
      const key = `${d1}-${d2}`;
      if (fracSeen.has(key)) continue;
      fracSeen.add(key);
      const ans = frac(d1 + d2, d1 * d2);
      const wrong = [...new Set([`2/${d1 + d2}`, frac(2, d1 * d2), frac(d1 + d2 + 1, d1 * d2), frac(d1 + d2 - 1, d1 * d2), `1/${d1 + d2}`])].filter((x) => x !== ans).slice(0, 3);
      if (wrong.length === 3) out.push({ q: `1/${d1}＋1/${d2}は？`, answer: ans, wrong });
    }

    // 単位の換算
    const conversions = [
      ['km', 'm', 1000], ['m', 'cm', 100], ['cm', 'mm', 10], ['kg', 'g', 1000], ['t', 'kg', 1000],
      ['L', 'mL', 1000], ['L', 'dL', 10], ['dL', 'mL', 100], ['ha', '㎡', 10000], ['a', '㎡', 100],
      ['時間', '分', 60], ['分', '秒', 60], ['日', '時間', 24], ['週間', '日', 7], ['㎢', 'ha', 100],
    ];
    for (const [from, to, rate] of conversions) {
      for (let k = 0; k < 8; k++) {
        const v = [2, 3, 4, 5, 6, 7, 8, 9, 12, 15][int(0, 9)] + k * 0;
        const value = k < 4 ? v : v + k;
        const ans = value * rate;
        out.push(numQ(`${value}${from}は何${to}？`, ans, [ans * 10, ans / 10, value * (rate === 60 ? 100 : rate * 10), ans + rate], (x) => `${comma(x)}${to}`));
      }
    }

    // ローマ数字
    const romanNumbers = shuffle(Array.from({ length: 2000 }, (_, i) => i + 1), rng('ローマ数字')).slice(0, 45);
    for (const n of romanNumbers) {
      const ans = roman(n);
      const wrong = [...new Set([roman(n + 1), roman(Math.max(1, n - 1)), roman(n + 10), roman(n + 5), roman(n + 100)])].filter((x) => x !== ans).slice(0, 3);
      out.push({ q: `${n}をローマ数字で書くと？`, answer: ans, wrong });
      out.push(numQ(`ローマ数字の「${ans}」は、いくつ？`, n, [n + 1, n - 1, n + 10, n - 10, n + 5]));
    }

    // 図形
    for (let n = 3; n <= 12; n++) {
      const sum = (n - 2) * 180;
      out.push(numQ(`${n}角形の内角の和は何度？`, sum, [sum + 180, sum - 180, n * 180, sum + 90], (x) => `${x}°`));
      if (n > 3) out.push(numQ(`${n}角形の対角線は全部で何本？`, (n * (n - 3)) / 2, [n * (n - 3), n, n - 3, (n * (n - 2)) / 2]));
      if (360 % n === 0) out.push(numQ(`正${n}角形の1つの外角は何度？`, 360 / n, [180 / n, 360 / n + 10, (n - 2) * 180 / n], (x) => `${x}°`));
      if (((n - 2) * 180) % n === 0) out.push(numQ(`正${n}角形の1つの内角は何度？`, ((n - 2) * 180) / n, [((n - 2) * 180) / n + 10, ((n - 2) * 180) / n - 10, 360 / n, 180], (x) => `${x}°`));
    }
    const solids = [['正四面体', 4, 6, 4], ['立方体', 6, 12, 8], ['正八面体', 8, 12, 6], ['正十二面体', 12, 30, 20], ['正二十面体', 20, 30, 12], ['三角柱', 5, 9, 6], ['四角すい', 5, 8, 5], ['五角柱', 7, 15, 10]];
    for (const [name, f, e, v] of solids) {
      out.push(numQ(`${name}の面の数は？`, f, [e, v, f + 2, f - 1]));
      out.push(numQ(`${name}の辺の数は？`, e, [f, v, e + 2, e - 3]));
      out.push(numQ(`${name}の頂点の数は？`, v, [f, e, v + 2, v - 2]));
    }
    for (let rad = 1; rad <= 10; rad++) {
      const area = Math.round(rad * rad * 314) / 100, around = Math.round(2 * rad * 314) / 100;
      out.push(numQ(`円周率を3.14とすると、半径${rad}cmの円の面積は何㎠？`, area, [around, Math.round(rad * 314) / 100, area * 2], (x) => `${x}㎠`));
      out.push(numQ(`円周率を3.14とすると、半径${rad}cmの円の円周は何cm？`, around, [area, around / 2, around * 2], (x) => `${Math.round(x * 100) / 100}cm`));
    }
    for (let i = 0; i < 20; i++) {
      const b = int(3, 20), h = int(2, 16);
      if ((b * h) % 2) continue;
      out.push(numQ(`底辺${b}cm、高さ${h}cmの三角形の面積は何㎠？`, (b * h) / 2, [b * h, b + h, (b * h) / 2 + b], (x) => `${x}㎠`));
    }

    // 素数・約数・倍数
    for (let i = 0; i < 40; i++) {
      const start = int(20, 200);
      let p = start;
      while (!isPrime(p)) p++;
      let next = p + 1;
      while (!isPrime(next)) next++;
      // p より小さい start 以上の数は合成数、p より大きい数は「いちばん小さい」ではないので、どれも不正解
      out.push(numQ(`${start}以上で、いちばん小さい素数は？`, p, [next, p + 2, p === start ? p + 4 : start, p - 2].filter((x) => x !== p)));
    }
    for (let i = 0; i < 40; i++) {
      const g = int(2, 12), a = g * int(2, 9), b = g * int(2, 9);
      if (a === b) continue;
      const ans = gcd(a, b);
      out.push(numQ(`${a}と${b}の最大公約数は？`, ans, [ans * 2, Math.max(1, ans / 2), ans + 1, a - b > 0 ? a - b : b - a]));
      const l = (a * b) / ans;
      out.push(numQ(`${a}と${b}の最小公倍数は？`, l, [a * b, l * 2, l / 2, l + ans]));
    }
    const factorTargets = shuffle(Array.from({ length: 180 }, (_, i) => i + 20).filter((n) => !isPrime(n)), rng('素因数分解')).slice(0, 30);
    for (const n of factorTargets) {
      const ans = factorize(n);
      const wrong = [...new Set([factorize(n + 2), factorize(n - 2), factorize(n + 4), factorize(n * 2)])].filter((x) => x !== ans && x.includes('×')).slice(0, 3);
      if (wrong.length === 3) out.push({ q: `${n}を素因数分解すると？（^は累乗）`, answer: ans, wrong });
    }
    for (let n = 12; n <= 60; n += 4) {
      let count = 0;
      for (let d = 1; d <= n; d++) if (n % d === 0) count++;
      out.push(numQ(`${n}の約数は全部でいくつ？`, count, [count + 1, count - 1, count + 2]));
    }

    // 2進数
    for (let i = 0; i < 30; i++) {
      const n = int(5, 63);
      out.push(numQ(`2進数の「${n.toString(2)}」を10進数にすると？`, n, [n + 1, n - 1, n * 2, n + 2]));
    }
    for (let i = 0; i < 20; i++) {
      const n = int(5, 40);
      const ans = n.toString(2);
      const wrong = [...new Set([(n + 1).toString(2), (n - 1).toString(2), (n * 2).toString(2), (n + 2).toString(2)])].filter((x) => x !== ans).slice(0, 3);
      out.push({ q: `10進数の${n}を2進数で書くと？`, answer: ans, wrong });
    }

    // 数列の次の数
    for (let i = 0; i < 25; i++) {
      const a = int(1, 20), d = int(2, 13);
      const seq = [0, 1, 2, 3].map((k) => a + d * k);
      out.push(numQ(`${seq.join('、')}、…の次の数は？`, a + d * 4, [a + d * 5, a + d * 4 + 1, a + d * 4 - d + 1]));
    }
    for (let i = 0; i < 20; i++) {
      const a = int(1, 5), m = int(2, 4);
      const seq = [0, 1, 2, 3].map((k) => a * m ** k);
      out.push(numQ(`${seq.join('、')}、…の次の数は？`, a * m ** 4, [a * m ** 3 * 2 + a, a * m ** 3 + a * m ** 2, a * m ** 4 + m]));
    }
    for (let s = 1; s <= 8; s++) {
      const seq = [0, 1, 2, 3, 4].map((k) => (s + k) ** 2);
      out.push(numQ(`${seq.join('、')}、…の次の数は？`, (s + 5) ** 2, [(s + 5) ** 2 + 1, (s + 4) ** 2 + 2 * (s + 4), (s + 5) ** 2 - 2]));
    }

    // 時こくと速さと平均
    for (let i = 0; i < 30; i++) {
      const h = int(6, 11), m = int(0, 11) * 5, addH = int(1, 4), addM = int(1, 11) * 5;
      const total = h * 60 + m + addH * 60 + addM;
      const fmt = (t) => `${Math.floor(t / 60) >= 12 ? '午後' : '午前'}${Math.floor(t / 60) % 12 || 12}時${t % 60 === 0 ? '' : `${t % 60}分`}`;
      const ans = fmt(total);
      const wrong = [...new Set([fmt(total + 10), fmt(total - 10), fmt(total + 60), fmt(total - 60)])].filter((x) => x !== ans).slice(0, 3);
      out.push({ q: `午前${h}時${m ? `${m}分` : ''}の${addH}時間${addM}分後は何時何分？`, answer: ans, wrong });
    }
    for (let i = 0; i < 30; i++) {
      const v = int(3, 12) * 10, t = [1, 2, 3, 1.5, 2.5, 0.5][i % 6];
      const tText = t === 0.5 ? '30分' : Number.isInteger(t) ? `${t}時間` : `${Math.floor(t)}時間30分`;
      out.push(numQ(`時速${v}kmで${tText}進むと何km？`, v * t, [v * t + v, v * t - 10, v + t * 10], (x) => `${x}km`));
    }
    for (let i = 0; i < 25; i++) {
      const nums = [int(1, 20), int(1, 20), int(1, 20)];
      const sum = nums[0] + nums[1] + nums[2];
      const extra = (3 - (sum % 3)) % 3;
      nums[2] += extra;
      const avg = (sum + extra) / 3;
      out.push(numQ(`${nums.join('、')}の3つの数の平均は？`, avg, [avg + 1, avg - 1, sum + extra, avg + 2]));
    }

    // 数の単位など（知識）
    const facts = [
      ['1万の1万倍は？', '1億', ['10万', '1000万', '1兆']],
      ['1億の1万倍は？', '1兆', ['10億', '1000億', '1京']],
      ['1兆の1万倍は？', '1京', ['1垓', '10兆', '1000兆']],
      ['「京」の1万倍の数の単位は？', '垓', ['那由多', '溝', '澗']],
      ['1ダースは何個？', '12個', ['10個', '20個', '24個']],
      ['1グロスは何個？', '144個', ['100個', '120個', '1000個']],
      ['1割を百分率で表すと？', '10%', ['1%', '0.1%', '100%']],
      ['歩合で「3割5分」を百分率で表すと？', '35%', ['3.5%', '305%', '0.35%']],
      ['三角形の3つの内角の和は何度？', '180°', ['90°', '270°', '360°']],
      ['円周率の値は、およそいくつ？', '3.14', ['2.72', '1.41', '1.73']],
      ['直角は何度？', '90°', ['45°', '180°', '60°']],
      ['ピタゴラスの定理は、どんな三角形の辺の長さの関係を表す？', '直角三角形', ['正三角形', '二等辺三角形', '鈍角三角形']],
      ['直角三角形で、直角をはさむ2辺が3と4のとき、斜辺の長さは？', '5', ['6', '7', '4.5']],
      ['直角三角形で、直角をはさむ2辺が5と12のとき、斜辺の長さは？', '13', ['17', '15', '14']],
      ['1から10までの整数をすべて足すといくつ？', '55', ['50', '45', '100']],
      ['1から100までの整数をすべて足すといくつ？', '5050', ['5000', '10100', '4950']],
      ['0の階乗「0!」の値は？', '1', ['0', '無限大', '定義されない']],
      ['5の階乗「5!」の値は？', '120', ['25', '60', '720']],
      ['1年（うるう年でない年）は何日？', '365日', ['360日', '364日', '366日']],
      ['2番目に小さい素数は？', '3', ['2', '5', '1']],
      ['いちばん小さい素数は？', '2', ['1', '3', '0']],
      ['偶数でもあり素数でもある数は？', '2', ['4', '0', '1']],
      ['正方形の対角線は何本？', '2本', ['1本', '4本', '3本']],
      ['円の中心を通り、円周上の2点を結ぶ線分を何という？', '直径', ['半径', '弦', '弧']],
      ['√2の値は、およそいくつ？', '1.414', ['1.732', '2.236', '1.618']],
      ['√3の値は、およそいくつ？', '1.732', ['1.414', '2.236', '1.618']],
      ['黄金比は、およそ1対いくつ？', '1.618', ['1.414', '1.732', '2.718']],
      ['自然対数の底「e」の値は、およそいくつ？', '2.718', ['3.141', '1.618', '1.414']],
      ['360度は、何ラジアン？', '2π', ['π', '4π', 'π/2']],
      ['180度は、何ラジアン？', 'π', ['2π', 'π/2', '1']],
    ];
    for (const [q, answer, wrong] of facts) out.push({ q, answer, wrong });

    return out;
  },
};
