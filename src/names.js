// 名前のきまり
// ランクマッチでは知らない人やランキングにも名前が出るので、ふさわしくない言葉をふくむ名前は使えない
// （この一覧だけで防ぎきれないものは、通報が集まると使えなくなる → ladder.js）

export function cleanName(name) {
  const text = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return Array.from(text).slice(0, 10).join('') || 'ななし';
}

// 全角・半角、カタカナ・ひらがな、大文字・小文字、空白や記号のちがいをならして比べる
function normalize(text) {
  return String(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s_\-・.,、。!?~〜ー*'"`^|/\\()[\]{}<>]/g, '')
    .replace(/0/g, 'o')
    .replace(/[1!]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's');
}

// 性的なことば・差別のことば・暴力や脅しのことば
// （「ちんちん電車」「かたわら」「grape」「peacock」のように、ふつうの名前まで止めてしまうことばは入れない）
const NG_WORDS = [
  // 日本語
  'ちんこ', 'ちんぽ', 'まんこ', 'ぺにす', 'せっくす', 'ふぇら', 'くんに', 'れいぷ', 'ぱいずり', 'おなにー',
  'えろ動画', 'av女優', '中出し', '強姦', '輪姦', '売春', '援交', '援助交際', '風俗嬢', '痴漢', '盗撮', '全裸', '精液', '陰毛', '陰部',
  'きちがい', '気違い', 'きちげ', 'がいじ', '池沼', 'つんぼ', '不具者',
  'しねよ', '死ね', '氏ね', 'しんでしまえ', 'ころすぞ', '殺す', 'ぶっころ', 'ぶっ殺', '殺人予告', 'ばくはよこく', '爆破予告', 'てろ予告',
  '支那人', 'じゃっぷ',
  // 英語
  'fuck', 'shit', 'bitch', 'cunt', 'pussy', 'penis', 'vagina', 'porn', 'sex', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'nazi', 'hitler', 'killyou',
].map(normalize);

export function isBadName(name) {
  const text = normalize(name);
  return NG_WORDS.some((w) => text.includes(w));
}
