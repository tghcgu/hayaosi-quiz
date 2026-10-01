// 英語: 英単語（英⇔日）・不規則動詞・複数形・反対語・カタカナ語
// まちがいの選択肢は同じグループから選ぶ。意味がかぶる単語（big/large など）は片方だけ入れる
import { makeQ, pickOne } from '../lib.js';

const WORDS = {
  動物: `dog=犬
cat=猫
horse=馬
cow=牛
pig=豚
sheep=羊
goat=ヤギ
rabbit=ウサギ
mouse=ネズミ
bear=クマ
tiger=トラ
elephant=ゾウ
monkey=サル
giraffe=キリン
zebra=シマウマ
fox=キツネ
wolf=オオカミ
deer=シカ
squirrel=リス
frog=カエル
snake=ヘビ
whale=クジラ
dolphin=イルカ
shark=サメ
octopus=タコ
squid=イカ
crab=カニ
bee=ハチ
butterfly=チョウ
ant=アリ
spider=クモ
owl=フクロウ
eagle=ワシ
crow=カラス
swan=ハクチョウ
camel=ラクダ
hippopotamus=カバ
rhinoceros=サイ
leopard=ヒョウ
raccoon=アライグマ
hedgehog=ハリネズミ
lizard=トカゲ
crocodile=ワニ
jellyfish=クラゲ
starfish=ヒトデ
snail=カタツムリ
mosquito=蚊
dragonfly=トンボ
grasshopper=バッタ
ladybug=テントウムシ
parrot=オウム
pigeon=ハト
sparrow=スズメ
peacock=クジャク
chicken=ニワトリ
ostrich=ダチョウ
turtle=カメ
salmon=サケ
tuna=マグロ
eel=ウナギ`,
  食べ物: `bread=パン
rice=米
egg=卵
milk=牛乳
sugar=砂糖
salt=塩
pepper=こしょう
meat=肉
beef=牛肉
pork=豚肉
fish=魚
noodle=麺
flour=小麦粉
vinegar=酢
honey=はちみつ
tea=お茶
water=水
candy=あめ
breakfast=朝食
lunch=昼食
dinner=夕食
bean=豆
oil=油
soy sauce=しょうゆ
seaweed=海藻
vegetable=野菜
fruit=果物`,
  果物と野菜: `apple=りんご
banana=バナナ
grape=ぶどう
peach=もも
pear=梨
strawberry=いちご
cherry=さくらんぼ
lemon=レモン
watermelon=すいか
pineapple=パイナップル
persimmon=柿
chestnut=栗
potato=じゃがいも
sweet potato=さつまいも
carrot=にんじん
onion=たまねぎ
cabbage=キャベツ
lettuce=レタス
tomato=トマト
cucumber=きゅうり
eggplant=なす
pumpkin=かぼちゃ
spinach=ほうれん草
mushroom=きのこ
corn=とうもろこし
garlic=にんにく
ginger=しょうが
green pepper=ピーマン
peanut=落花生
walnut=くるみ`,
  体: `head=頭
face=顔
eye=目
ear=耳
nose=鼻
mouth=口
tooth=歯
tongue=舌
lip=くちびる
neck=首
shoulder=肩
arm=腕
elbow=ひじ
hand=手
finger=手の指
thumb=親指
chest=胸
stomach=胃
back=背中
knee=ひざ
foot=足
toe=足の指
heel=かかと
ankle=足首
wrist=手首
hair=髪
skin=皮膚
bone=骨
heart=心臓
lung=肺
brain=脳
blood=血
cheek=ほお
chin=あご
forehead=額
eyebrow=まゆ毛
throat=のど`,
  人: `father=父
mother=母
brother=兄弟
sister=姉妹
son=息子
daughter=娘
grandfather=祖父
grandmother=祖母
uncle=おじ
aunt=おば
cousin=いとこ
husband=夫
wife=妻
baby=赤ちゃん
child=子ども
boy=男の子
girl=女の子
friend=友達
neighbor=隣人
parent=親
grandchild=孫
twin=ふたご
adult=大人
king=王
queen=女王
prince=王子
princess=王女`,
  家と道具: `house=家
room=部屋
door=ドア
window=窓
wall=壁
floor=床
roof=屋根
ceiling=天井
stairs=階段
kitchen=台所
bathroom=浴室
garden=庭
gate=門
bed=ベッド
chair=いす
desk=机
shelf=棚
clock=時計
mirror=鏡
key=かぎ
umbrella=かさ
box=箱
bottle=びん
dish=皿
spoon=スプーン
fork=フォーク
chopsticks=はし
pot=なべ
kettle=やかん
towel=タオル
soap=石けん
candle=ろうそく
blanket=毛布
pillow=まくら
curtain=カーテン
carpet=じゅうたん
refrigerator=冷蔵庫
telephone=電話
stamp=切手
envelope=封筒
newspaper=新聞
magazine=雑誌
map=地図
ticket=切符
wallet=財布
coin=硬貨
bag=かばん
basket=かご
ladder=はしご
rope=なわ
needle=針
thread=糸
scissors=はさみ
hammer=かなづち`,
  学校: `school=学校
teacher=先生
student=生徒
classroom=教室
blackboard=黒板
pencil=鉛筆
eraser=消しゴム
ruler=定規
notebook=ノート
textbook=教科書
dictionary=辞書
library=図書館
homework=宿題
test=試験
question=質問
answer=答え
lesson=授業
playground=運動場
gym=体育館
principal=校長
uniform=制服
glue=のり
math=数学
science=理科
history=歴史
geography=地理
music=音楽
art=美術`,
  服: `shirt=シャツ
coat=コート
jacket=上着
sweater=セーター
skirt=スカート
pants=ズボン
shoe=くつ
sock=くつ下
hat=帽子
glove=手袋
belt=ベルト
pocket=ポケット
button=ボタン
collar=えり
sleeve=そで
tie=ネクタイ
glasses=めがね
ring=指輪
necklace=ネックレス
pajamas=パジャマ
underwear=下着`,
  自然: `sun=太陽
moon=月
star=星
sky=空
cloud=雲
rain=雨
snow=雪
wind=風
thunder=雷
rainbow=にじ
storm=嵐
fog=霧
ice=氷
mountain=山
river=川
lake=湖
sea=海
island=島
forest=森
tree=木
flower=花
leaf=葉
grass=草
sand=砂
stone=石
hill=丘
valley=谷
volcano=火山
earthquake=地震
wave=波
beach=浜辺
desert=砂漠
cave=ほら穴
waterfall=滝
fire=火
earth=地球
spring=春
summer=夏
autumn=秋
winter=冬
season=季節`,
  場所: `station=駅
hospital=病院
post office=郵便局
bank=銀行
park=公園
museum=博物館
zoo=動物園
aquarium=水族館
airport=空港
restaurant=レストラン
hotel=ホテル
shop=店
market=市場
church=教会
temple=寺
shrine=神社
castle=城
bridge=橋
road=道路
tower=塔
factory=工場
farm=農場
police station=警察署
fire station=消防署
city hall=市役所
bookstore=書店
bakery=パン屋
stadium=競技場
theater=劇場
office=事務所
village=村
town=町
country=国`,
  乗り物: `car=車
bus=バス
train=電車
bicycle=自転車
airplane=飛行機
ship=船
truck=トラック
taxi=タクシー
subway=地下鉄
helicopter=ヘリコプター
motorcycle=オートバイ
ambulance=救急車
fire engine=消防車
rocket=ロケット`,
  仕事: `doctor=医者
nurse=看護師
police officer=警察官
firefighter=消防士
farmer=農家
cook=料理人
pilot=パイロット
dentist=歯医者
lawyer=弁護士
scientist=科学者
artist=芸術家
singer=歌手
actor=俳優
writer=作家
painter=画家
carpenter=大工
fisherman=漁師
soldier=兵士
astronaut=宇宙飛行士
engineer=技術者
musician=音楽家
photographer=写真家
barber=理容師
librarian=司書`,
  色: `red=赤
blue=青
yellow=黄色
green=緑
white=白
black=黒
purple=紫
pink=ピンク
brown=茶色
gray=灰色
gold=金色
silver=銀色`,
  数: `eleven=11
twelve=12
thirteen=13
fifteen=15
twenty=20
thirty=30
forty=40
fifty=50
ninety=90
hundred=100
thousand=1000
million=100万
billion=10億
first=1番目
third=3番目
fifth=5番目
ninth=9番目
twelfth=12番目`,
  月: `January=1月
February=2月
March=3月
April=4月
May=5月
June=6月
July=7月
August=8月
September=9月
October=10月
November=11月
December=12月`,
  曜日: `Sunday=日曜日
Monday=月曜日
Tuesday=火曜日
Wednesday=水曜日
Thursday=木曜日
Friday=金曜日
Saturday=土曜日`,
  動作: `eat=食べる
drink=飲む
run=走る
walk=歩く
swim=泳ぐ
sing=歌う
dance=踊る
write=書く
read=読む
sleep=眠る
buy=買う
sell=売る
open=開ける
close=閉める
begin=始める
finish=終える
come=来る
go=行く
give=与える
take=取る
make=作る
wash=洗う
cut=切る
push=押す
pull=引く
throw=投げる
catch=捕まえる
jump=跳ぶ
fly=飛ぶ
climb=登る
fall=落ちる
sit=座る
stand=立つ
laugh=笑う
cry=泣く
think=考える
know=知っている
learn=学ぶ
teach=教える
remember=覚えている
forget=忘れる
listen=聞く
speak=話す
say=言う
ask=たずねる
help=助ける
wait=待つ
carry=運ぶ
build=建てる
break=壊す
fix=直す
draw=線で描く
choose=選ぶ
change=変える
use=使う
find=見つける
win=勝つ
borrow=借りる
lend=貸す
send=送る
receive=受け取る
arrive=到着する
grow=育つ
live=住む
die=死ぬ
smile=ほほえむ
shout=叫ぶ
hide=隠す
kick=ける
hit=打つ
hold=持つ
drive=運転する
ride=乗る
travel=旅行する
visit=訪問する
invite=招待する
believe=信じる
hope=望む
worry=心配する
agree=賛成する
explain=説明する
decide=決める
practice=練習する
dig=掘る
pour=注ぐ`,
  ようす: `big=大きい
small=小さい
long=長い
short=短い
tall=背が高い
expensive=値段が高い
cheap=安い
hot=暑い
cold=寒い
warm=暖かい
cool=涼しい
new=新しい
old=古い
young=若い
fast=速い
slow=遅い
heavy=重い
strong=強い
weak=弱い
easy=簡単な
difficult=難しい
happy=幸せな
sad=悲しい
angry=怒った
tired=疲れた
hungry=空腹の
sleepy=眠い
busy=忙しい
rich=金持ちの
poor=貧しい
beautiful=美しい
ugly=醜い
dirty=汚い
quiet=静かな
noisy=騒がしい
bright=明るい
dark=暗い
wide=幅が広い
narrow=狭い
deep=深い
shallow=浅い
thick=厚い
soft=柔らかい
sweet=甘い
bitter=苦い
sour=すっぱい
salty=しょっぱい
spicy=辛い
kind=親切な
brave=勇敢な
famous=有名な
important=大切な
dangerous=危険な
safe=安全な
empty=空っぽの
round=丸い
sharp=鋭い
dry=乾いた
wet=ぬれた
sick=病気の
healthy=健康な`,
  ことがら: `love=愛
peace=平和
war=戦争
dream=夢
death=死
truth=真実
freedom=自由
luck=運
courage=勇気
memory=記憶
idea=考え
secret=秘密
promise=約束
mistake=間違い
problem=問題
reason=理由
future=未来
past=過去`,
  時: `morning=朝
noon=正午
afternoon=午後
evening=夕方
night=夜
today=今日
tomorrow=明日
yesterday=昨日
week=週
year=年
century=世紀
minute=分
weekend=週末
holiday=休日
birthday=誕生日
midnight=真夜中`,
  スポーツ: `baseball=野球
soccer=サッカー
tennis=テニス
swimming=水泳
basketball=バスケットボール
volleyball=バレーボール
table tennis=卓球
wrestling=レスリング
horse racing=競馬
fishing=釣り
mountain climbing=登山`,
  国: `Japan=日本
China=中国
Korea=韓国
France=フランス
Germany=ドイツ
Spain=スペイン
Italy=イタリア
Egypt=エジプト
India=インド
Greece=ギリシャ
Netherlands=オランダ
Switzerland=スイス
Sweden=スウェーデン
Norway=ノルウェー
Finland=フィンランド
Poland=ポーランド
Turkey=トルコ
Thailand=タイ
Vietnam=ベトナム
Brazil=ブラジル
Mexico=メキシコ
Canada=カナダ
Australia=オーストラリア
New Zealand=ニュージーランド
Russia=ロシア
Portugal=ポルトガル
Belgium=ベルギー
Austria=オーストリア
Denmark=デンマーク
Ireland=アイルランド
Hungary=ハンガリー
Argentina=アルゼンチン
Peru=ペルー
Chile=チリ
Philippines=フィリピン
Indonesia=インドネシア
Malaysia=マレーシア
Singapore=シンガポール
Mongolia=モンゴル
Kenya=ケニア
Morocco=モロッコ
Cuba=キューバ
Iceland=アイスランド`,
};

// 不規則動詞: 原形 過去形 過去分詞
const IRREGULAR = `go went gone
eat ate eaten
see saw seen
take took taken
come came come
give gave given
write wrote written
run ran run
swim swam swum
sing sang sung
drink drank drunk
begin began begun
buy bought bought
think thought thought
bring brought brought
catch caught caught
teach taught taught
fly flew flown
know knew known
grow grew grown
throw threw thrown
draw drew drawn
speak spoke spoken
break broke broken
choose chose chosen
drive drove driven
ride rode ridden
rise rose risen
forget forgot forgotten
sit sat sat
stand stood stood
understand understood understood
make made made
say said said
pay paid paid
tell told told
sell sold sold
hold held held
find found found
feel felt felt
keep kept kept
sleep slept slept
leave left left
meet met met
lose lost lost
send sent sent
spend spent spent
build built built
fall fell fallen
hear heard heard
wear wore worn
bite bit bitten
hide hid hidden
shake shook shaken
steal stole stolen
wake woke woken
win won won
tear tore torn
freeze froze frozen
lead led led
feed fed fed
dig dug dug
sting stung stung
swing swung swung
stick stuck stuck
strike struck struck
shoot shot shot
lend lent lent
bend bent bent
blow blew blown
fight fought fought
seek sought sought
do did done
become became become
forgive forgave forgiven
beat beat beaten
ring rang rung
sink sank sunk`;

// 複数形: 単数 正解 まちがい3つ
const PLURALS = `child children childs childrens childes
mouse mice mouses mices meese
foot feet foots feets footes
tooth teeth tooths teeths toothes
man men mans mens manes
woman women womans womens womanes
goose geese gooses geeses goosen
ox oxen oxes oxs oxens
sheep sheep sheeps sheepes sheepen
leaf leaves leafs leafes leavs
knife knives knifes knifs knivs
wife wives wifes wifs wivs
wolf wolves wolfs wolfes wolvs
half halves halfs halfes halvs
potato potatoes potatos potatose potatoies
tomato tomatoes tomatos tomatose tomatoies
hero heroes heros heroies heroen
city cities citys cityes citis
baby babies babys babyes babis
box boxes boxs boxies boxen
bus buses buss busies busen
watch watches watchs watchies watchen
dish dishes dishs dishies dishen
photo photos photoes photies photoen
piano pianos pianoes pianies pianoen`;

// 反対の意味のペア
const OPPOSITES = `hot cold
big small
long short
new old
fast slow
strong weak
easy difficult
happy sad
rich poor
clean dirty
quiet noisy
bright dark
wide narrow
deep shallow
thick thin
safe dangerous
empty full
dry wet
sick healthy
true false
beautiful ugly
expensive cheap
early late
open close
buy sell
push pull
come go
remember forget
borrow lend
laugh cry
up down
left right
north south
east west
top bottom
day night
question answer
war peace
love hate
alive dead
before after
first last
inside outside
always never
arrive leave
win lose
heavy light
young old
begin end`;

// カタカナ語 = 意味
const KATAKANA = `アジェンダ=議題
エビデンス=証拠
コンセンサス=合意
イノベーション=技術革新
インフラ=社会基盤
オファー=申し込み
キャパシティ=収容能力
クオリティ=品質
コスト=費用
コンプライアンス=法令遵守
スキーム=計画の枠組み
ソリューション=解決策
タスク=作業
ニーズ=必要性
ノウハウ=技術的な知識
バリアフリー=障害を取り除くこと
ビジョン=将来像
フィードバック=意見を返すこと
プライオリティ=優先順位
ペンディング=保留
マニュアル=手引き書
メリット=利点
デメリット=欠点
モチベーション=意欲
リスク=危険性
リテラシー=活用する能力
ロジック=論理
アウトソーシング=外部委託
アカウンタビリティ=説明責任
インバウンド=訪日外国人旅行
ガイドライン=指針
コミュニケーション=意思疎通
コラボレーション=共同制作
サステナブル=持続可能な
スケジュール=予定
セキュリティ=安全対策
ターゲット=標的
デッドライン=締め切り
トレンド=流行
ネガティブ=否定的な
ポジティブ=肯定的な
パートナー=相棒
ヒアリング=聞き取り調査
ファクト=事実
プロセス=過程
ポテンシャル=潜在能力
マイノリティ=少数派
マジョリティ=多数派
モラル=道徳
リーダーシップ=統率力
リサイクル=再利用
リニューアル=改装
ルーティン=決まった手順
レイアウト=配置
アポイント=面会の約束
イベント=行事
インセンティブ=報奨
オプション=選択肢
カテゴリー=分類
キャンセル=取り消し
クライアント=顧客
コンテンツ=中身
コンセプト=基本的な考え方
サンプル=見本
シミュレーション=模擬実験
スペース=空間
ダイジェスト=要約版
テーマ=主題
ドナー=提供者
ニュアンス=微妙な意味合い
ノルマ=課された仕事量
ビギナー=初心者
プレゼンテーション=発表
ブランク=空白期間
ボランティア=自発的な奉仕活動
マーケット=市場
ミッション=使命
メソッド=方法
ユーザー=利用者
リアクション=反応
リーズナブル=手頃な
レンタル=貸し出し
アイデンティティ=自己同一性
エコロジー=生態学
オリジナル=独自のもの
ハザードマップ=被害予測地図
ユニバーサルデザイン=誰もが使いやすい設計
ライフライン=生活に欠かせない水道や電気など
ワークショップ=参加型の講習会
ストレス=心身の負担
データ=資料
シンプル=単純な
スタッフ=職員`;

function parsePairs(text, sep = '=') {
  return text.trim().split('\n').map((line) => {
    const i = line.indexOf(sep);
    return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
  });
}

function regularPast(base) {
  if (base.endsWith('e')) return base + 'd';
  if (/[^aeiou]y$/.test(base)) return base.slice(0, -1) + 'ied';
  return base + 'ed';
}

export default {
  genre: 'ことば・文学',
  build() {
    const out = [];

    // 同じ日本語訳が2つあると、選択肢に正解が2つ入ってしまうので止める
    const meanings = new Map();
    for (const [group, text] of Object.entries(WORDS)) {
      for (const [en, ja] of parsePairs(text)) {
        if (meanings.has(ja)) throw new Error(`英単語の訳がかぶっています: ${ja} (${meanings.get(ja)} / ${en})`);
        meanings.set(ja, en);
      }
    }

    for (const [group, text] of Object.entries(WORDS)) {
      const pairs = parsePairs(text);
      const ens = pairs.map(([en]) => en);
      const jas = pairs.map(([, ja]) => ja);
      for (const [en, ja] of pairs) {
        const q1 = pickOne([`英単語「${en}」の意味は？`, `「${en}」を日本語にすると？`, `英語で「${en}」といえば何のこと？`], en);
        out.push(makeQ(q1, ja, jas));
        const q2 = group === '数'
          ? `数の「${ja}」を英語で言うと？`
          : pickOne([`「${ja}」を英語で言うと？`, `英語で「${ja}」は何という？`, `「${ja}」を表す英単語は？`], ja + group);
        out.push(makeQ(q2, en, ens));
      }
    }

    const verbs = IRREGULAR.trim().split('\n').map((l) => l.trim().split(/\s+/));
    const pasts = verbs.map((v) => v[1]);
    const participles = verbs.map((v) => v[2]);
    for (const [base, past, pp] of verbs) {
      const sameInitial = (x) => x[0] === base[0];
      const wrongPast = [regularPast(base), pp !== past ? pp : null].filter(Boolean);
      const qp = `英語の動詞「${base}」の過去形は？`;
      const extraPast = makeQ(qp, past, pasts, { n: 3 - wrongPast.length, filter: (x) => !wrongPast.includes(x) && sameInitial(x) })
        ?? makeQ(qp, past, pasts, { n: 3 - wrongPast.length, filter: (x) => !wrongPast.includes(x) });
      if (extraPast) out.push({ q: qp, answer: past, wrong: [...wrongPast, ...extraPast.wrong] });

      const wrongPp = [past !== pp ? past : null, regularPast(base)].filter(Boolean);
      const qpp = `英語の動詞「${base}」の過去分詞は？`;
      const extraPp = makeQ(qpp, pp, participles, { n: 3 - wrongPp.length, filter: (x) => !wrongPp.includes(x) });
      if (extraPp) out.push({ q: qpp, answer: pp, wrong: [...wrongPp, ...extraPp.wrong] });
    }

    for (const line of PLURALS.trim().split('\n')) {
      const [single, plural, ...wrong] = line.trim().split(/\s+/);
      out.push({ q: `英単語「${single}」の複数形は？`, answer: plural, wrong });
    }

    const opposites = OPPOSITES.trim().split('\n').map((l) => l.trim().split(/\s+/));
    const oppositeWords = opposites.flat();
    for (const [a, b] of opposites) {
      // 「old」のように反対語が2つある単語は、もう片方を選択肢から外す
      const partnersOf = (w) => opposites.filter((p) => p.includes(w)).flat();
      for (const [word, answer] of [[a, b], [b, a]]) {
        const q = `英語で「${word}」の反対の意味の単語は？`;
        const avoid = new Set([word, ...partnersOf(word)]);
        out.push(makeQ(q, answer, oppositeWords, { filter: (x) => !avoid.has(x) }));
      }
    }

    const kata = parsePairs(KATAKANA);
    const kataWords = kata.map(([k]) => k);
    const kataMeanings = kata.map(([, m]) => m);
    for (const [word, meaning] of kata) {
      out.push(makeQ(pickOne([`カタカナ語「${word}」の意味は？`, `「${word}」を日本語で言いかえると？`], word), meaning, kataMeanings));
      out.push(makeQ(`「${meaning}」という意味のカタカナ語は？`, word, kataWords));
    }

    return out;
  },
};
