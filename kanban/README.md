# カンバン（kanban）

サイドバーの「カンバン」で、選んだ repo の worktree と自分の Pull request を、5つの列（自分の番、エージェント作業中、GitHub 待ち、レビュー待ち、完了）のボードに並べる。Gasho の PR #8（元は [4rtoflow/Dashboard](https://github.com/4rtoflow/Dashboard)）をプラグインに移したもの。カードをどの列に置くかは、人によって進め方が違うので、repo ごとに選んだカンバン用のプラグイン（[plugins/README.md](plugins/README.md)）が決める。プラグインを選んでいない repo のカードは、「自分の番」に並べる。

- 見る repo は、「見る repo」から working server ごとに選ぶ（1台に30まで）。選べるのは、Gasho がセッションを起動できるフォルダー（Claude Code が信頼しているフォルダー）にある GitHub の repo で、worktree がいくつあっても、repo ごとに primary checkout の1つにまとめる。選んだ repo には、カードを置く列を決めるカンバン用のプラグインも選べる。選んだ repo とプラグインは、working server のこのプラグイン専用のフォルダー（`~/.local/share/gasho/plugin-data/kanban/watched.json`）に覚える。選び直すと、ホームの「最近の操作」に残る
- daemon の部分が、repo ごとに `git worktree list` と、working server の gh で自分の Pull request（開いているものと閉じたもの）を読む。読むのは、どこかのブラウザーでカンバンを開いているあいだだけで、1分に1回まで（画面が1分おきに呼び、前に読み始めてから50秒たっていれば読み直す）。「今すぐ見直す」で、すぐに読み直す（10秒以内に読み始めたばかりなら読まない）。読めなかった repo は、前に読めたカードを出したまま、理由を上に出す
- worktree 1つを1枚のカードにする。worktree のない、開いた Pull request も1枚のカードにする。primary checkout は、開いた Pull request があるか、会話が作業しているか答えを待っているときだけ出す
- カードには、Pull request の状態（まだない、開いている、Draft、マージ済み、クローズ済み）をアイコンで出し、カンバン用のプラグインがその列に置いた理由を一言出す。プラグインが列を決められなかったカードは「自分の番」に置き、そう出す。Claude Code の会話は、Gasho が起動したものに限らず、その working server で動いているものをすべて見て、会話の作業フォルダーを含む、いちばん深い worktree のカードに付ける
- カードを押すとメニューが開き、その worktree の Gasho のセッションを開ける（なければ、その worktree で起動して開く）。Pull request があれば、GitHub で開ける。PR の題やタグを押しても GitHub には移らない。Claude Code がフォルダーを信頼するかを聞いたときは、起動する前に確かめる
- 同じ列の中では、Pull request が長く動いていないものを上に出す
- PC では、カンバンをページの高さに収め、カードがページの下端を超える列は、その列の中でスクロールする（スクロールバーは出さない）。列の上で横にスクロールすると、ボードが横に動く。スマホでは列を1つずつタブで出し、ページごとスクロールする
- 列ごとに、並び（既定の順か、Issue 番号・PR 番号・最終更新の昇順・降順）、表示（詳細か、1行の簡潔）、幅を変えられる。番号や更新の時刻がないカードは、どちらの向きでも下に並べる。最初はレビュー待ちと完了を簡潔にする。幅は、列の右端のつまみをドラッグするか、つまみを選んで左右キー（Shift で4倍）で変え、ダブルクリックで元に戻す。どれも、ブラウザーごとに覚える
- 使えるのは、プラグインの API 1.1 に対応した gasho-daemon の working server。オフラインの working server の repo のカードは出さない

## daemon の部分のメソッド

| メソッド | 種類 | すること |
|---|---|---|
| `options` | read | 見る repo に選べるもの（`RepoOption[]`）。`ctx.folders()` のフォルダーから作り、30秒は同じものを返す |
| `board` | read | 見る repo の worktree と自分の Pull request（`Board`）。読み直す時期なら、読み始めてから返す（`checking: true`） |
| `refresh` | read | すぐに読み直し、`board` と同じものを返す |
| `watch` | write | 見る repo を `{ paths }` に、repo ごとのカンバン用のプラグインを `{ plugins }`（primary checkout からプラグインの名前）に変える。新しく足せるのは `options` にある GitHub の repo だけ。`plugins` が無ければ、前に選んだものを残す |

会話をカードに振り分け、カンバン用のプラグインでカードの列を決めるのは画面の部分（`src/cards.ts`）で、daemon の部分は会話を受け取らない。daemon の部分は、選んだプラグインの名前を覚えるだけで、プラグインを動かさない。GitHub の API は、repo 1つを1回読むと2点使う（GraphQL の上限は1時間に5000点）。
