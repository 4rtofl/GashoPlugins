# GitHub Review（github-review）

サイドバーの「レビュー」で、レビューする Pull request を探し、その行からレビュー用の worktree とセッションを用意する。github-almighty は worktree を作った実装者がその Issue と Pull request を開くためのもので、こちらは手元にその Pull request の worktree が無いレビューする人のためのもの。working server の git と gh を使う。プラグインの API 1.3 に対応した gasho-daemon が要る。

- ページの上の段に、自分にレビューを頼まれた開いている Pull request（GitHub 全体。`review-requested:@me`）を、下の段に、対象リポジトリの Pull request を出す。対象リポジトリは、ヘッダーの「対象リポジトリ」から working server ごとに選ぶ（1台に30まで）。選べるのは、Gasho がセッションを起動できるフォルダー（Claude Code が信頼しているフォルダー）にある GitHub のリポジトリで、選んだものは working server のこのプラグイン専用のフォルダー（`~/.local/share/gasho/plugin-data/github-review/watched.json`）に覚える
- 検索欄は1つで、GitHub の Pull request の一覧と同じ書き方（`is:`・`author:`・`label:` など）で上下の段を絞り込む。最初は `is:open`。`sort:` を書かなければ新しく開いた順に並べる。行には、GitHub の一覧と同じく、状態のアイコン（Draft を含む）・題・ラベル・チェックの結果・番号と作者と開いた時刻・レビューの状態・コメントの数を出す。段ごとに50件まで出し、それより多いときは件数を出す。clone が Claude Code の信頼しているフォルダーに無いリポジトリの Pull request は、worktree を作れないので出さない（段の件数も、出す行の数）
- ページを開いているあいだ、1分おきに読み直す。読むのは GraphQL の問い合わせ1回（1点ほど。GraphQL の上限は1時間に5000点）で、gasho-daemon が30秒は同じ答えを返すので、いくつのブラウザーで開いていても1分に1回ほど。「更新」では、gasho-daemon が覚えている答えを使わずに読む
- 行の「worktree を作る」で、送る指示のテンプレートを選ぶ（いちばん上は「何も送らない」）。primary checkout と同じ親フォルダーに `review-<PR 番号>` を作り、その中でセッションを起動して開き、選んだテンプレートの指示を送る。Claude Code がフォルダーを信頼していないときは、起動する前に確かめる
  - 同じ repo の Pull request は、`git fetch` してから、同じ名前のローカルのブランチを作って origin のブランチを追う（レビューする人が修正を push できる）。その名前のローカルのブランチがもうあれば、origin に無い commit が無いときだけ、origin に合わせて使う
  - fork の Pull request は、`refs/pull/<番号>/head` を取ってきて、detached HEAD にする
  - その Pull request の worktree（`review-<番号>`、同じ repo の Pull request ならそのブランチの worktree）がもうあれば、作らずに、上の段では「開く」を、下の段では「新たにセッションを作成する」を出す。「開く」は、その worktree で最後に使った Gasho のセッションを開く（なければ起動して開く）。「新たにセッションを作成する」は、その worktree で新しいセッションを起動して開く（worktree は増やさない）。worktree が複数の working server にあるときは、どちらもメニューで選ぶ
  - 同じ名前のフォルダーが、この repo の worktree でないものとしてあれば、作らずに理由を出す
- テンプレートは、設定の「worktree を作ったセッションに送る指示のテンプレート」に、すべての repo で共通に持つ（すべてのブラウザーで共通）。設定画面の欄で、名前と本文を足す・直す・消す。本文の `{number}`・`{title}`・`{branch}`・`{url}` は、Pull request の番号・題・head のブランチ・URL に置き換えて送る
- `review-<番号>` の worktree がある行には「片付ける」を出す。押すと確かめてから、worktree とローカルのブランチを消す。未コミットの変更か、push していない commit（どの remote のブランチにも、Pull request の head にも無い commit）があれば、消さずに理由を出す。Pull request がマージか閉じられたら、行に「片付けてよい」と出す。マージか閉じられて上下の段から外れた Pull request も、`review-<番号>` の worktree があるあいだは、下の段のその repo の所に出す（対象リポジトリでなくても出し、検索の語では絞り込まない）

## daemon の部分のメソッド

| メソッド | 種類 | すること |
|---|---|---|
| `options` | read | 対象リポジトリに選べるもの（`RepoOption[]`）。`ctx.folders()` のフォルダーから作り、30秒は同じものを返す |
| `list` | read | `{ query, fresh? }` のページ（`Listing`）。Pull request ごとに、この working server の clone と worktree（`place`）を付ける |
| `watch` | write | 対象リポジトリを `{ paths }` に変える。新しく足せるのは `options` にある GitHub の repo だけ |
| `create` | write | `{ repo, number }` のレビュー用の worktree を作る。もうあれば、その場所を返す（`Created`） |
| `remove` | write | `{ repo, number }` のレビュー用の worktree とローカルのブランチを消す（`Removed`） |

`create` と `remove` は、ブランチ名や fork かどうかを画面から受け取らず、gh で Pull request を読み直して決める。git を動かすのは、`ctx.folders()` のフォルダーにある clone の中だけにする。
