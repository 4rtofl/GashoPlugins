# カンバン用のプラグイン

カンバンのカードを置く列と、その列に置いた理由を決める。どのプラグインを使うかは、カンバンの「見る repo」で repo ごとに選ぶ。

## 置き場

- `kanban/plugins/<名前>/index.ts` に1つ置く。中のファイルは分けてよい（`index.ts` から import する）。フォルダーの名前が、「見る repo」に出る名前になる
- git に載るのは、この README、`types.ts`、`example/` だけ。ほかのフォルダーは `.gitignore` で外してあるので、PR を出さずに書き換えられる
- カンバンに入るのは、カンバンをビルドした checkout にあるプラグインだけ。新しい worktree や、GitHub Actions でビルドしたものには、各自のプラグインは入らない
- 選んだプラグインがビルドに無い repo（別の checkout でビルドしたカンバンで選んだものなど）のカードは、「自分の番」に置く

## 書き方

`index.ts` で `state` を export する。型は [types.ts](types.ts)。見本は [example/index.ts](example/index.ts)。

```ts
import type { State } from "../types.ts";

export const state: State = (card) => {
  if (card.pr?.state === "merged") return { column: "done", reason: "マージ済み" };
  return { column: "mine" };
};
```

- `state` はカードを1枚受け取り、列と、カードに出す理由を返す。列は `mine`（自分の番）、`agent`（エージェント作業中）、`github`（GitHub 待ち）、`review`（レビュー待ち）、`done`（完了）
- 受け取るカード（`StateCard`）には、repo、worktree のフォルダーとブランチ、ブランチ名の Issue 番号、Pull request（番号、状態、Draft か）、Pull request の最終更新、その worktree の Claude Code の会話の状態が入る
- ブラウザーで、ボードを描くたびにカードごとに呼ぶ。カードだけを見て返し、通信やタイマーは使わない
- 例外を投げたときと、知らない列を返したときは、カードを「自分の番」に置き、「列を決められませんでした（<名前>）」と出す。何が起きたかは、カードを押すと開くメニューに出る

## 入れ替える

`npm run build -w kanban` でビルドし直すと、`kanban/dist` を `--link` で入れた Gasho のカンバンが、Gasho を起動し直さずに新しいプラグインで描き直す。
