# カンバン用のプラグイン

カンバンのカードを置く列と、その列に置いた理由と、カードのメニューに出す指示を決める。カードに無い情報（CI、コンフリクト、ラベルなど）が要るときは、gh で読む。どのプラグインを使うかは、カンバンの「見る repo」で repo ごとに選ぶ。

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
  if (card.issue === undefined) return { column: "mine" };
  return { column: "mine", actions: [{ label: "Issue を実装する", text: `/issue-implement ${card.issue}` }] };
};
```

- `state` はカードを1枚受け取り、列と、カードに出す理由と、メニューに出す指示（`actions`）を返す。列は `mine`（自分の番）、`agent`（エージェント作業中）、`github`（GitHub 待ち）、`review`（レビュー待ち）、`done`（完了）
- 指示は、メニューに出すラベル（`label`）と、Claude に送る文（`text`）の組を、出す順に並べる。スキルを送るなら `text` を `/<スキル> <引数>` にする。メニューで押すと、その worktree で最後に使った Gasho のセッションに `text` を送る。Gasho のセッションが無ければ、その worktree で起動してから送る（Orca や端末で起動した会話には送れない）。worktree の無いカードでは押せない
- 受け取るカード（`StateCard`）には、repo、worktree のフォルダーとブランチ、ブランチ名の Issue 番号、Pull request（番号、状態、Draft か）、Pull request の最終更新、その worktree の Claude Code の会話の状態が入る
- ブラウザーで、ボードを描くたびにカードごとに呼ぶ。カードと、`fetch` が返した値（下の「カードに無い情報を読む」）だけを見て返し、通信やタイマーは使わない
- 例外を投げたとき、知らない列を返したとき、`label` か `text` が空の指示を返したときは、カードを「自分の番」に置き、「列を決められませんでした（<名前>）」と出し、指示を出さない。何が起きたかは、カードを押すと開くメニューに出る

## カードに無い情報を読む

`index.ts` で `fetch` も export すると、その返した値が `state` の2つ目の引数に入る。見本は、開いた Pull request の CI とコンフリクトを読み、CI が動いているカードを「GitHub 待ち」に置く。

```ts
import type { Fetch, State } from "../types.ts";

type Info = { labels: Record<number, string[]> };

export const fetch: Fetch<Info> = async (repo, { github }) => {
  const { stdout } = await github.read(["pr", "list", "--repo", repo.repo, "--author", "@me", "--json", "number,labels"]);
  const prs = JSON.parse(stdout) as { number: number; labels: { name: string }[] }[];
  return { labels: Object.fromEntries(prs.map((p) => [p.number, p.labels.map((l) => l.name)])) };
};

export const state: State<Info> = (card, info) => {
  if (card.pr && info?.labels[card.pr.number]?.includes("blocked")) return { column: "github", reason: "blocked" };
  return { column: "mine" };
};
```

- `fetch` は working server の gasho-daemon で、repo ごとに呼ぶ。受け取るのは、カンバンがその repo で読んだもの（`FetchRepo`：repo、primary checkout と worktree、自分の開いた Pull request と閉じた Pull request）と、gh を動かす `github.read`（SDK の `ctx.github.read`。gh の引数を `gh` を付けずに渡し、repo は `--repo` で指す。`gh api graphql` では `{ repo }` を指定に足す）
- 返す値は JSON にできるもので、JSON にして 256KB まで。そのままブラウザーに送られ、`state` に入る。`fetch` が値を返すまでと、`fetch` が無いときは、`state` には `undefined` が入る
- 呼ぶのは、カンバンが repo を読み直す2回に1回（2分に1回）と、「今すぐ見直す」を押したとき、プラグインを選んだとき。GitHub の GraphQL は1時間に5000点までで、カンバン自体も repo 1つで1時間に120点使うので、1回に使う点（gh の1回でたいてい1〜2点）を少なくする。GraphQL の残りが1000点を切ると、残りが戻る時刻まで呼ばない
- 例外を投げたときと、60秒で終わらないときは、前に返した値を `state` に渡したまま、カンバンの上に「カンバン用のプラグイン（<名前>）の fetch が失敗しました」と出す
- gh は gasho-daemon がまとめて動かし、同じ引数の結果を30秒覚えて、ほかのプラグインの読み込みにも返す。`fetch` は gh を `github.read` だけで動かし、`node:` のモジュールを import しない（`index.ts` は、daemon.js と一緒に web.js のビルドにも入る）

## 入れ替える

`npm run build -w kanban` でビルドし直すと、`kanban/dist` を `--link` で入れた Gasho のカンバンが、Gasho を起動し直さずに新しいプラグインで描き直す。`fetch` は、gasho-daemon が daemon の部分を新しい版に入れ替えたあとの、最初の読み直しで呼ぶ。
