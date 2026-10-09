# 引き継ぎ書（早押しクイズロワイヤル）

最終更新: 2026-10-09

パソコンが壊れても、ここを読めば続きができるようにまとめています。
遊び方と仕組みは [README.md](README.md)、Google Play の入力内容は [store/](store/) にあります。

> このリポジトリは**公開**されています。パスワード・メールアドレス・署名鍵は、ここにもコミットにも書かないでください。

## 1. いまの状態

| 項目 | 内容 |
| --- | --- |
| 公開中のサイト | https://hayaoshi-quiz-royale.qoj.workers.dev |
| ソースコード | https://github.com/tghcgu/hayaosi-quiz （`main` ブランチ） |
| 本番のバージョン | `4db9ed7d`（2026-10-08 公開） |
| Android アプリ | `android/`（TWA）。パッケージ名 `io.github.tghcgu.hayaoshiroyale`、1.0.0（versionCode 1） |
| Google Play | 申請前。素材と入力内容の下書きは `store/` にそろっている |

できていること:

- 友だちと遊ぶ（4けたの部屋番号・招待リンク、最大8人、1人でも練習できる）
- 問題 10,005問（15ジャンル × 667問）。答え方は選択肢・文字入力・ミックス
- 画像クイズ 130問（拡大した写真がだんだん引いていく。写真は CC0）
- ランクマッチ（2人対戦・4人対戦、レート、10級〜名人、ランキング、NGワード・通報・ブロック・記録の削除）
- ブラウザ版とアプリ版は同じサイトなので、いっしょに対戦できる
- テスト（`test/`）とストア用素材（`store/`）

## 2. どこに何があるか

| もの | 置き場所 | パソコンが壊れたら |
| --- | --- | --- |
| ソースコード・問題・画像・ストア素材・テスト | GitHub | 残る |
| 公開中のサイト・ランクマッチの記録（レート・ランキング） | Cloudflare | 残る |
| **アプリの署名鍵**（`upload.jks`・`password.txt`） | このパソコンの `%USERPROFILE%\hayaoshi-android-key\` **だけ** | **なくなる。すぐパソコンの外にバックアップする** |
| ビルドしたアプリ（`.aab`・`.apk`） | `android/`（GitHub には上げていない） | 署名鍵があれば `android\build.cmd` で作り直せる |
| 画像クイズの元画像 | `quiz/images/cache/`（GitHub には上げていない） | `npm run images` のときに自動でダウンロードし直す |

### 署名鍵のバックアップ（いちばん大事）

- `C:\Users\tkt01\hayaoshi-android-key` フォルダごと、USBメモリや Google ドライブなど**パソコンの外**にコピーする
- `password.txt` の中身は、パスワード管理アプリなどにも控えておく
- GitHub には絶対に上げない（だれでもアプリの更新版を作れてしまう）
- なくしたとき
  - Google Play にまだアップロードしていない → 新しい鍵を作ればよい。`public/.well-known/assetlinks.json` の SHA-256 も新しい鍵のものに入れ替える
  - アップロードしたあと → Play Console の「アプリの署名」から**アップロード鍵のリセット**を申請できる（Google の手続きに数日かかる）

## 3. アカウント

| サービス | 使いみち | 見分け方 |
| --- | --- | --- |
| GitHub | ソースコード | ユーザー `tghcgu`、リポジトリ `hayaosi-quiz` |
| Cloudflare | サイトとサーバー（Workers + Durable Objects） | アカウント ID `1e21c4439f28615dfb7e3ad12b0c3658`、workers.dev のサブドメイン `qoj`、Worker 名 `hayaoshi-quiz-royale` |
| Google Play Console | アプリの公開 | これから登録 |

- Cloudflare のダッシュボードでは「Workers & Pages」→「hayaoshi-quiz-royale」にある（解析ツールは使っていないので、Web Analytics には出ない）
- アクセス数は、Worker のページの「メトリクス」で見られる

## 4. 新しいパソコンで続きをやる

1. 入れるもの
   - Git
   - Node.js 22 以上（作ったときは 24）
   - Google Chrome（画面のテストとストア画像を作るときだけ）
   - Android Studio（Android アプリをビルドするときだけ。SDK Manager で build-tools 36.1.0 も入れる）
2. コードを取ってくる

   ```
   git clone https://github.com/tghcgu/hayaosi-quiz.git
   cd hayaosi-quiz
   npm install
   ```

3. Cloudflare にログインする: `npx wrangler login` のあと `npx wrangler whoami` で、上のアカウント ID になっているか確かめる
4. 動くか確かめる: `npm run dev` を動かしたまま、別のターミナルで `npm test`
5. Android アプリをビルドするときは、署名鍵をバックアップから `%USERPROFILE%\hayaoshi-android-key\` に戻してから `android\build.cmd`
6. Claude Code で続けるときは、このフォルダを開くだけでよい（`CLAUDE.md` を自動で読む）。「HANDOVER.md を読んで続きをやって」と頼めば話が早い

## 5. よく使うコマンド

| やりたいこと | コマンド |
| --- | --- |
| 手元で動かす | `npm run dev` → http://localhost:8787 |
| サーバーのテスト（5本） | `npm test`（`npm run dev` を動かしたまま） |
| 画面のテスト（4本、Chrome を使う） | `npm run test:ui`（同上） |
| 本番でランクマッチを確かめる | PowerShell で `$env:WS_URL='wss://hayaoshi-quiz-royale.qoj.workers.dev/ws'; node test/ranked-smoke.cjs`（テスト用の記録は最後に消える） |
| 問題を作り直す | `npm run quiz`（`dev`・`deploy` の前にも自動で動く） |
| 画像クイズを作り直す | `npm run images` |
| 公開する | `npm run deploy` |
| Android アプリをビルドする | `android\build.cmd` |
| ストアのスクリーンショットを撮り直す | `npm run store:shots`（`npm run dev` を動かしたまま）→ `npm run store:images` |

PowerShell で `npm` がエラーになるときは `npm.cmd` を使う。

## 6. 変更を公開する手順

1. `npm test`（画面を変えたら `npm run test:ui` も）
2. `npm run deploy`
3. 本番でランクマッチを確かめる（上の表）
4. `git push`

ゲームの中身はサイト側にあるので、公開すればアプリにもすぐ反映される（アプリの作り直しは不要）。
アプリ名・アイコン・パッケージの設定を変えたときだけ作り直す。そのときは `android/app/build.gradle` の `versionCode` と `android/twa-manifest.json` の `appVersionCode` を1つ上げてから `android\build.cmd`。

## 7. Google Play 公開までの残り

- [ ] デベロッパー登録（25ドル・本人確認）
- [ ] アプリを作成（ゲーム・無料・日本語）
- [ ] ストア掲載情報: `store/listing.md` の文を貼り、`store/` の画像をアップロード
- [ ] 連絡先メールアドレスを入れる（ストアに公開される）
- [ ] アプリのコンテンツ（データセーフティ・レーティングなど）: `store/play-console.md` のとおり
- [ ] クローズドテスト: テスター12人以上・14日間（`android/app-release-bundle.aab` をアップロード）
- [ ] 製品版へのアクセスを申請 → 公開
- [ ] Play Console の「アプリの署名」に出る**アプリ署名鍵の SHA-256** を `public/.well-known/assetlinks.json` に追加して `npm run deploy`（いま入っているのはアップロード鍵の分だけ。これがないとアプリの上部に URL バーが出る）

## 8. 気をつけること

- **データの扱いを変えたら**、`public/privacy.html`（改定日も）と `store/play-console.md` のデータセーフティを直す。Google Play の申告とずれると審査で止まる
- **ランクマッチの記録**は Cloudflare の Durable Object（SQLite）にある。`Ladder` を消したり作り直したりすると、全員のレートとランキングがなくなる
- Durable Object のクラス（`Room`・`Ladder`）は名前を変えたり消したりしない。新しく足すときは `wrangler.jsonc` の `migrations` に新しい `tag` を追加する
- 画像クイズの写真は CC0（パブリックドメイン）だけを使う。出典は `public/credits.html` に自動で載る
- 問題を足したら `npm run quiz` が文字数・重複・ジャンルごとの数をチェックする
- Windows でテストのあと `workerd.exe` が残っていると、次の `wrangler dev` が `SQLITE_BUSY` で失敗する。タスクマネージャーで `workerd.exe` を終了する

## 9. これまでの流れ

| 日付 | コミット | 内容 |
| --- | --- | --- |
| 2026-09-28 | `bda7937` | 最初の版（部屋をつくって早押し対戦） |
| 2026-10-01 | `1e35751` | 問題を1万問に、文字入力、ジャンル選び、Android アプリ |
| 2026-10-06 | `1bba0dd` | 画像クイズ |
| 2026-10-07 | `3b621ff` | ランクマッチ（2人対戦・4人対戦） |
| 2026-10-08 | `28bc70c` | Google Play のストア素材、対戦記録をすぐ消すように |
| 2026-10-09 | — | 引き継ぎ書、テストとストア用スクリプトをリポジトリへ |
