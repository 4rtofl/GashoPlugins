# GashoPlugins

[Gasho](https://github.com/4rtoflow/Gasho) のプラグインを置くリポジトリ。プラグインごとに、ID と同じ名前のフォルダーを並べる。プラグインの仕組みと API は、Gasho の [docs/plugins.md](https://github.com/4rtoflow/Gasho/blob/main/docs/plugins.md) にまとめた。

| フォルダー | プラグイン |
|---|---|
| `github/` | セッションのリポジトリの、開いている Issue と Pull request を読む。working server の GitHub CLI（gh）を使う |
| `github-almighty/` | worktree の Issue（ブランチ名の番号）と Pull request（そのブランチのもの、手で足したもの）を、セッションと並んだタブで読む。題と本文の変更、担当、ラベル、コメント、閉じる・開き直す、Draft の切り替えを、GitHub を開かずに行う。ここ 24 時間に開いた worktree を、設定の間隔（既定は 60 秒）で読み直す。プラグインの API 1.5 に対応した Gasho が要る |
| `kanban/` | 選んだ repo の worktree と自分の Pull request を、列のボードに並べる。working server の git と gh を使う。仕様は [kanban/README.md](kanban/README.md) |
| `pondering/` | Claude が作業しているあいだ、会話の末尾に Claude Code のスピナーのような文言とアニメーションを出す。文言は6つの言語から作業ごとに選び、作業の時間、書いたトークン数、動いているツールも添える。プラグインの API 1.2 に対応した Gasho が要る |
| `remote-control-shell/` | セッションのヘッダーの「シェル」から右にパネルを開き、セッションのフォルダーでシェルのコマンドを実行する。出力は実行中から少しずつ出て、Claude の会話には入らない。プラグインの API 1.1 に対応した gasho-daemon が要る。仕様は [remote-control-shell/README.md](remote-control-shell/README.md) |
| `session-list-rewind/` | サイドバーに、worktree の行の代わりに、リポジトリごとのカテゴリに分けたセッションを並べる。カテゴリは畳め、カテゴリもセッションもドラッグで並べ替えられる。セッション画面の上の行からは、セッションのタブと「＋」を外す。プラグインの API 1.7 に対応した Gasho が要る。仕様は [session-list-rewind/README.md](session-list-rewind/README.md) |
| `usage/` | 入力欄の下に、セッションの Context Window の使用率をリングで出す。押すと、Context Window の使用量と、Claude.ai のプランの使用量の上限（モデルごとの週の上限を含む）を出す。プラグインの API 1.4 に対応した Gasho が要る。仕様は [usage/README.md](usage/README.md) |

## ビルドする

SDK は、GitHub Packages の `@4rtoflow/gasho-plugin-sdk` を `@gasho/plugin-sdk` の名前で入れて使う。GitHub Packages から入れるには、`read:packages` の権限のあるトークンを `~/.npmrc` に書いておく。書き方は、Gasho の [docs/daemon-setup.md](https://github.com/4rtoflow/Gasho/blob/main/docs/daemon-setup.md) と同じ。

```bash
npm install
npm run build -w github       # github/dist/ に gasho-plugin.json、web.js、web.css、daemon.js を書く
npm run dev -w github         # 保存するたびにビルドし直す
npm run typecheck
npm test
```

## 公開する

プラグインを直したら、`gasho-plugin.json` の `version` を上げて main にマージする。GitHub Actions（`.github/workflows/release.yml`）が、型チェック、テスト、ビルドをしてから、版の上がったプラグインを公開する。

- `dist/` の中身を `<ID>-<版>.tgz` にまとめて、リリース `<ID>-v<版>` に置く。前の版のリリースは残す
- リリース `catalog` の `catalog.json`（プラグインごとの最新の版と、ファイルの SHA-256）を作り直す

版を上げずにマージしたものは公開しない。Pull request でも、型チェック、テスト、ビルドだけを行う。何が公開されるかは、ビルドしてから `node scripts/release.ts --dry-run` で確かめられる（何も変えない）。

GitHub Actions は、GitHub Packages の SDK を、このリポジトリの `GITHUB_TOKEN` で入れる。そのため、SDK のパッケージ（`@4rtoflow/gasho-plugin-sdk`）の設定の「Manage Actions access」に、このリポジトリを Read で足しておく。

## Gasho に入れる

公開したプラグインは、Gasho のサイドバーの「プラグイン」の画面で、「GashoPlugins にあるもの」から追加する。新しい版を公開すると、同じ画面に「更新」が出る。

作っているプラグインは、Gasho サーバーの、Gasho のリポジトリで実行して入れる。

```bash
npm run hub:plugin -- add --link ~/repos/GashoPlugins/github/dist   # 作っているあいだ。ビルドするたびに画面と gasho-daemon が入れ替わる
npm run hub:plugin -- add ~/repos/GashoPlugins/github/dist          # ビルドしたものを写して入れる（カタログを使わないとき）
```

daemon の部分（working server で動く部分）は、プラグインに対応した gasho-daemon（0.12.0 以降）でだけ動く。
