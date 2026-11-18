# GitHub Implement（github-implement）

worktree の Issue（ブランチ名の番号）と Pull request（そのブランチのもの、手で足したもの）を、セッションと並んだタブで読み、GitHub を開かずに操作する。gh は gasho-daemon の `ctx.github` で動かす。プラグインの API 1.10 に対応した Gasho が要る。マージ済みの worktree を消すため、権限 `worktree.remove` を使う。

- タブの行に、Issue と Pull request が 1 件ずつと、一覧と足す欄のある「GitHub」が並ぶ。Issue と Pull request のタブのアイコンは、GitHub と同じ形と色で状態（Open・Draft・マージ済み・閉じた・対応しないで閉じた・重複で閉じた）を出す
- 1 件の画面は、題と、状態の行（右端に閉じる・開き直す・Draft の切り替え・会話のロックなどのボタン）、見出しをそろえた行（担当、ラベル、Pull request のブランチなど）と、タブに分かれる。タブは「会話」「コミット」「チェック」「ファイル」で、Issue は「会話」だけ
- マージ済みの Pull request を、その head のブランチの worktree（main の worktree ではないもの）で開くと、「マージ済み」の枠に「worktree とセッションを削除」のボタンを出す。確かめのダイアログに、worktree のフォルダー・ブランチと、一緒に終わるセッションの名前を出し、「ローカルのブランチも消す」は既定で入れておく。Pull request の head の commit を push 済みとして渡すので、squash でマージして GitHub のブランチを消したあとでも、手元の commit が head までならそのまま消せる。未コミットの変更や push していない commit があるときは件数を出し、「変更を捨てて削除」をもう一度押したときだけ消す。消えると Gasho がホームへ移る。working server がオフラインのときや、gasho-daemon が古いときは、ボタンを押せなくして理由を出す
- 「Project」の行に、入っている Project（GitHub Projects）と項目の値を出す。Project に足したり外したり、単一選択・日付・数・文字の値を変えたりできる（イテレーションは出すだけ）。gh に `project` の権限が要り、無いときは `gh auth refresh -s project` で足すよう画面に出る
- 会話は、本文をいちばん上に、その下にコメント欄を置き、コメント・レビューと、ラベル・担当を付けた・外した、閉じた・開き直した・マージしたを、新しい順に並べる（GitHub の新しい Pull request の画面と同じ）。コメントは新しい 200 件までにし、1 件の答えが 8MB を超えるときは古いコメントとレビューから省く。省いた件数は、いちばん下に出す
- 読み込み中は Skeleton、読めなかったときは Alert、操作の結果は Toast で出す。担当やラベルを外す・閉じるなど、元に戻せる操作は、Toast の「元に戻す」で取り消せる
- 本文・コメント・レビューに、GitHub と同じ 8 種類のリアクションを付け外しできる。絵文字にポインターを置くと、付けた人を 10 人まで名前で出す
- ここ 24 時間に開いた worktree を、設定 `refreshSeconds`（既定 60 秒、0 で止める）の間隔で裏でも読み直す。設定画面に、間隔ごとに GitHub の上限の半分に収まる worktree の数と、working server ごとのいまの点数を半円のゲージで出す
- 間隔ごとに gh で読むのは、worktree のタブの読み取り（1 点）だけにする。そこで分かる各 Issue・Pull request の版（更新日時。開いている Pull request は、head と base のコミット、マージの可否、チェックの状態ごとの数も）が同じあいだは、1 件の本文・コメント・ファイルなどを、gasho-daemon が覚えた答えから返す。版が変わったときと、前に読んでから 10 分たったときだけ gh で読み直す。更新日時を変えないリアクションや Project の値は、10 分以内に出る。再読み込みのボタン（⌘K の「再読み込み」も）を押すと、そのリポジトリのタブ・1 件・会話などの部品を、押した後に gh で読んだ答えで出す
- ラベルが 200 件以上、担当にできる人が 100 人以上いるリポジトリでは、選ぶ一覧に入れた語を GitHub でも探す（GitHub は語の先頭が合うものを返す）。ラベルの「新しく作る」は、GitHub で見つからなかった名前にだけ出す。新しい Pull request の base の候補は、commit の新しいブランチから 100 件（ブランチは名前の順に 1000 件まで読む）
- 裏の読み直しで増えたコメント・レビュー・終わったチェックの数を、Issue・Pull request のタブに出す（タブを開くと消える）。⌘K（Ctrl+K）で、いまの画面の操作と worktree の Issue・Pull request を探して実行できる。本文とコメントの #番号 はリンクの色で出し、押すと GitHub で開く。ポインターを置くと、GitHub と同じカード（リポジトリと作られた日、題と番号、状態、本文の書き出し、ラベル、自分が担当・作成・コメントしたか）が出る
- 部品は easyui（easyui.site）のものを `src/web/ui/` に写し、Gasho の色に直した（framer-motion を同梱する）

## 足すときの置き場

足すものは、どれも 1 つ 1 ファイルで置く。画面と daemon の部分は、フォルダーの中のファイルを全部読み込む（Vite の `import.meta.glob`）ので、ほかのファイルに登録を書き足さない。並行の Pull request が同じ行を変えてぶつからないようにするため。

| 足すもの | 置き場 | 書き出すもの |
|---|---|---|
| daemon の部分の操作 | `src/daemon/ops/<操作>.ts` | `{ kind: "read" \| "write", run(params, ctx) }`。ファイル名が操作の名前になる |
| 1 件の読み取り（`gh issue view` / `gh pr view --json`）に足す項目 | `src/daemon/detail/<名前>.ts` | `{ fields: { issues?, pulls? }, read(raw, item) }`。足す型は同じファイルで `declare module "../../types.ts"` に書く（`detail/commits.ts` が見本） |
| 1 件の画面のタブ | `src/web/item/tabs/<名前>.tsx` | `ItemTab`（`src/web/item/parts.ts`） |
| 題とタブのあいだの行 | `src/web/item/sections/<名前>.tsx` | `ItemSection`。`place` が `"actions"` なら状態の行の右端のボタン、`"row"` なら見出しをそろえた行（`Row`、`src/web/item/row.tsx`）、無ければその下の枠 |
| 会話の項目、本文の下に出すもの | `src/web/item/conversation/<名前>.tsx` | `ConversationPart`。`useEntries` は項目を返すフックで、`UnderBody` は本文の下（項目の上）に出す部品。項目の `pin` で、時刻によらずいちばん上か下に置ける |
| 1 件の画面の ⌘K の操作 | `src/web/item/commands/<名前>.tsx` | `ItemCommands`（`src/web/item/palette.tsx`）。`useCommands` は、いま走らせられる操作を返すフック |
| テスト | `test/<操作>.test.ts` | |

- 部品の中では、`useItem()`（`src/web/item/context.tsx`）で、いまの Issue・PR と、変える操作を走らせる `run` を使う。`run` に `undo` を渡すと、Toast に「元に戻す」が出る。操作のあとは、1 件とタブを読み直す。部品が自分で読むものは `useAfterChange` で読み直す
- 画面から daemon の部分を呼ぶときは、`readOp(machine, "<操作>", params)`（`useRequest` に渡す）と `useWriteOp()`（`src/web/daemon.ts`）を使う
- `gasho-plugin.json` の `version` は、機能を足す Pull request では上げない。公開するときに 1 回上げる

## daemon の部分のメソッド

`gasho-plugin.json` の `methods` は `read`（30 秒）と `write`（60 秒）の 2 つだけで、どちらも `{ op: "<操作>", ... }` を受け取り、`src/daemon/ops/` の操作を走らせる。`write` の操作を `read` で呼ぶと断る（`write` の呼び出しだけが Gasho の操作のログに残るため）。

操作の名前・引数・結果は、`src/daemon/ops/<操作>.ts` の先頭のコメントに書く。ここには表にしない（操作を足す Pull request が、同じ表に行を足してぶつかるため）。
