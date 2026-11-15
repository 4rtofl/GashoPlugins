# GashoPlugins

[Gasho](https://github.com/4rtoflow/Gasho) のプラグインを置くリポジトリ。プラグインごとに、ID と同じ名前のフォルダーを並べる。プラグインの仕組みと API は、Gasho の [docs/plugins.md](https://github.com/4rtoflow/Gasho/blob/main/docs/plugins.md) にまとめた。

| フォルダー | プラグイン |
|---|---|
| `ayu-dark/` | Gasho の画面全体を、ayu Dark（ayu-theme/vscode-ayu の `ayu-dark.json`、MIT）の色にするテーマ。プラグインの API 1.6 に対応した Gasho が要る |
| `github/` | セッションのリポジトリの、開いている Issue と Pull request を読む。working server の GitHub CLI（gh）を使う |
| `github-almighty/` | worktree の Issue（ブランチ名の番号）と Pull request（そのブランチのもの、手で足したもの）を、セッションと並んだタブで読む。1 件の画面は会話・コミット・チェック・ファイルのタブに分かれ、題と本文の変更、担当、ラベル、コメント、閉じる・開き直す、Draft の切り替えを、GitHub を開かずに行う。ここ 24 時間に開いた worktree を、設定の間隔（既定は 60 秒）で読み直す。プラグインの API 1.5 に対応した Gasho が要る。仕様と足し方は [github-almighty/README.md](github-almighty/README.md) |
| `kanban/` | 選んだ repo の worktree と自分の Pull request を、列のボードに並べる。working server の git と gh を使う。仕様は [kanban/README.md](kanban/README.md) |
| `pondering/` | Claude が作業しているあいだ、会話の末尾に Claude Code のスピナーのような文言とアニメーションを出す。文言は6つの言語から作業ごとに選び、作業の時間、書いたトークン数、動いているツールも添える。プラグインの API 1.2 に対応した Gasho が要る |
| `remote-control-shell/` | セッションのヘッダーの「シェル」から右にパネルを開き、セッションのフォルダーでシェルのコマンドを実行する。出力は実行中から少しずつ出て、Claude の会話には入らない。プラグインの API 1.1 に対応した gasho-daemon が要る。仕様は [remote-control-shell/README.md](remote-control-shell/README.md) |
| `session-list-rewind/` | サイドバーに、worktree の行の代わりに、リポジトリごとのカテゴリに分けたセッションを並べる。カテゴリは畳め、カテゴリもセッションもドラッグで並べ替えられる。セッション画面の上の行からは、セッションのタブと「＋」を外す。プラグインの API 1.7 に対応した Gasho が要る。仕様は [session-list-rewind/README.md](session-list-rewind/README.md) |
| `usage/` | 入力欄の下に、セッションの Context Window の使用率をリングで出す。押すと、Context Window の使用量と、Claude.ai のプランの使用量の上限（モデルごとの週の上限を含む）を出す。プラグインの API 1.4 に対応した Gasho が要る。仕様は [usage/README.md](usage/README.md) |
| `vscode-dark-2026/` | Gasho の画面全体を、VS Code の既定の暗いテーマ Dark 2026（microsoft/vscode の `2026-dark.json`、MIT）の色にするテーマ。プラグインの API 1.6 に対応した Gasho が要る |

## ジャンル

プラグインは、`gasho-plugin.json` の `genre` に、ジャンルの ID を1つ書く。使えるジャンルは `genres.json` に並べた、連携（`integration`）、作業の管理（`workflow`）、監視（`monitoring`）、見た目（`appearance`）、開発ツール（`devtools`）、テーマ（`theme`）、その他（`other`）である。それぞれにどんなプラグインが当てはまるかも、`genres.json` に書いた。いまのプラグインは、`github` と `github-almighty` が連携、`kanban` が作業の管理、`usage` が監視、`pondering` が見た目、`remote-control-shell` が開発ツールである。Gasho のプラグインの画面は、カードにジャンルの名前を出し、「GashoPlugins にあるもの」をジャンルごとに分けて、`genres.json` の順に並べる。

```json
{
  "id": "github",
  "name": "GitHub",
  "version": "1.0.0",
  "description": "セッションのリポジトリの、開いている Issue と Pull request を読む（working server の gh を使う）",
  "genre": "integration",
  ...
}
```

Pull request と main への push のたびに、GitHub Actions が `scripts/check.ts` で確かめる。`genre` のないプラグインや、`genres.json` にないジャンルを書いたプラグインがあると、依存パッケージを入れる前に失敗し、Pull request のそのファイルにエラーを出す。ID がフォルダーの名前と違うもの、`version` が 1.2.0 の形でないもの、`package.json` の `workspaces` にないプラグインのフォルダーも、同じく失敗にする。手元では `npm run check` で確かめられる。

ジャンルを足すときや名前を変えるときは、`genres.json` を直す。プラグインの画面は、ジャンルの名前と並びをカタログ（`catalog.json` の `genres`）から読むので、Gasho は直さなくてよい。

## ビルドする

SDK は、GitHub Packages の `@4rtoflow/gasho-plugin-sdk` を `@gasho/plugin-sdk` の名前で入れて使う。GitHub Packages から入れるには、`read:packages` の権限のあるトークンを `~/.npmrc` に書いておく。書き方は、Gasho の [docs/daemon-setup.md](https://github.com/4rtoflow/Gasho/blob/main/docs/daemon-setup.md) と同じ。

```bash
npm install
npm run build -w github       # github/dist/ に gasho-plugin.json、web.js、web.css、daemon.js を書く
npm run dev -w github         # 保存するたびにビルドし直す
npm run check                 # どのプラグインも genres.json のジャンルを書いているか
npm run typecheck
npm test
```

## 公開する

プラグインを直したら、`gasho-plugin.json` の `version` を上げて main にマージする。GitHub Actions（`.github/workflows/release.yml`）が、`gasho-plugin.json` の確認（ジャンルなど）、型チェック、テスト、ビルドをしてから、版の上がったプラグインを公開する。

- `dist/` の中身を `<ID>-<版>.tgz` にまとめて、リリース `<ID>-v<版>` に置く。前の版のリリースは残す
- リリース `catalog` の `catalog.json`（プラグインごとの最新の版とジャンル、ファイルの SHA-256、ジャンルの一覧）を作り直す

版を上げずにマージしたものは公開しない。ただし、ジャンル（`genre` や `genres.json`）を変えたときは、`catalog.json` だけを作り直す。Pull request では、`gasho-plugin.json` の確認、型チェック、テスト、ビルドだけを行う。何が公開されるかは、ビルドしてから `node scripts/release.ts --dry-run` で確かめられる（何も変えない）。

GitHub Actions は、GitHub Packages の SDK を、このリポジトリの `GITHUB_TOKEN` で入れる。そのため、SDK のパッケージ（`@4rtoflow/gasho-plugin-sdk`）の設定の「Manage Actions access」に、このリポジトリを Read で足しておく。

## Gasho に入れる

公開したプラグインは、Gasho のサイドバーの「プラグイン」の画面で、「GashoPlugins にあるもの」から追加する。新しい版を公開すると、同じ画面に「更新」が出る。

作っているプラグインは、Gasho サーバーの、Gasho のリポジトリで実行して入れる。

```bash
npm run hub:plugin -- add --link ~/repos/GashoPlugins/github/dist   # 作っているあいだ。ビルドするたびに画面と gasho-daemon が入れ替わる
npm run hub:plugin -- add ~/repos/GashoPlugins/github/dist          # ビルドしたものを写して入れる（カタログを使わないとき）
```

daemon の部分（working server で動く部分）は、プラグインに対応した gasho-daemon（0.12.0 以降）でだけ動く。
