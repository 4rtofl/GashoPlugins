# GitHub（github）

セッションのリポジトリの GitHub Actions の実行、Projects のボード、Packages の版を、GitHub を開かずに読む。読むだけで、GitHub は変えない。gh は gasho-daemon の `ctx.github.read` で動かすので、プラグインの API 1.3 に対応した gasho-daemon が要る。

Issue と Pull request は、このプラグインではなく Git プラグイン（`git/`）が読む。2.0.0 より前の github プラグイン（1.0.0）は Issue と Pull request を読むものだったが、それは `git` に改名した（#96）。1.0.0 を入れていた Gasho では、更新するとこのプラグインに入れ替わるので、Issue と Pull request を読み続けるには「Git」を足す。

## 画面

セッションのヘッダーの、Git プラグインの「Issues」「Pull requests」の右に、「Actions」「Projects」「Packages」が並ぶ（`order` は 310・320・330）。どれも、セッションのフォルダーかその中のリポジトリが GitHub にあり、working server でこのプラグインが動いているときだけ出る。押すと右にパネルを開く（スマホでは画面に代わって開く）。フォルダーに GitHub のリポジトリが複数あるときは、パネルの上にリポジトリのタブが出る。

パネルの右上には、GitHub で開くボタンと、読み直すボタンがある。読み直すボタンは、gasho-daemon が覚えている答えを使わず、gh に GitHub を読み直させる。読み直せなかったときは、前に読んだ内容と読み込んだ時刻をそのまま出し、読み直せなかったことと理由を出す。無い実行・Project・パッケージを開いたときは、何が見つからないかを出す。

### Actions

- 実行の一覧を、新しいものから 50 件出す。1 件ごとに、題、ワークフローと番号、ブランチ、イベント（push・Pull request・手動・定期など）、結果、所要時間、時刻を出す
- ワークフローとブランチで絞り込める。ブランチの選択肢は、セッションのブランチと、ブランチで絞り込まずに読んだ実行（新しいものから 50 件）のブランチで、ブランチを選んでも変わらない。「このブランチ」を押すと、セッションのブランチ（タブで選んだリポジトリのブランチ）の実行だけになる。セッションが detached HEAD のときは「このブランチ」を出さない。絞り込みはパネルの URL に残る
- 1 回の実行を開くと、ジョブごとに結果と所要時間、ステップの結果と所要時間を出す。実行中のジョブとステップは始まってからの時間を出し、始まっていないステップには出さない。失敗したジョブは開いた状態で出し、失敗したステップのログの末尾 80 行を添える（ログは末尾が見える位置で開く）。ログを読むのは、失敗したジョブのうち最初の 3 件までで、ほかのジョブにはそう出す。ログ全体は GitHub で見る
- 再実行した実行は、「実行した回」で前の回を選ぶと、その回の結果・ジョブ・ログを出す（URL の `attempt`）。GitHub のボタンも、その回のページを開く
- ジョブの無い実行は、その理由を出す。GitHub が始められなかった実行（`startup_failure`）は「始められなかった」とし、理由は GitHub で見るよう書く（ワークフローのファイルの誤りのほか、path が `dynamic/…` の実行でも起きるので、原因は書かない）。ジョブが始まる前に取り消された実行、承認を待つ実行もそう書く。ワークフローの名前を GitHub が読めなかった実行は「ワークフロー」と出す
- 実行中・待ち（デプロイの承認待ちを含む）のものがあるあいだは、一覧も 1 回の実行も 15 秒ごとに読み直す。承認が必要な実行（フォークからの Pull request など、GitHub で承認されるまで始まらないもの。GitHub の `action_required`）は、終わった実行と同じく読み直さず、所要時間も出さない
- 実行を開いてから一覧に戻ると、開く前のスクロールの位置で出す。位置は一度戻したら忘れる（そのあとパネルを開き直したり、絞り込みを切り替えて戻したりしても、上から出す）

### Projects

- リポジトリにつながった Project と、リポジトリの owner（組織か人）のほかの Project を、別々に一覧にする。どちらも、開いているものと閉じたものを、それぞれ新しく更新したものから 50 件まで読み、開いているものを先に並べる。もっとあるときは、そう書く
- 開いた Project は、単一選択かイテレーションのフィールドで列に分けたボードで出す。最初の列分けは、Project のボードのビューが使うフィールド、なければ「Status」、それもなければ最初の単一選択のフィールド。「列」で別のフィールドに替えられる。値のない項目は「<フィールド名> なし」の列に入る
- イテレーションの列は、終わったものを先に、始まりの日の順に並べる。終わったイテレーションは、項目があるときだけ列にする
- ボードがパネルの幅に収まらないときは、横にスクロールする。列は縦にもスクロールする
- カードは、Issue・Pull request の状態のアイコン、題、番号（ほかのリポジトリのものはリポジトリ名も）、担当を出し、押すと GitHub で開く。対応しない・重複として閉じた Issue は、GitHub と同じく灰色の印にする。下書きと、gh のログインで読めない項目も並べる
- ビューのフィルターと並び順は当てない。アーカイブした項目は出さない。項目は 500 件まで読む（それより多いと、そう書く）
- gh のログインに `read:project` の権限が要る。無いときは、パネルに `gh auth refresh -h github.com -s read:project` を出す（コピーできる）

### Packages

- リポジトリにつながったパッケージを、種類（npm・コンテナー・Maven・RubyGems・NuGet・Docker）、公開範囲、版の数、更新の時刻とともに、更新の新しいものから一覧にする。更新の時刻は、いちばん新しい版を公開した時刻。パッケージの `updated_at` は版を公開しても変わらないので、パッケージごとに版を 1 件読む（最初の 30 件まで。ほかには時刻を出さない）。GitHub が版の数を返さないパッケージ（人の owner のものなど）は、版の数を出さない
- 開いたパッケージは、版の一覧（新しいものから 100 版まで。100 版のときは 101 版目があるかを読み、あるときだけ、ほかにもあると書く）と、いちばん新しい版を入れるコマンドを出す。コンテナーは版ごとにタグを出し、コマンドは、署名や attestation のタグ（`sha256-<ダイジェスト>`）を除いたタグのある、いちばん新しい版のタグ（その中に `latest` があればそれ）で `docker pull ghcr.io/…` にする。タグのある版がなければ、タグのないいちばん新しい版のダイジェストにする。Maven は名前から groupId と artifactId に分けられないので、コマンドを出さない
- gh のログインに `read:packages` の権限が要る。無いときは、パネルに `gh auth refresh -h github.com -s read:packages` を出す

## daemon の部分のメソッド

`methods` はすべて `read` で、どれもセッションを名前で指し、フォルダーにリポジトリが複数あるときは `repo`（フォルダーの中の道筋）を添える。daemon の部分は、gasho-daemon が見つけたリポジトリの owner/name の形を確かめてから、gh に渡す。`fresh: true` を添えると、gh に読み直させる（読み直すボタン）。

| メソッド | 引数 | 結果（`src/types.ts`） | 使う gh |
|---|---|---|---|
| `runs` | `workflow?`（ID）、`branch?` | `Runs` | `gh run list`（`branch` があるときは、ブランチの選択肢のために `--branch` なしでも）、`gh workflow list --all` |
| `run` | `id`、`attempt?` | `RunDetail` | `gh run view --json …,jobs`（`attempt` があるときは、その回を `--attempt` でも）、失敗したジョブは `gh api repos/<repo>/actions/jobs/<id>/logs` |
| `projects` | なし | `Projects` | `gh api graphql`（`repository.projectsV2` と `repository.owner.projectsV2`） |
| `project` | `number` | `Board` | `gh api graphql`（`repository.owner.projectV2(number)` を 100 件ずつ 5 回まで） |
| `packages` | なし | `Packages` | `gh api graphql`（`repository { nameWithOwner owner }` と `viewer`）で今の owner とその種類を見て、`/orgs/<org>/packages`・`/user/packages`・`/users/<user>/packages` を種類ごとに 100 件ずつ、100 件に満たないページまで（10 ページまで）。パッケージごとに `/<type>/<name>/versions?per_page=1` |
| `package` | `type`、`name` | `PackageDetail` | 同じ道筋の `/<type>/<name>` と `/versions`（100 版のときは `/versions?per_page=1&page=101` も） |

GraphQL の `repository.packages` は npm のパッケージを返さないので、パッケージは REST で owner のものを読み、`repository.full_name` がセッションのリポジトリのものだけを残す。1 つのパッケージを開くときも、リポジトリが違えば見つからないと答える。

owner は、どれも `repository(owner:, name:)` の答えの owner から読む。owner の名前が変わったあとも、origin が前の名前のままの clone はある（Org を 4rtoflow から 4rtofl に変えたときなど）。`repository(owner:, name:)` は前の名前でもリポジトリを見つけて今の owner を返すが、`repositoryOwner(login:)`・`users/<login>`・`orgs/<login>` は前の名前では見つからない。パッケージのリポジトリも、GitHub が返す今の名前と照らし合わせる。

ジョブのログは、gh 2.8x 以降、色の付いたログを `--allow-escape-sequences` なしでは出さない。daemon の部分はこれを付けて読み、古い gh が知らないフラグだと断ったら、付けずに読み直す。ログのタイムスタンプ、色、GitHub のグループの印は外す。ログを出すのは、ジョブの中で最初に失敗したステップ。その部分は、ステップの開始と終了の時刻（秒まで）で行を切り出して決める。切り出した中には、最初の 1 秒に終わった前のステップと、最後の 1 秒に動いた後のステップ（`if: failure()` のステップなど）の行も入る。前のステップは成功しているので、最初の「##[error]」を失敗したステップのものとし、その前で最後に始まるステップの「##[group]Run …」から、そのあとで次に始まるステップの前までを残す（「##[start-action …]」と「##[end-action …]」の間にある composite action の中のステップは数えない）。その中で、最後の「##[error]」のあとに次のステップの始まり（「##[group]Run …」か「##[start-action …]」）か「Post job cleanup.」があれば、その前で切る。composite action の中のステップも「##[group]Run …」で始まるので、最後のエラーより前では切らない。「##[start-action …]」「##[end-action …]」の行は出さない。1 行は 500 文字までにし、絵文字の途中では切らない。

## テスト

`test/` の gh の出力の読み取りは、実際の gh の出力（`test/fixtures/`、2026-11-15 に 4rtofl/GashoPlugins、4rtofl/Gasho、github/roadmap、4rna-y のパッケージで取ったもの）をもとにしている。Org 名が 4rtofl に変わったため、fixtures の中の Org 名は 4rtofl に置き換えてある。Projects とボードの答え（`projects-*.json`・`board-page.json`）と `owner-renamed.json` は、2026-11-18 に今の問い合わせで取り直した（`projects-empty.json` と `owner-renamed.json` は、前の Org 名 4rtoflow で問い合わせたもの）。`versions-container-signed.json` は、sigstore/cosign のコンテナー `cosign/cosign` の版（2026-11-18）を、新しい 4 版と、署名でないタグのあるいちばん新しい版に短くしたもの。`job-log-composite.txt` は、microsoft/playwright の公開の実行（ジョブ 134085053730）のログを、composite action のステップの前後だけに短くしたもの。`job-log-same-second.txt` は、grafana/grafana の公開の実行（ジョブ 134597618775）のログを、失敗したステップ 8 とその次のステップの前後だけに短くし、ステップの env の行を除いたもの。
