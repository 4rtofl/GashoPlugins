# カンバン用のプラグイン

カンバンのカードを置く列と、その列に置いた理由と、カードのメニューに出す指示を決める。カードに印を付け、ボードの上に見出しを出すこともできる。カードに無い情報（CI、コンフリクト、ラベル、デプロイなど）が要るときは、gh や working server のコマンドで読む。どのプラグインを使うかは、カンバンの「見る repo」で repo ごとに選ぶ。

## 置き場

- このフォルダーが置き場で、working server の `~/.local/share/gasho/plugin-data/kanban/plugins/` にある（`XDG_DATA_HOME` を変えていれば、その下の `gasho/plugin-data/kanban/plugins/`）。「見る repo」の画面に、working server ごとの置き場のパスが出る
- `<名前>/index.ts` に1つ置く。中のファイルは分けてよい（`index.ts` から import する）。フォルダーの名前が、「見る repo」に出る名前になる
- カンバンが動き始めるたび（カンバンを更新したときや、gasho-daemon を起動し直したとき）に、`AGENTS.md`、`CLAUDE.md`、`types.ts`、`place.ts`、`check.ts`、`package.json`、`tsconfig.json` を置き直す。書き換えても戻るので、これらのファイルは書き換えない
- `example/` は見本で、フォルダーが無いときだけ置く。書き換えても消してもよい（消すと、次にカンバンが動き始めたときに置き直す）。各自のプラグインと `cards/` は、カンバンが書き換えない
- ファイルを保存すると、カンバンが読み込み直し、開いているボードを描き直す。Gasho とカンバンを起動し直さなくてよい。`fetch` を書き換えたときは、そのプラグインを選んだ repo の `fetch` をすぐに呼び直す
- 読み込めないプラグイン（構文の誤り、`state` が無い、import できないものを import している、など）は、ファイルと行と理由をボードの上に出す。直して保存すると消える。そのプラグインを選んだ repo のカードは「自分の番」に置く

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
- 受け取るカード（`StateCard`）には、repo、worktree のフォルダーとブランチ、ブランチ名の Issue 番号、Pull request（番号、状態、Draft か）、Pull request の最終更新、その worktree の Claude Code の会話の状態が入る。Pull request は、そのブランチの自分のもの（fork のブランチから出したものは入れない。閉じたものは、worktree がその最後の commit にあるときだけ）。github-review が作った review の worktree では `review` が `true` になり、Pull request はレビューするもの（ほかの人のもの）になる
- ブラウザーで、ボードを描くたびにカードごとに呼ぶ。カードと、`fetch` が返した値（下の「カードに無い情報を読む」）だけを見て返し、通信やタイマーは使わない
- 例外を投げたとき、知らない列を返したとき、`label` か `text` が空の指示を返したときは、カードを「自分の番」に置き、「列を決められませんでした（<名前>）」と出し、指示を出さない。何が起きたかは、カードを押すと開くメニューに出る

### 書き方の決まり

カンバンは、各ファイルから型を取り除いただけのものを動かす（Node.js の型の除去と同じ）。`fetch` は working server の Node.js で、`state` と `headings` はブラウザーで、同じコードを動かす。

- 型だけを読む import は `import type` にする（`import { type X }` でもよい）。値を読む import には、拡張子 `.ts` を付ける（`./stacks.ts`）
- import できるのは、この置き場の `.ts` のファイルだけ。`node:` のモジュールや npm のパッケージ、`import()` は使えない。ファイルどうしが互いに import する（輪になる）書き方もできない
- `enum`、`namespace`、コンストラクターの引数に付けた `private` などの、型を取り除くだけでは動かない書き方は使えない（`tsconfig.json` の `erasableSyntaxOnly` で、`tsc` が見つける）
- ファイルのいちばん外側で、ブラウザーや Node.js にしか無いもの（`document`、`process` など）を使わない

## カードに無い情報を読む

`index.ts` で `fetch` も export すると、その返した値が `state` の2つ目の引数に入る。見本は、開いた Pull request の CI とコンフリクトを gh で読み、CI が動いているカードを「GitHub 待ち」に置く。デプロイのスクリプトを動かしているプロセスも `ps` で探す（下の「デプロイした Stack を出す」）。

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

- `fetch` は working server の gasho-daemon で、repo ごとに呼ぶ。受け取るのは、カンバンがその repo で読んだもの（`FetchRepo`：repo、primary checkout と worktree、自分の開いた Pull request と閉じた Pull request）と、次の3つ
  - `github.read`：gh を動かす（Gasho のプラグインの SDK の `ctx.github.read`）。gh の引数を `gh` を付けずに渡し、repo は `--repo` で指す。`gh api graphql` では `{ repo }` を指定に足す
  - `exec`：working server でコマンドを動かす（SDK の `ctx.exec`。シェルを通さない。既定で30秒で止める）。gh には使わず、`github.read` を使う
  - `store`：次に呼ぶときまで残しておく値の置き場。`store.get()` で前に `store.set(値)` で入れたものを読む（JSON にして 256KB まで）。repo ごと・プラグインごとに、working server のカンバンのフォルダー（`~/.local/share/gasho/plugin-data/kanban/stores/<名前>/`）のファイルに書くので、gasho-daemon を起動し直しても残る
- 返す値は JSON にできるもので、JSON にして 256KB まで。そのままブラウザーに送られ、`state` に入る。`fetch` が値を返すまでと、`fetch` が無いときは、`state` には `undefined` が入る
- 呼ぶのは、カンバンが repo を読み直す2回に1回（2分に1回）と、「今すぐ見直す」を押したとき、プラグインを選んだとき、`fetch` を書き換えて保存したとき。カンバンが読み直すのは、どこかのブラウザーでカンバンを開いているあいだだけなので、閉じているあいだに始まって終わったこと（デプロイなど）は `fetch` から見えない。GitHub の GraphQL は1時間に5000点までで、カンバン自体も repo 1つで1時間に120点使うので、1回に使う点（gh の1回でたいてい1〜2点）を少なくする。GraphQL の残りが1000点を切ると、残りが戻る時刻まで呼ばない
- 例外を投げたときと、60秒で終わらないときは、前に返した値を `state` に渡したまま、カンバンの上に「カンバン用のプラグイン（<名前>）の fetch が失敗しました」と出す
- gh は gasho-daemon がまとめて動かし、同じ引数の結果を30秒覚えて、ほかのプラグインの読み込みにも返す

## カードに印を付ける

`state` が `marks` も返すと、カードに印を出す。それぞれ `text`（印の文言）、`detail`（ポインターを重ねたときと、カードのメニューに出す説明）、`active`（今起きていること。黄色で出し、1行の簡潔なカードにも出す）。`text` が空の印を返すと、カードを「自分の番」に置き、「列を決められませんでした（<名前>）」と出す。

## ボードの上に見出しを出す

`index.ts` で `headings` も export すると、その返した見出しをボードの上に並べる。`headings(repo, fetched)` は、プラグインを選んだ repo ごとに、ブラウザーでボードを描くたびに呼び、`state` と同じく通信やタイマーは使わない。見出しは `label`（太字で出す名前）、`text`、`at`（起きた時刻。ミリ秒。「〜前」で出す）、`active`（今起きていること。黄色で出す）、`detail`（ポインターを重ねたときに出す説明）。repo や working server が複数あるときは、見出しの前にその名前を出す。例外を投げたときと、`label` が空の見出しを返したときは、「見出しを出せませんでした（<名前>）」と出す。

## デプロイした Stack を出す

見本（[example/stacks.ts](example/stacks.ts)）は、working server でデプロイのスクリプトを動かしているプロセスを `fetch` で探し、Stack ごとに最後にデプロイした worktree を `store` に記録する。

- スクリプトの名前と、Stack の名前を渡す引数は、`DEPLOY` に書く（既定は `deploy.sh` と `--stage`。`./deploy.sh --stage dev1` や `--stage=dev1`）。見出しに出す Stack を決めておくなら `DEPLOY.stacks` に、デプロイしない呼び方の引数は `DEPLOY.skip` に書く
- `ps axww -o pid=,command=` で、スクリプトを動かしているプロセスを探す（`zsh -c '… ./deploy.sh …'` のように、コマンドを文字列で渡したシェルは数えない）。相対パスで動かしたスクリプトは、`lsof` でプロセスの作業フォルダーを読み、どの worktree かを決める（`lsof` が無い working server では数えない）
- デプロイ中の worktree のカードは「GitHub 待ち」に置いて「<Stack> デプロイ中」の印を、最後にデプロイした worktree のカードには Stack の名前の印を付ける。ボードの上には、Stack ごとに最後にデプロイした worktree と、デプロイを最後に見た時刻を出す
- 同じ Stack に、あとから別の worktree がデプロイを始めたら、あとから始めたほうを記録する

## 確かめる

型の確認とテストには、TypeScript と Node.js の型が要る。置き場で一度 `npm install` してから流す（Node.js 24 以上）。

| すること | コマンド |
|---|---|
| 型を確かめる | `npx tsc`（`npm run typecheck`） |
| テストを流す（見本は [example/index.test.ts](example/index.test.ts)） | `node --test`（`npm test`） |
| 実際のカードに `state` を当てた結果を一覧にする | `node check.ts [<名前>]`（`npm run check`） |

- カンバンの「カードを書き出す」を押すと、見ている repo ごとに、カード（`state` が受け取る `StateCard`）と、repo（`fetch` と `headings` が受け取る `FetchRepo`）と、選んだプラグインの `fetch` が最後に返した値を、`cards/<OWNER>__<REPO>.json` に書き出す。押すたびに上書きする
- `node check.ts <名前>` は、`cards/` のカードに `<名前>` の `state` を当て、列ごとに、カードと理由・印・指示を出す。見出しも出す。`<名前>` を省くと、書き出したときに repo ごとに選んでいたプラグインを当てる。`fetch` の結果は、書き出したときに選んでいたプラグインに当てるときだけ渡す（ほかのプラグインには `undefined` を渡す）
- 列を決められないカード（ボードで「自分の番」に置き、「列を決められませんでした」と出すもの）は、最後に理由と一緒に出し、終了コードを 1 にする
- 書き出したカードは、テストの材料にもできる（`JSON.parse(fs.readFileSync(...))` で読み、`state` に渡す）
