# GitHub Almighty（github-almighty）

worktree の Issue（ブランチ名の番号）と Pull request（そのブランチのもの、手で足したもの）を、セッションと並んだタブで読み、GitHub を開かずに操作する。gh は gasho-daemon の `ctx.github` で動かす。プラグインの API 1.5 に対応した Gasho が要る。

- タブの行に、Issue と Pull request が 1 件ずつと、一覧と足す欄のある「GitHub」が並ぶ
- 1 件の画面は、題と状態、上の行（閉じる・開き直す・Draft の切り替え、担当、ラベル、Pull request のブランチ）と、タブに分かれる。タブは「会話」「コミット」「チェック」「ファイル」で、Issue は「会話」だけ
- 上の行の「Project」に、入っている Project（GitHub Projects）と項目の値を出す。Project に足したり外したり、単一選択・日付・数・文字の値を変えたりできる（イテレーションは出すだけ）。gh に `project` の権限が要り、無いときは `gh auth refresh -s project` で足すよう画面に出る
- 会話は、本文・コメント・レビューと、ラベル・担当を付けた・外した、閉じた・開き直した・マージしたを、時刻の順に 1 本の線に並べる
- 読み込み中は Skeleton、読めなかったときは Alert、操作の結果は Toast で出す。担当やラベルを外す・閉じるなど、元に戻せる操作は、Toast の「元に戻す」で取り消せる
- ここ 24 時間に開いた worktree を、設定 `refreshSeconds`（既定 60 秒、0 で止める）の間隔で裏でも読み直す。設定画面に、間隔ごとに GitHub の上限の半分に収まる worktree の数と、working server ごとのいまの点数を半円のゲージで出す
- 部品は easyui（easyui.site）のものを `src/web/ui/` に写し、Gasho の色に直した（framer-motion を同梱する）

## 足すときの置き場

足すものは、どれも 1 つ 1 ファイルで置く。画面と daemon の部分は、フォルダーの中のファイルを全部読み込む（Vite の `import.meta.glob`）ので、ほかのファイルに登録を書き足さない。並行の Pull request が同じ行を変えてぶつからないようにするため。

| 足すもの | 置き場 | 書き出すもの |
|---|---|---|
| daemon の部分の操作 | `src/daemon/ops/<操作>.ts` | `{ kind: "read" \| "write", run(params, ctx) }`。ファイル名が操作の名前になる |
| 1 件の読み取り（`gh issue view` / `gh pr view --json`）に足す項目 | `src/daemon/detail/<名前>.ts` | `{ fields: { issues?, pulls? }, read(raw, item) }`。足す型は同じファイルで `declare module "../../types.ts"` に書く（`detail/commits.ts` が見本） |
| 1 件の画面のタブ | `src/web/item/tabs/<名前>.tsx` | `ItemTab`（`src/web/item/parts.ts`） |
| 題とタブのあいだの行 | `src/web/item/sections/<名前>.tsx` | `ItemSection` |
| 会話の項目、会話の下に出すもの | `src/web/item/conversation/<名前>.tsx` | `ConversationPart`。`useEntries` は項目を返すフックで、`End` は線の下に出す部品 |
| テスト | `test/<操作>.test.ts` | |

- 部品の中では、`useItem()`（`src/web/item/context.tsx`）で、いまの Issue・PR と、変える操作を走らせる `run` を使う。`run` に `undo` を渡すと、Toast に「元に戻す」が出る。操作のあとは、1 件とタブを読み直す。部品が自分で読むものは `useAfterChange` で読み直す
- 画面から daemon の部分を呼ぶときは、`readOp(machine, "<操作>", params)`（`useRequest` に渡す）と `useWriteOp()`（`src/web/daemon.ts`）を使う
- `gasho-plugin.json` の `version` は、機能を足す Pull request では上げない。公開するときに 1 回上げる

## daemon の部分のメソッド

`gasho-plugin.json` の `methods` は `read`（30 秒）と `write`（60 秒）の 2 つだけで、どちらも `{ op: "<操作>", ... }` を受け取り、`src/daemon/ops/` の操作を走らせる。`write` の操作を `read` で呼ぶと断る（`write` の呼び出しだけが Gasho の操作のログに残るため）。

操作の名前・引数・結果は、`src/daemon/ops/<操作>.ts` の先頭のコメントに書く。ここには表にしない（操作を足す Pull request が、同じ表に行を足してぶつかるため）。
