// ランクマッチのレート（イロレーティング）と段級位

export const START_RATING = 1500;
const K = 32;              // 1回の対戦でのレートの動きやすさ
const K_NEW = 48;          // はじめのうちは大きく動かして、早く実力に近づける
const PROVISIONAL_GAMES = 10;

// 1250未満が10級。50ごとに1つ上がり、1750で初段、2200以上が名人。はじめの1500は5級
const TITLES = ['10級', '9級', '8級', '7級', '6級', '5級', '4級', '3級', '2級', '1級', '初段', '二段', '三段', '四段', '五段', '六段', '七段', '八段', '九段', '名人'];

export function rankTitle(rating) {
  const i = Math.floor((rating - 1250) / 50);
  return TITLES[Math.max(0, Math.min(TITLES.length - 1, i))];
}

// 対戦結果からレートを計算する。entries: [{ id, rating, games, place }]（place は順位。同じなら引き分け）
// 相手1人ずつと勝ち負けを比べ、その平均でレートを動かす（2人対戦なら、ふつうのイロレーティングと同じ）
export function updateRatings(entries) {
  const n = entries.length;
  return entries.map((a) => {
    let sum = 0;
    for (const b of entries) {
      if (b === a) continue;
      const expected = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
      const actual = a.place < b.place ? 1 : a.place === b.place ? 0.5 : 0;
      sum += actual - expected;
    }
    const k = a.games < PROVISIONAL_GAMES ? K_NEW : K;
    const delta = Math.round((k * sum) / (n - 1));
    return { id: a.id, before: a.rating, after: a.rating + delta, delta };
  });
}
