# GitHub（github）

セッションのリポジトリの GitHub Actions の実行、Projects のボード、Packages の版を、GitHub を開かずに読む。読むだけで、GitHub は変えない。gh は gasho-daemon の `ctx.github.read` で動かすので、プラグインの API 1.3 に対応した gasho-daemon が要る。

Issue と Pull request は、このプラグインではなく Git プラグイン（`git/`）が読む。2.0.0 より前の github プラグイン（1.0.0）は Issue と Pull request を読むものだったが、それは `git` に改名した（#96）。1.0.0 を入れていた Gasho では、更新するとこのプラグインに入れ替わるので、Issue と Pull request を読み続けるには「Git」を足す。

## 画面

セッションのヘッダーの、Git プラグインの「Issues」「Pull requests」の右に、「Actions」「Projects」「Packages」が並ぶ（`order` は 310・320・330）。どれも、セッションのフォルダーかその中のリポジトリが GitHub にあり、working server でこのプラグインが動いているときだけ出る。押すと右にパネルを開く（スマホでは画面に代わって開く）。フォルダーに GitHub のリポジトリが複数あるときは、パネルの上にリポジトリのタブが出る。

パネルの右上には、GitHub で開くボタンと、読み直すボタンがある。読み直すボタンは、gasho-daemon が覚えている答えを使わず、gh に GitHub を読み直させる。

### Actions

- 実行の一覧を、新しいものから 50 件出す。1 件ごとに、題、ワークフローと番号、ブランチ、イベント（push・Pull request・手動・定期など）、結果、所要時間、時刻を出す
- ワークフローとブランチで絞り込める。ブランチの選択肢は、セッションのブランチと、読んだ実行のブランチ。「このブランチ」を押すと、セッションのブランチ（タブで選んだリポジトリのブランチ）の実行だけになる。絞り込みはパネルの URL に残る
- 1 回の実行を開くと、ジョブごとに結果と所要時間、ステップの結果と所要時間を出す。失敗したジョブは開いた状態で出し、失敗したステップのログの末尾 80 行を添える（ログは末尾が見える位置で開く）。ログ全体は GitHub で見る
- 実行中・待ちのものがあるあいだは、一覧も 1 回の実行も 15 秒ごとに読み直す

### Projects

- リポジトリにつながった Project と、リポジトリの owner（組織か人）のほかの Project を、別々に一覧にする。開いている Project を先に、新しく更新したものから並べる
- 開いた Project は、単一選択のフィールドで列に分けたボードで出す。最初の列分けは、Project のボードのビューが使うフィールド、なければ「Status」、それもなければ最初の単一選択のフィールド。「列」で別のフィールドに替えられる。値のない項目は「<フィールド名> なし」の列に入る
- ボードがパネルの幅に収まらないときは、横にスクロールする。列は縦にもスクロールする
- カードは、Issue・Pull request の状態のアイコン、題、番号（ほかのリポジトリのものはリポジトリ名も）、担当を出し、押すと GitHub で開く。下書きと、gh のログインで読めない項目も並べる
- ビューのフィルターと並び順は当てない。アーカイブした項目は出さない。項目は 500 件まで読む（それより多いと、そう書く）
- gh のログインに `read:project` の権限が要る。無いときは、パネルに `gh auth refresh -h github.com -s read:project` を出す（コピーできる）

### Packages

- リポジトリにつながったパッケージを、種類（npm・コンテナー・Maven・RubyGems・NuGet・Docker）、公開範囲、版の数、更新の時刻とともに一覧にする。人の owner のパッケージは、GitHub が版の数を返さないので出さない
- 開いたパッケージは、版の一覧（新しいものから 100 版まで）と、いちばん新しい版を入れるコマンドを出す。コンテナーは版ごとにタグを出し、コマンドは最初のタグ（タグがなければダイジェスト）で `docker pull ghcr.io/…` にする。Maven は名前から groupId と artifactId に分けられないので、コマンドを出さない
- gh のログインに `read:packages` の権限が要る。無いときは、パネルに `gh auth refresh -h github.com -s read:packages` を出す

## daemon の部分のメソッド

`methods` はすべて `read` で、どれもセッションを名前で指し、フォルダーにリポジトリが複数あるときは `repo`（フォルダーの中の道筋）を添える。daemon の部分は、gasho-daemon が見つけたリポジトリの owner/name の形を確かめてから、gh に渡す。`fresh: true` を添えると、gh に読み直させる（読み直すボタン）。

| メソッド | 引数 | 結果（`src/types.ts`） | 使う gh |
|---|---|---|---|
| `runs` | `workflow?`（ID）、`branch?` | `Runs` | `gh run list`、`gh workflow list --all` |
| `run` | `id` | `RunDetail` | `gh run view --json …,jobs`、失敗したジョブは `gh api repos/<repo>/actions/jobs/<id>/logs` |
| `projects` | なし | `Projects` | `gh api graphql`（`repository.projectsV2` と `repositoryOwner.projectsV2`） |
| `project` | `number` | `Board` | `gh api graphql`（`projectV2(number)` を 100 件ずつ 5 回まで） |
| `packages` | なし | `Packages` | `gh api users/<owner>`・`gh api user` で owner の種類を見て、`/orgs/<org>/packages`・`/user/packages`・`/users/<user>/packages` を種類ごとに |
| `package` | `type`、`name` | `PackageDetail` | 同じ道筋の `/<type>/<name>` と `/versions` |

GraphQL の `repository.packages` は npm のパッケージを返さないので、パッケージは REST で owner のものを読み、`repository.full_name` がセッションのリポジトリのものだけを残す。1 つのパッケージを開くときも、リポジトリが違えば見つからないと答える。

ジョブのログは、gh 2.8x 以降、色の付いたログを `--allow-escape-sequences` なしでは出さない。daemon の部分はこれを付けて読み、古い gh が知らないフラグだと断ったら、付けずに読み直す。ログのタイムスタンプ、色、GitHub のグループの印は外す。失敗したステップの部分は、ステップの開始と終了の時刻（秒まで）で行を切り出し、その中の「##[group]Run …」から、次のステップか「Post job cleanup.」の前までとする。

## テスト

`test/` の gh の出力の読み取りは、実際の gh の出力（`test/fixtures/`、2026-11-15 に 4rtoflow/GashoPlugins、4rtoflow/Gasho、github/roadmap、4rna-y のパッケージで取ったもの）をもとにしている。
