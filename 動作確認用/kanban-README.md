# カンバン（kanban）

サイドバーの「カンバン」で、選んだ repo の worktree と自分の Pull request を、5つの列（自分の番、エージェント作業中、GitHub 待ち、レビュー待ち、完了）のボードに並べる。Gasho の PR #8（元は [4rtoflow/Dashboard](https://github.com/4rtoflow/Dashboard)）をプラグインに移したもの。カードをどの列に置くかと、カードのメニューから Claude に送る指示は、人によって進め方が違うので、repo ごとに選んだカンバン用のプラグイン（[plugins/README.md](plugins/README.md)）が決める。プラグインを選んでいない repo のカードは、「自分の番」に並べる。

- 見る repo は、「見る repo」から working server ごとに選ぶ（1台に30まで）。選べるのは、Gasho がセッションを起動できるフォルダー（Claude Code が信頼しているフォルダー）にある GitHub の repo で、worktree がいくつあっても、repo ごとに primary checkout の1つにまとめる。選んだ repo には、カードを置く列を決めるカンバン用のプラグインも選べる。選んだ repo とプラグインは、working server のこのプラグイン専用のフォルダー（`~/.local/share/gasho/plugin-data/kanban/watched.json`）に覚える。選び直すと、ホームの「最近の操作」に残る
- daemon の部分が、repo ごとに `git worktree list` と、working server の gh で自分の Pull request（開いているものと閉じたもの）を読む。gh は、gasho-daemon に実行してもらう（`ctx.github`）。読むのは、どこかのブラウザーでカンバンを開いているあいだだけで、1分に1回まで（画面が1分おきに呼び、前に読み始めてから50秒たっていれば読み直す）。「今すぐ見直す」で、gasho-daemon が覚えている gh の結果を使わずに、すぐに読み直す（10秒以内に読み始めたばかりなら読まない）。読めなかった repo は、前に読めたカードを出したまま、理由を上に出す
- repo に選んだカンバン用のプラグインに `fetch` があれば、読み直す2回に1回（「今すぐ見直す」と、プラグインを選んだときはすぐ）、daemon の部分がそれを呼び、返した値を画面の部分に送ってプラグインの `state` に渡す。GitHub の GraphQL の残りが1時間に1000点を切ったら（`gh api rate_limit` で読む。これは点を使わない）、残りが戻る時刻まで `fetch` を呼ばず、前に返した値を使い、そうボードの上に出す。`fetch` が失敗した repo は、前に返した値を使い、理由を上に出す
- worktree 1つを1枚のカードにする。worktree のない、開いた Pull request も1枚のカードにする。primary checkout は、開いた Pull request があるか、会話が作業しているか答えを待っているときだけ出す
- カードには、Pull request の状態（まだない、開いている、Draft、マージ済み、クローズ済み）をアイコンで出し、カンバン用のプラグインがその列に置いた理由を一言出す。プラグインが列を決められなかったカードは「自分の番」に置き、そう出す。Claude Code の会話は、Gasho が起動したものに限らず、その working server で動いているものをすべて見て、会話の作業フォルダーを含む、いちばん深い worktree のカードに付ける
- カードを押すとメニューが開き、カンバン用のプラグインが決めた指示を、その worktree で最後に使った Gasho のセッションに送れる（なければ、その worktree で起動して送る）。送ったあともボードのままで、下に出る知らせからセッションを開ける。自由に書いた指示は、メニューからは送れない（セッションの画面で送る）。メニューからは、その worktree の Gasho のセッションも開ける（なければ、その worktree で起動して開く）。Pull request があれば、GitHub で開ける。PR の題やタグを押しても GitHub には移らない。Claude Code がフォルダーを信頼するかを聞いたときは、起動する前に確かめる
- 同じ列の中では、Pull request が長く動いていないものを上に出す
- PC では、カンバンをページの高さに収め、カードがページの下端を超える列は、その列の中でスクロールする（スクロールバーは出さない）。列の上で横にスクロールすると、ボードが横に動く。スマホでは列を1つずつタブで出し、ページごとスクロールする
- 列ごとに、並び（既定の順か、Issue 番号・PR 番号・最終更新の昇順・降順）、表示（詳細か、1行の簡潔）、幅を変えられる。番号や更新の時刻がないカードは、どちらの向きでも下に並べる。最初はレビュー待ちと完了を簡潔にする。幅は、列の右端のつまみをドラッグするか、つまみを選んで左右キー（Shift で4倍）で変え、ダブルクリックで元に戻す。どれも、ブラウザーごとに覚える
- 使えるのは、プラグインの API 1.3 に対応した gasho-daemon の working server。オフラインの working server の repo のカードは出さない

## daemon の部分のメソッド

| メソッド | 種類 | すること |
|---|---|---|
| `options` | read | 見る repo に選べるもの（`RepoOption[]`）。`ctx.folders()` のフォルダーから作り、30秒は同じものを返す |
| `board` | read | 見る repo の worktree と自分の Pull request、カンバン用のプラグインの `fetch` が返した値（`Board`）。読み直す時期なら、読み始めてから返す（`checking: true`） |
| `refresh` | read | gasho-daemon が覚えている gh の結果を使わずにすぐに読み直し（`fetch` も呼ぶ）、`board` と同じものを返す |
| `watch` | write | 見る repo を `{ paths }` に、repo ごとのカンバン用のプラグインを `{ plugins }`（primary checkout からプラグインの名前）に変える。新しく足せるのは `options` にある GitHub の repo だけ。`plugins` が無ければ、前に選んだものを残す。`fetch` のあるプラグインを選んだ repo があれば、読み直す |

会話をカードに振り分け、カンバン用のプラグインの `state` でカードの列を決めるのは画面の部分（`src/cards.ts`）で、daemon の部分は会話を受け取らない。daemon の部分は、選んだプラグインの名前を覚え、その `fetch` を呼ぶ（`src/daemon/reader.ts`）。GitHub の API は、repo 1つを1回読むと2点使う（GraphQL の上限は1時間に5000点）ので、カンバンを開いているあいだ、repo 1つで1時間に120点になる。`fetch` は2分に1回なので、見本（1回2点ほど）なら60点が足される。

動作確認用に足した行
