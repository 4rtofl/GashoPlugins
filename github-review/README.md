# GitHub Review（github-review）

サイドバーの「レビュー」で、レビューする Pull request を探し、その行からレビュー用の worktree とセッションを用意する。github-implement は worktree を作った実装者がその Issue と Pull request を開くためのもので、こちらは手元にその Pull request の worktree が無いレビューする人のためのもの。working server の git と gh を使う。プラグインの API 1.12（ページのパネルと、送るときの Effort の切り替え）に対応した Gasho サーバーと gasho-daemon が要る。

- ページの上の段に、自分にレビューを頼まれた開いている Pull request（GitHub 全体。`review-requested:@me`）を、下の段に、対象リポジトリの Pull request を出す。対象リポジトリは、ヘッダーの「対象リポジトリ」から working server ごとに選ぶ（1台に30まで）。選べるのは、Gasho がセッションを起動できるフォルダー（Claude Code が信頼しているフォルダー）にある GitHub のリポジトリで、選んだものは working server のこのプラグイン専用のフォルダー（`~/.local/share/gasho/plugin-data/github-review/watched.json`）に覚える
- 検索欄は1つで、GitHub の Pull request の一覧と同じ書き方（`is:`・`author:`・`label:` など）で上下の段を絞り込む。最初は `is:open`。`sort:` を書かなければ新しく開いた順に並べる。行には、GitHub の一覧と同じく、状態のアイコン（Draft を含む）・題・ラベル・チェックの結果・番号と作者と開いた時刻・レビューの状態・コメントの数を出す。段ごとに50件まで出し、それより多いときは件数を出す。clone が Claude Code の信頼しているフォルダーに無いリポジトリの Pull request は、worktree を作れないので出さない（段の件数も、出す行の数）
- ページを開いているあいだ、1分おきに読み直す。読むのは GraphQL の問い合わせ1回（1点ほど。GraphQL の上限は1時間に5000点）で、gasho-daemon が30秒は同じ答えを返すので、いくつのブラウザーで開いていても1分に1回ほど。「更新」では、gasho-daemon が覚えている答えを使わずに読む
- 行の「worktree を作る」で、送る指示のテンプレートを選ぶ（いちばん上は「何も送らない」）。primary checkout と同じ親フォルダーに `review-<リポジトリ名>-<PR 番号>`（`4rtofl/GashoPlugins` の #158 なら `review-GashoPlugins-158`。リポジトリ名は GitHub の `OWNER/REPO` の `REPO` で、clone のフォルダー名ではない。1.7.0 より前に作った `review-<PR 番号>` も、レビュー用の worktree として扱い、片付けられる）を作り、その中でセッションを起動して、選んだテンプレートの指示を送る。セッションの画面には移らずにこのページに留まり、続けてほかの Pull request もレビューに回せる。起動したことを下の通知に出すので、そこの「セッションを開く」で開く。一覧が古くて worktree がもうあったときは、作らずに、そこで最後に使った Gasho のセッション（なければ起動したもの）を通知に出す（指示は送らない）。Claude Code がフォルダーを信頼していないときは、起動する前に確かめる
  - 同じ repo の Pull request は、`git fetch` してから、同じ名前のローカルのブランチを作って origin のブランチを追う（レビューする人が修正を push できる）。その名前のローカルのブランチがもうあれば、origin に無い commit が無いときだけ、origin に合わせて使う
  - fork の Pull request は、`refs/pull/<番号>/head` を取ってきて、detached HEAD にする
  - その Pull request の worktree（`review-<リポジトリ名>-<番号>`、同じ repo の Pull request ならそのブランチの worktree）がもうあれば、作らずに、上の段では「開く」を、下の段では「新たにセッションを作成する」を出す。「開く」は、その worktree で最後に使った Gasho のセッションを開く（なければ起動して開く）。「新たにセッションを作成する」は、その worktree で新しいセッションを起動して開く（worktree は増やさない）。worktree が複数の working server にあるときは、どちらもメニューで選ぶ
  - 同じ名前のフォルダーが、この repo の worktree でないものとしてあれば、作らずに理由を出す
  - テンプレートを送るときは、そのセッションの Effort を Max に切り替えてから送る（Gasho の入力欄の Effort のピッカーと同じく、そのセッションだけ）。切り替えられなかったとき（このモデルでは選べないなど）は、テンプレートはそのまま送り、ページの下に理由と「セッションを開く」を出す。Effort を切り替えられない gasho-daemon（0.6.0 より前）では、切り替えずに送る
- 自分の開いている Pull request で worktree があるもの（ふつうは、それを作った worktree）には、「worktree を作る」が出ない代わりに「レビューする」を出す。テンプレートを選ぶと、その worktree で新しいセッションを起動し（作ったときのセッションとは別にする）、「worktree を作る」と同じ指示を同じ Effort で送る。このページに留まり、通知の「セッションを開く」で開く。その worktree のセッションが作業しているあいだ（「レビュー中」）は押せない。サイドパネルにも出す
- worktree を作ってテンプレートを送るときは、テンプレートの終わりに、レビューの結果を Pull request のコメントとして投稿する指示を足す（設定でテンプレートを直しても、判定が取れなくならないように）。コメントは自分の GitHub アカウントで投稿されるので、1行目を「## 🤖 Agent によるレビュー」にし、最後の行に画面に出ない印 `<!-- gasho-review verdict=mergeable sha=<レビューした head の SHA> -->`（`verdict` は `mergeable` か `changes`）を入れてもらう
- `list` は、Pull request ごとに最新の10件のコメントを読み、自分が書いた印のうち最新のものを行に付ける（問い合わせは2点ほどになる）。また、自分が request changes を付けたかを見るため、request changes のレビューを最新の5件読む。行には、次のどれかを出す
  - レビュー中: worktree のセッションが作業中か応答待ち（送った指示が入力を待っているときも）で、今の head についての印が無い
  - マージ可能: 印が `mergeable` で、`sha` が今の head と同じ
  - 要修正: 印が `changes` で、`sha` が今の head と同じ
  - 再レビューが要る: 印の `sha` が今の head と違う（レビューのあとに push があった）。セッションが作業中なら「レビュー中」を出す
- 行（か題）を押すと、その Pull request のパネル（`pr`）を開く。Gasho のページのパネル（API 1.11）なので、セッションのパネルと同じく、パソコンではページの右に開き（左の端をドラッグして幅を変えられ、✕ か Esc で閉じる。開いている行をもう一度押しても閉じる）、スマホではページの代わりに開いて、上のバーの ← で一覧に戻る。URL は `#/p/github-review/review/p/pr/number=N&repo=OWNER%2FREPO`。中身は、レビューの状態とボタン、レビュー結果のコメント、チェックの結果、本文、最新の30件のコメントで、変更されたファイル・commit・レビューのコメントなどは GitHub で開くリンクから見る。daemon の `detail` で、1分おきに読み直す
- 「マージ可能」の行とサイドパネルに「マージしてもらう」を、「要修正」の行とサイドパネルに「差し戻す」を出す。押すと、その Pull request の worktree で最後に使った Gasho のセッションに指示を送る（無ければ起動してから送る。作業中なら、Gasho が終わるまで入力を待つ）。worktree が複数の working server にあるときは、メニューで選ぶ
  - 「マージしてもらう」は、確かめてから送る。Agent は、base とのコンフリクトがあれば base を取り込んで（rebase ではなく merge）解決して push し、チェックが通るのを待ち、approve してから、`gh pr merge --match-head-commit` でマージする。コンフリクトの解決で中身が変わったときは、マージせずに、その旨をコメントする（push で head が変わるので「再レビューが要る」に戻る）。マージのあと、設定で選んでいれば、GitHub の head のブランチを消す（fork のブランチは消さない。ローカルのブランチと worktree は、下の「終わったら worktree を片付ける」か「片付ける」で消す）
  - fork の Pull request で head に push できない（maintainer の変更を許していない）ときは、コンフリクトがあれば「マージしてもらう」を押せなくし、理由を出す
  - 「差し戻す」は、確かめてから送る。Agent がレビュー結果のコメントを元に request changes のレビューを付ける
  - 「マージしてもらう」と「差し戻す」は、手順に沿って進めるだけなので、セッションの Effort を Medium に切り替えてから送る。「修正してもらう」はコードを直すので、切り替えずに送る（レビューで Max にしたセッションなら Max のまま）。切り替えられなかったときは、送ったうえでページの下に理由を出す
  - 「マージしてもらう」と「差し戻す」の確かめるダイアログに「終わったら worktree を片付ける」があり、最初は選ばれている。選ぶと、gasho-daemon がそれを working server のこのプラグイン専用のフォルダー（`cleanups.json`）に覚え、行に「終わったら片付けます」と出す。Pull request がマージされたら（「マージしてもらう」）、頼んだあとに自分の request changes のレビューが付いたら（「差し戻す」）終わったとみなし、その worktree のセッションの作業が終わっていれば（作業中・応答待ち・入力待ちでなければ）、ページがその `review-<リポジトリ名>-<番号>` の worktree とローカルのブランチを、中のセッションと一緒に消す（Gasho の `useRemoveWorktree`、サイドバーの「削除…」と同じ。Pull request の head は push 済みとみなす）。消したら下に知らせを出す
    - マージされなかったとき（コンフリクトの解決で中身が変わって「再レビューが要る」に戻った、チェックが失敗した、など）は消さない。もう一度頼むと、そのときの選び方で覚え直す
    - 未コミットの変更か push していない commit があれば、消さずに、その理由を行に出す（自動ではもう試さない。「片付ける」は使える）
    - 消すのは、ページを開いているブラウザー。開いていないあいだに終わったものは、次にページを開いたときに消す。いくつかのブラウザーで開いていても、gasho-daemon が1つにだけ任せる
    - 手で「片付ける」などで worktree が無くなったら、覚えていたことは忘れる
  - 自分の Pull request は、GitHub の仕様で approve も request changes もできない。「マージしてもらう」では approve せずにマージし、「差し戻す」の代わりに「修正してもらう」を出して、Agent にその worktree で直して push してもらう
  - 設定の「「マージしてもらう」のマージ方法」（merge・squash・rebase。最初は merge）と「マージしたあと GitHub の head のブランチを消す」（最初は消す）は、すべてのブラウザーで共通
- テンプレートは、設定の「worktree を作ったセッションに送る指示のテンプレート」に、すべての repo で共通に持つ（すべてのブラウザーで共通）。設定画面の欄で、名前と本文を足す・直す・消す。本文の `{number}`・`{title}`・`{branch}`・`{url}` は、Pull request の番号・題・head のブランチ・URL に置き換えて送る
- `review-<リポジトリ名>-<番号>` の worktree がある行には「片付ける」を出す。押すと確かめてから、worktree とローカルのブランチを消す。未コミットの変更か、push していない commit（どの remote のブランチにも、Pull request の head にも無い commit）があれば、消さずに理由を出す。Pull request がマージか閉じられたら、行に「片付けてよい」と出す。マージか閉じられて上下の段から外れた Pull request も、`review-<リポジトリ名>-<番号>` の worktree があるあいだは、下の段のその repo の所に出す（対象リポジトリでなくても出し、検索の語では絞り込まない）

## daemon の部分のメソッド

| メソッド | 種類 | すること |
|---|---|---|
| `options` | read | 対象リポジトリに選べるもの（`RepoOption[]`）。`ctx.folders()` のフォルダーから作り、30秒は同じものを返す |
| `list` | read | `{ query, fresh? }` のページ（`Listing`）。Pull request ごとに、この working server の clone と worktree（`place`）を付ける |
| `detail` | read | `{ repo, number, fresh? }` のサイドパネルの中身（`PrDetail`）。本文・最新の30件のコメント・head のチェックと、この working server の clone と worktree（`pr.place`） |
| `watch` | write | 対象リポジトリを `{ paths }` に変える。新しく足せるのは `options` にある GitHub の repo だけ |
| `create` | write | `{ repo, number }` のレビュー用の worktree を作る。もうあれば、その場所を返す（`Created`） |
| `remove` | write | `{ repo, number }` のレビュー用の worktree とローカルのブランチを消す（`Removed`） |
| `cleanup` | write | `{ repo, number, action }` の「終わったら worktree を片付ける」。`follow`（`kind` は `merge` か `sendBack`）で覚え、`forget` で忘れ、`claim` でページが消す役を取り（`{ claimed }`）、`fail`（`problem`）で消せなかった理由を残す。`list` は、覚えている Pull request の `place.cleanup` に、終わったか（`done`）を付ける |

`create` と `remove` は、ブランチ名や fork かどうかを画面から受け取らず、gh で Pull request を読み直して決める。マージ・差し戻し・修正は daemon の部分ではなく、セッションの Agent が gh でする（プラグインは `session.input` で指示を送るだけで、GitHub を変えない）。git を動かすのは、`ctx.folders()` のフォルダーにある clone の中だけにする。「終わったら worktree を片付ける」で消すのは daemon の部分ではなく、ページ（Gasho の `useRemoveWorktree`、権限 `worktree.remove`）で、中のセッションも終わらせる。
