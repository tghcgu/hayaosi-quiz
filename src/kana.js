// 文字入力形式で出す「正解の1文字＋まぎらわしい3文字」を作る

// 答えがひらがな・カタカナだけ（2〜8文字）の問題を、文字入力で出せる
export function isInputAnswer(answer) {
  return /^[ぁ-ゖァ-ヺー]{2,8}$/.test(answer);
}

// 選択肢を見ないと答えが1つに決まらない問題（「次のうち」「入っていないのは」「〇〇の作品は」など）
const NEEDS_CHOICES = /次のうち|ではない|でない|入っていない|入らない|数えられない|ふくまれない|含まれない|代表的な|の例は|の作品は|が生み出したキャラクター|がえがいた作品|が作曲した曲|の設計による建物|が設計した建物/;

// 文字入力で出してよい問題か
export function isInputQuestion(q) {
  return isInputAnswer(q.answer) && !NEEDS_CHOICES.test(q.q);
}

const toKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const isKata = (c) => /[ァ-ヺー]/.test(c);

// 形が似ている文字
const LOOK_HIRA = ['あおめぬ', 'ぬめの', 'いこりけ', 'うらつ', 'るろう', 'えんそ', 'きさちら', 'くへし', 'けはほ', 'こいに', 'すむお', 'せさと', 'たなに', 'ねれわ', 'はほまよ', 'まよほも', 'もしつ', 'ゆぬ', 'をと', 'てそ', 'みろる', 'ふぶ'];
const LOOK_KATA = ['シツソン', 'クワケタフウ', 'コユロヨエ', 'チテナ', 'ヌスメ', 'ハル', 'ヲヨラ', 'アマヤ', 'レルシ', 'リソノ', 'セヤ', 'ホネ', 'モキ', 'ミシ', 'カヤ', 'ロコ', 'ウワ', 'ヘノ'];

// 濁点・半濁点・小さい文字のちがい
const FAMILY_HIRA = ['かが', 'きぎ', 'くぐ', 'けげ', 'こご', 'さざ', 'しじ', 'すず', 'せぜ', 'そぞ', 'ただ', 'ちぢ', 'つづっ', 'てで', 'とど', 'はばぱ', 'ひびぴ', 'ふぶぷ', 'へべぺ', 'ほぼぽ', 'やゃ', 'ゆゅ', 'よょ', 'あぁ', 'いぃ', 'うぅゔ', 'えぇ', 'おぉ', 'わゎ'];

// 五十音表の行（同じ行の文字もまぎらわしい）
const ROWS_HIRA = ['あいうえお', 'かきくけこ', 'さしすせそ', 'たちつてと', 'なにぬねの', 'はひふへほ', 'まみむめも', 'やゆよ', 'らりるれろ', 'わをん', 'がぎぐげご', 'ざじずぜぞ', 'だぢづでど', 'ばびぶべぼ', 'ぱぴぷぺぽ'];
const ALL_HIRA = ROWS_HIRA.join('');

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 正解の文字を1つふくむ、4つの文字をならべて返す
export function letterChoices(correct) {
  const kata = isKata(correct);
  const conv = (s) => (kata ? toKata(s) : s);
  const groups = (list) => list.map(conv).filter((g) => g.includes(correct)).join('');

  const picked = [];
  const take = (chars, limit) => {
    for (const c of shuffle([...new Set(chars)])) {
      if (picked.length >= limit) break;
      if (c !== correct && !picked.includes(c) && c !== 'ヽ') picked.push(c);
    }
  };

  if (correct === 'ー') take('ンッイウ', 2);
  // 形が似ている文字・濁点のちがいから2つまで、残りは同じ行や全体から
  take(groups(kata ? [...LOOK_KATA, ...LOOK_HIRA.map(toKata)] : LOOK_HIRA) + groups(FAMILY_HIRA), 2);
  take(groups(ROWS_HIRA), 3);
  // 同じ段（母音が同じ）の文字
  const myRow = ROWS_HIRA.map(conv).find((row) => row.includes(correct));
  const pos = myRow ? [...myRow].indexOf(correct) : -1;
  if (pos >= 0) take(ROWS_HIRA.map((row) => [...conv(row)][pos]).filter(Boolean).join(''), 3);
  take(conv(ALL_HIRA) + (kata ? 'ー' : ''), 3);

  return shuffle([correct, ...picked.slice(0, 3)]);
}
