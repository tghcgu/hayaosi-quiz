# CLAUDE.md

早押しクイズロワイヤル: それぞれのスマホから同じ部屋に入って遊ぶ早押しクイズ対戦。
Cloudflare Workers + Durable Objects で動き、Android アプリは同じサイトを表示する TWA。

- 遊び方・仕組み・問題や画像の足し方: [README.md](README.md)
- いまの状態・アカウント・新しいパソコンでの復旧・残り作業: [HANDOVER.md](HANDOVER.md)（大きな変更をしたら、ここも更新する）
- Google Play の掲載文とデータセーフティなどの答え: [store/](store/)

## 守ること

- `npm run deploy`（Cloudflare への公開）と `git push` は、毎回ユーザーに確認してから行う。2つは別々に確認する
- 署名鍵 `%USERPROFILE%\hayaoshi-android-key\`（`upload.jks`・`password.txt`）はコミットしない。中身を表示しない
- リポジトリは公開されている。メールアドレス・パスワードをファイルやコミットに書かない
- データの扱い（集める・保存する・消す）を変えたら、`public/privacy.html`（改定日も）と `store/play-console.md` も直す
- 画面の文は、ひらがな多めのやさしい日本語。コードのコメントも日本語で、まわりのコードに合わせる
- コミットメッセージは日本語（1行目に要約、その下に箇条書き）

## 開発

- `npm run dev` で http://localhost:8787 。テストは別のターミナルで `npm test`（サーバー5本）・`npm run test:ui`（ヘッドレス Chrome 4本）
- テストは `test/*.cjs`（package.json が `"type": "module"` なので、CommonJS のスクリプトは `.cjs`）。両方あわせて10分以上かかるので、バックグラウンドで動かす
- 公開後は本番で `test/ranked-smoke.cjs` を `WS_URL=wss://hayaoshi-quiz-royale.qoj.workers.dev/ws` で動かす（テスト用の記録は最後に消える）
- 問題: `quiz/data/*.js` → `npm run quiz` → `src/questions.generated.json`（15ジャンル × 667問、文字数・重複・数をチェック）
- 画像クイズ: `quiz/images/`（subjects.js・picks.js）→ `npm run images` → `public/q/`・`src/images.generated.json`・`public/credits.html`。写真は Wikimedia Commons の CC0 だけ
- サーバー: `src/worker.js`（振り分け）、`src/room.js`（部屋。早押しの判定はすべてサーバー側）、`src/ladder.js`（ランクマッチの受付・レート・ランキング・通報。SQLite）
- Durable Object のクラスは名前を変えたり消したりしない。足すときは `wrangler.jsonc` の `migrations` に新しい `tag` を追加する

## はまりどころ（Windows）

- テストの偽プレイヤーは定期的に ping を送る（60秒だまっていると切られる）
- 画面テストで複数人を開くときは、プレイヤーごとに別のブラウザコンテキスト（`Target.createBrowserContext`）にする。同じだと localStorage を共有して同じプレイヤーになる
- `wrangler dev` を止めても `workerd.exe` や wrangler の `node.exe` が残り、次回 `SQLITE_BUSY` になる。PowerShell で探して止める
- Git Bash では `//` で始まる引数がパスに変換される。長いヒアドキュメントは失敗しやすいので、ファイルは Write ツールで書く
- PowerShell で `npm` がエラーになるときは `npm.cmd`
