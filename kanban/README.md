# カンバン（kanban）

サイドバーの「カンバン」で、選んだ repo の worktree と自分の Pull request を、5つの列（自分の番、エージェント作業中、GitHub 待ち、レビュー待ち、完了）のボードに並べる。Gasho の PR #8（元は [4rtofl/Dashboard](https://github.com/4rtofl/Dashboard)）をプラグインに移したもの。カードをどの列に置くかと、カードのメニューから Claude に送る指示は、人によって進め方が違うので、repo ごとに選んだカンバン用のプラグイン（書き方は [plugins/AGENTS.md](plugins/AGENTS.md)）が決める。カンバン用のプラグインは、カンバンのビルドに入れず、working server の置き場のフォルダーから読み込む（下の「カンバン用のプラグインの置き場」）。プラグインを選んでいない repo のカードは、「自分の番」に並べる。

- 見る repo は、「見る repo」から working server ごとに選ぶ（1台に30まで）。選べるのは、Gasho がセッションを起動できるフォルダー（Claude Code が信頼しているフォルダー）にある GitHub の repo で、worktree がいくつあっても、repo ごとに primary checkout の1つにまとめる。選んだ repo には、カードを置く列を決めるカンバン用のプラグインも選べる。選んだ repo とプラグインは、working server のこのプラグイン専用のフォルダー（`~/.local/share/gasho/plugin-data/kanban/watched.json`）に覚える（壊れていれば、何も見ていないところから始める）。選び直すと、ホームの「最近の操作」に残る。選べる repo の一覧は、フォルダーの `.git` と repo の `config` のファイルから作り、ファイルで分からないもの（include のある config、bare の repo など）だけ git に聞く
- daemon の部分が、repo ごとに `git worktree list` と、working server の gh で自分の Pull request（開いているものと閉じたもの）を読む。gh は、gasho-daemon に実行してもらう（`ctx.github`）。repo は GitHub の今の名前で読む（origin が Org の改名前の名前のままでも、Pull request が出る。名前は 1 時間に 1 回、GraphQL で引く）。読むのは、どこかのブラウザーでカンバンを開いているあいだだけで、1分に1回まで（画面が1分おきに呼び、前に読み始めてから50秒たっていれば読み直す）。「今すぐ見直す」で、gasho-daemon が覚えている gh の結果を使わずに、すぐに読み直す（10秒以内に読み始めたばかりなら読まない）。読めなかった repo は、前に読めたカードを出したまま、理由を上に出す
- repo に選んだカンバン用のプラグインに `fetch` があれば、読み直す2回に1回（「今すぐ見直す」と、プラグインを選んだときはすぐ）、daemon の部分がそれを呼び、返した値を画面の部分に送ってプラグインの `state` と `headings` に渡す。`fetch` は gh のほかに working server のコマンド（`ps` など）も動かせ、次に呼ぶときまで残す値を、このプラグイン専用のフォルダーの `stores/` に書ける。GitHub の GraphQL の残りが1時間に1000点を切ったら（`gh api rate_limit` で読む。これは点を使わない）、残りが戻る時刻まで `fetch` を呼ばず、前に返した値を使い、そうボードの上に出す。`fetch` が失敗した repo は、前に返した値を使い、理由を上に出す
- worktree 1つを1枚のカードにする。HEAD が detached の worktree もカードにし、「detached」と出す。rebase がコンフリクトで止まっている worktree は「rebase 中」と出し、rebase しているブランチの Pull request と結び付ける。worktree のない、開いた Pull request も1枚のカードにする。primary checkout は、開いた Pull request があるか、会話が作業しているか答えを待っているときだけ出す。フォルダーが消えた worktree（`git worktree list` の `prunable`）は出さない
- worktree には、そのブランチの自分の Pull request を付ける。fork の同じ名前のブランチから出したものは付けず、worktree のないカードにする。閉じたものとマージ済みのものは、worktree の HEAD がその Pull request の最後の commit のときだけ付ける（前にマージした Pull request と同じ名前のブランチで作り直した worktree には付けない）。github-review が作った review の worktree（primary checkout の隣の `review-<repo の名前>-<番号>` と、前の名前の `review-<番号>`）には、誰が出したものでも、その番号の Pull request を付ける
- カードには、Pull request の状態（まだない、開いている、Draft、マージ済み、クローズ済み）をアイコンで出し、カンバン用のプラグインがその列に置いた理由を一言出す。プラグインが付けた印（デプロイした Stack など）も出す。プラグインが見出しを返せば、ボードの上に並べる（見本は、Stack ごとに最後にデプロイした worktree）。プラグインが列を決められなかったカードは「自分の番」に置き、そう出す。Claude Code の会話は、Gasho が起動したものに限らず、その working server で動いているものをすべて見て、会話の作業フォルダーを含む、いちばん深い worktree のカードに付ける
- カードを押すとメニューが開き、カンバン用のプラグインが決めた指示を、その worktree で最後に使った Gasho のセッションに送れる（なければ、その worktree で起動して送る）。送ったあともボードのままで、下に出る知らせからセッションを開ける。自由に書いた指示は、メニューからは送れない（セッションの画面で送る）。メニューからは、その worktree の Gasho のセッションも開ける（なければ、その worktree で起動して開く）。Pull request があれば、GitHub で開ける。PR の題やタグを押しても GitHub には移らない。Claude Code がフォルダーを信頼するかを聞いたときは、起動する前に確かめる
- 同じ列の中では、Pull request が長く動いていないものを上に出す
- PC では、カンバンをページの高さに収め、カードがページの下端を超える列は、その列の中でスクロールする（スクロールバーは出さない）。列の上で横にスクロールすると、ボードが横に動く。スマホでは列を1つずつタブで出し、ページごとスクロールする
- 列ごとに、並び（既定の順か、Issue 番号・PR 番号・最終更新の昇順・降順）、表示（詳細か、1行の簡潔）、幅を変えられる。番号や更新の時刻がないカードは、どちらの向きでも下に並べる。最初はレビュー待ちと完了を簡潔にする。幅は、列の右端のつまみをドラッグするか、つまみを選んで左右キー（Shift で4倍）で変え、ダブルクリックで元に戻す。どれも、ブラウザーごとに覚える
- 使えるのは、プラグインの API 1.5 に対応した gasho-daemon の working server。オフラインの working server の repo のカードは出さない

## カンバン用のプラグインの置き場

working server ごとに、カンバンのフォルダーの下の `~/.local/share/gasho/plugin-data/kanban/plugins/` に置く。カンバンを更新しても、カタログから入れ直しても残る。

- カンバンが動き始めるたびに、型（`types.ts`）、書き方の説明（`AGENTS.md` と、それを読み込む `CLAUDE.md`）、`check.ts`、`place.ts`、`package.json`、`tsconfig.json` を置き直す。見本（`example/`）は、フォルダーが無いときだけ置く。各自のプラグインは書き換えない。置くものは、この repo の [plugins/](plugins/) にあるものと同じ
- daemon の部分が、置き場の `<名前>/index.ts` と、それが import するファイルを、型を取り除いて読み込み（Node.js の `stripTypeScriptTypes`）、`fetch` を動かす。画面の部分は、同じコードを daemon の部分から受け取り、ブラウザーで `state` と `headings` を動かす
- 置き場のファイルを保存すると、daemon の部分が読み込み直し、開いているボードに知らせて（プラグインの API 1.5 のイベント）、Gasho を起動し直さずに描き直す。`fetch` を書き換えたときは、そのプラグインを選んだ repo の `fetch` をすぐに呼び直す
- 読み込めないプラグインは、ファイルと行と理由をボードの上に出す
- 「カードを書き出す」で、実際のカードと `fetch` の結果を置き場の `cards/` に JSON で書き出し、置き場で `node check.ts <名前>` を流すと、`state` を当てた結果（列・理由・指示）を一覧にできる。型の確認（`npx tsc`）とテスト（`node --test`）も置き場で流せる（[plugins/AGENTS.md](plugins/AGENTS.md) の「確かめる」）

### 今のプラグインを移す

前は、checkout の `kanban/plugins/<名前>/` に置いたプラグインをカンバンのビルドに入れていた。今のカンバンはそれを読まないので、置き場に移す。

1. カンバンを新しい版にする（カタログから更新するか、checkout を新しくしてビルドし直す）。新しい版の daemon の部分が working server で動き始めると、置き場に型と見本が置かれる
2. checkout の `kanban/plugins/<名前>/` を、フォルダーごと置き場に移す（`mv kanban/plugins/<名前> ~/.local/share/gasho/plugin-data/kanban/plugins/`）。`example/` は移さない
3. 移したプラグインが `import type { … } from "../types.ts"` で型を読んでいれば、そのまま使える。値を読む import に拡張子 `.ts` が無いものは足す。ボードの上に読み込めない理由が出たら、それに従って直す
4. 「見る repo」で選んでいたプラグインの名前はそのまま残るので、選び直さなくてよい
5. 手元でビルドするために `kanban/dist` を `plugin add --link` で入れていたなら、カタログから入れ直してよい

## daemon の部分のメソッド

| メソッド | 種類 | すること |
|---|---|---|
| `options` | read | 見る repo に選べるもの（`RepoOption[]`）。`ctx.folders()` のフォルダーから作り、30秒は同じものを返す |
| `board` | read | 見る repo の worktree と自分の Pull request、カンバン用のプラグインの `fetch` が返した値（`Board`）。読み直す時期なら、読み始めてから返す（`checking: true`） |
| `refresh` | read | gasho-daemon が覚えている gh の結果を使わずにすぐに読み直し（`fetch` も呼ぶ）、`board` と同じものを返す |
| `watch` | write | 見る repo を `{ paths }` に、repo ごとのカンバン用のプラグインを `{ plugins }`（primary checkout からプラグインの名前）に変える。新しく足せるのは `options` にある GitHub の repo だけ。`plugins` が無ければ、前に選んだものを残す。`fetch` のあるプラグインを選んだ repo があれば、読み直す |
| `plugins` | read | 置き場のカンバン用のプラグイン（`PluginSet`：置き場のパス、版、名前、型を取り除いたコードと import の位置、読み込めないものの理由）。版が変わると、イベント `plugins` で画面の部分に知らせる |
| `exportCards` | write | `{ repos: [{ path, cards }] }`（primary checkout と、その repo の `StateCard[]`）を、repo と `fetch` の結果と一緒に、置き場の `cards/<OWNER>__<REPO>.json` に書く |

会話をカードに振り分け、カンバン用のプラグインの `state` でカードの列を決めるのは画面の部分（`src/cards.ts`、`src/web/board-plugins.ts`）で、daemon の部分は会話を受け取らない。daemon の部分は、置き場のプラグインを読み込み（`src/daemon/folder.ts`）、選んだプラグインの名前を覚え、その `fetch` を呼ぶ（`src/daemon/reader.ts`）。GitHub の API は、repo 1つを1回読むと2点使う（GraphQL の上限は1時間に5000点）ので、カンバンを開いているあいだ、repo 1つで1時間に120点になる。review の worktree があれば、その Pull request を GraphQL の1回で読むので、1点ずつ足される。`fetch` は2分に1回なので、見本（1回2点ほど）なら60点が足される。
