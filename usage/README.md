# Usage（usage）

セッションの画面で、入力欄の下の行に、そのセッションの Context Window の使用率をリングで出す。リングを押すと Popover が開き、Context Window の使用量と、Claude.ai のプランで決まっている使用量の上限を出す。上限には、すべてのモデルを合わせた週の上限のほかに、Fable のようなモデルごとの週の上限と、プランにあれば5時間の上限も出す。

プラグインの API 1.4 に対応した Gasho が要る（Gasho の PR #32）。入力欄の下の部品（P14、`composerFooter`）、SDK の `Popover`、`SessionInfo.context` と `SessionInfo.limits`、プラグイン専用のフォルダーで動く Claude Code をセッションとして扱わない決まりを使う。どれも Gasho の [docs/plugins.md](https://github.com/4rtofl/Gasho/blob/main/docs/plugins.md) に書いてある。

## 決めたこと

1. リングには、そのセッションの Context Window の使用率だけを出す。使用量の上限は Popover に出す
2. Context Window の値は、Gasho から起動したセッションで、Claude Code がステータスラインに渡すものを使う。gasho-daemon が中継して `SessionInfo.context` に入れる
3. 使用量の上限は、このプラグインの daemon の部分が、Claude Code の `get_usage` で読む。試験中の API なので、読めないときは、ステータスラインで受け取った上限（`SessionInfo.limits`）を出す。読んだあとに返答があったときも、ステータスラインの新しいほうを出す
4. 5時間の上限は、プランによってない。あるときだけ出す
5. Popover は、Gasho の SDK のものを使う。プラグインの CSS は、ページの末尾（ポータル）に出した中身には、SDK の `Popover` の中でしか当たらない

## 画面

### リング

リングは、入力欄の下の行で、文字数のすぐ左に出す。キーの案内は、幅が 640px 未満の画面とタッチ端末では隠れるが、リングは文字数と同じく、いつも出す。

```
┌──────────────────────────────────────────────┐
│ Agent への指示を入力…                        │
│ [＋] [既定 ▾] [High ▾]                [送信] │
└──────────────────────────────────────────────┘
  ↵ で送信  ⇧↵ で改行              ◔ 36%  0/20000
                                   └ リング
```

16px のリングと「36%」の数字で、使用率を出す。色は、70% 未満は文字数と同じ色、70% 以上は黄色、90% 以上は赤にする。リングは Popover を開くボタンで、スクリーンリーダーには「コンテキスト 36% 使用。使用量の詳細を開く」と読ませる。

セッションに `context` がないときは、何も出さない。プラグインの API 1.4 より古い gasho-daemon、Gasho の外で起動したセッション、最初の返答の前がこれに当たる。

### Popover

確かめたときの値で描くと、次のようになる。リセットの時刻は、ブラウザーの時間帯で出す（図は日本時間）。

```
┌──────────────────────────────────────┐
│ コンテキスト                    36%  │
│ ███████░░░░░░░░░░░░░                 │
│ 355,897 / 1,000,000 トークン         │
│ 最後の返答の時点（2 分前）           │
├──────────────────────────────────────┤
│ 週の上限（すべてのモデル）      38%  │
│ ████████░░░░░░░░░░░░                 │
│ 11月18日（水）17:00 にリセット       │
│ 週の上限（Fable）                0%  │
│ ░░░░░░░░░░░░░░░░░░░░                 │
│ 11月18日（水）17:00 にリセット       │
│ Claude.ai から読んだ値（たった今）   │
└──────────────────────────────────────┘
```

- コンテキストの欄には、Claude Code の `used_percentage` による使用率と、使っているトークン数 / Context Window の大きさを出す。自動の要約（auto-compact）は 100% より前に始まるが、その閾値はステータスラインの JSON にないので、要約までの残りは出さない
- 上限は、Claude Code の `/usage` と同じく、5時間の上限、すべてのモデルを合わせた週の上限、Sonnet の週の上限（`/usage` の「Current week (Sonnet only)」。`/usage` と同じく、プランが Max・Team か分からないときだけ）、モデルごとの週の上限の順に、使用率とリセットの時刻で出す。使用率は `/usage` と同じく切り捨てる（99.7% は 99%）。リセットの時刻は分に丸める（Claude.ai は、同じ時刻の上限を 13:59:59.7 と 14:00:00 で返すことがある）。今日なら時刻だけを、そうでなければ日付と曜日も出す。リセットの時刻を過ぎた上限は、「リセット済み」とする。リセットの時刻のない上限（まだ使っていない5時間の枠など）は、`/usage` と同じく使用率だけを出す
- 上限は、Popover を開いているあいだだけ、daemon の部分から読む。読み終わるまでと、読めなかったときは、ステータスラインで受け取った上限を「最後の返答の時点」として出す。この上限には、モデルごとの週の上限はない。読めなかったときは、その理由も出す。読めなかったあとは、Popover を開くたびに読み直す
- 読んだ値とステータスラインの値は、新しいほうを出す。ステータスラインのほうが新しいときも、ステータスラインにないモデルごとの週の上限などは、前に読んだ値を、読んだ時刻と一緒に出す
- Claude Code が Claude.ai のプランで使われていない（API キーなど）ときは、上限がないことを書く。`claude setup-token` のトークン（`CLAUDE_CODE_OAUTH_TOKEN`）は使用量を読めないので、`get_usage` は API キーと同じ答えを返すが、返答のヘッダーから作るステータスラインには上限が届く。そのときは、ステータスラインの上限を出し、モデルごとの週の上限は読めないことを書く。どちらからも上限が分からないときは、最初の返答のあとに出ることを書く
- daemon の部分が動いていないときは、Gasho が伝える理由（`useDaemonReady().reason`）を出す
- working server がオフラインのときは、最後に受け取った値（読んだ値も、ページを開いているあいだは残す）を出し、オフラインであることを書く

ステータスラインの上限は、セッションごとに、そのセッションが最後に返答した時点の値である。同じ working server のセッションは、同じ Claude Code のログインを使う。そこで、その working server のセッションのうち、`limits.at` がいちばん新しい値を使う。

## daemon の部分

### 上限の読み方

メソッド `limits` は、Claude Code を次の引数で起動し、標準入力で `initialize` と `get_usage`（`skip_behaviors: true`）の制御リクエストを1行ずつ渡して、`get_usage` の答えを待つ。

```
claude -p --input-format stream-json --output-format stream-json --verbose --no-session-persistence --settings '{"disableAllHooks":true}'
```

発言は送らないので、モデルは呼ばず、トークンも使わない。フックは止める。止めないと、利用者の設定とプラグインにある SessionStart・SessionEnd のフックが、読むたびにすべて動き（試した Mac では20本）、その分の時間もかかる。`--bare` は Claude Code のログイン（OAuth）を読まないので使えない。

標準入力を閉じても、Claude Code は2つに答えてから終わる。答えの行が出たら、Claude Code が終わるのを待たずに使う（答えてから終わるまで数秒〜十数秒かかる）。`ctx.exec` は終わるまで出力を返さず、標準入力も渡せないので、Node.js の `spawn` で、シェルを通さずに、自分のプロセスグループで起動する。答えたあとは自分で終わるのに任せ、起動から90秒たっても動いていれば、プロセスグループに SIGTERM を送る。答える前に90秒たったときは、読めなかったものとする。90秒は、負荷の高い Mac（load average が200〜340）で、フックを止めても答えまで42〜62秒かかったためである。渡す2行は決まった文字列で、画面から来た値は入れない。`claude` の場所は、gasho-daemon と同じく、環境変数 `GASHO_CLAUDE_BIN` か `claude` にする。

Claude Code は `ctx.dataDir`（`~/.local/share/gasho/plugin-data/usage/`）の中で動かす。プラグインの API 1.4 に対応した gasho-daemon は、このフォルダーで動く Claude Code を、セッションの一覧に出さない。

答えからは、`subscription_type`、`rate_limits_available` と、`rate_limits` の `five_hour`、`seven_day`、`seven_day_sonnet`、`model_scoped` だけを読む。答えにはほかにも多くのフィールドがあるが、名前が内部のものなので使わない。読む値が1つもない答えは、読めなかったものとして扱う。

daemon の部分は、読んでいるあいだに来た呼び出しには、同じ結果を返す。読んだ結果は30秒覚えておく。複数のブラウザーから続けて呼ばれても、Claude Code を何度も起動しないためである。

### メソッド

| メソッド | 種類 | 待つ時間 | 引数 | 返すもの |
|---|---|---|---|---|
| `limits` | read | 100秒 | なし | 使用量の上限（`UsageLimits`） |

`limits` は、セッションを指定せずに、working server を指定して呼ぶ。使用量の上限はアカウントごとの値で、セッションによらないためである。画面の部分は、Popover を開いているあいだだけ `useRequest` で呼び、前に読んだ値が1分より古ければ読み直す（`staleSeconds: 60`）。

```ts
/** get_usage から読んだ、Claude.ai のプランの使用量の上限 */
export interface UsageLimits {
  /** 読んだ時刻（ミリ秒） */
  at: number;
  /** false：get_usage が読めない。Claude.ai のプランで使っていない（API キーなど）か、setup-token のトークン */
  available: boolean;
  /** 5時間の上限。プランによってない */
  fiveHour?: LimitWindow;
  /** すべてのモデルを合わせた週の上限 */
  sevenDay?: LimitWindow;
  /** Sonnet の週の上限（/usage が出すプランだけ） */
  sevenDaySonnet?: LimitWindow;
  /** モデルごとの週の上限（Fable など） */
  models: (LimitWindow & { name: string })[];
}
```

`LimitWindow` は、使用率（`percent`、0〜100）とリセットの時刻（`resetsAt`、ミリ秒）。Claude.ai がリセットの時刻を返さない上限は、`resetsAt` がない。

## 値の取り方を選んだ理由

`SessionInfo.tokens` は、セッションとサブエージェントが返答で使ったトークンを、すべて足した数で、いまのコンテキストの大きさではない。いまの大きさは、トランスクリプトにある最後の返答の使用量から出せる。しかし、トランスクリプトには Context Window の大きさ（20万か100万か）が残っていない。Claude Code が Context Window の大きさと使用率を渡すのは、ステータスラインのコマンドだけである。

ステータスラインの `rate_limits` は、Claude Code が API の返答のヘッダー（`anthropic-ratelimit-unified-5h-*` や `anthropic-ratelimit-unified-7d-*` など）から作っていて、このヘッダーにモデルごとの値はない。Claude Code 2.1.325 の実行ファイルでも、ステータスラインに入れているのは `five_hour`、`seven_day`、ゲートウェイの `spend_limit` の3つだけだった。`/usage` が出すモデルごとの週の上限は、Claude.ai の使用量のエンドポイントから読んだものである。

| 取り方 | Context Window の使用率 | 週の上限 | モデルごとの週の上限 | Gasho の本体の変更 |
|---|---|---|---|---|
| gasho-daemon がステータスラインを中継する | 正確（Gasho から起動したセッション） | 出せる（最後の返答の時点） | 出せない | 要る |
| プラグインの daemon の部分が `~/.claude/settings.json` の `statusLine` を書き換える | 正確（すべてのセッション） | 出せる（最後の返答の時点） | 出せない | P14 だけ |
| トランスクリプトから計算する | ウィンドウの大きさが分からず、推測になる | 出せない | 出せない | P14 だけ |
| プラグインの daemon の部分が `get_usage` を使う | — | 出せる（読んだ時点） | 出せる | 一覧から外す変更 |
| Claude.ai の使用量のエンドポイントを直接読む | — | 出せる（読んだ時点） | 出せる | P14 だけ |

Context Window の使用率を正確に取れるのは、ステータスラインを使う1つ目と2つ目である。2つ目は、利用者のステータスラインの設定を書き換えるので、Gasho の外で起動したセッションにも影響し、プラグインを外したときに設定を元に戻す処理も要る。モデルごとの週の上限まで取れるのは4つ目と5つ目で、5つ目は Claude Code のログインのトークンを Claude Code の外で使う。そこで、Context Window は1つ目で取り、週の上限は4つ目で読む。`get_usage` は、SDK でのメソッドの名前が `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` で、返す形が変わるかもしれない。そのため、読めないときは1つ目で受け取った上限を出す。

## 確かめたこと（2026-11-14）

ステータスラインは、Gasho と同じく `claude --remote-control` を、誰も接続していない zellij の端末で起動して確かめた。モデルは Haiku 5.5 で、アカウントのプランは Claude Ultra と表示された。

- ステータスラインのコマンドは、Remote Control のセッションでも、誰も端末を見ていなくても、起動したときと返答のあとに動く
- 返答のあとの `rate_limits` は `seven_day` だけで、`five_hour` は入らなかった。Claude Code の `/usage` の画面にも、5時間の枠（Current session）の行はなかった
- `/usage` には「Current week (all models)」のほかに「Current week (Fable)」も出た。この Fable の週の上限は、ステータスラインの JSON にはない
- `get_usage` は、起動から終わるまで約1.4秒で答え、`five_hour` は null、`seven_day` と `model_scoped`（Fable）は値を持っていた
- `get_usage` を読むために起動した Claude Code は、動いているあいだ、`claude agents --json` にふつうのセッションと同じ形で出た

画面は、Gasho の main（プラグインの API 1.4）から試しの Gasho サーバーを動かし、このプラグインを `hub:plugin add --link` で入れて、ヘッドレスの Chrome で確かめた。working server には、Gasho の `Daemon` で作った仮の gasho-daemon をつないだ。仮の gasho-daemon は Gasho から起動したセッションを1つ報告し、このプラグインの daemon の部分は、本物の Claude Code で上限を読んだ。

- リングは、1280px の幅でも 390px の幅でも、入力欄の下の行の文字数のすぐ左に出た
- Popover は、開いた直後はステータスラインの上限を「最後の返答の時点」として出し、daemon の部分が読み終わると、モデルごとの週の上限を含む値に替わった
- Popover の幅は、プラグインのクラス（`w-80`）のとおり 320px になった。ページの末尾に出した中身にも、プラグインの CSS が当たっている
- Esc で Popover が閉じた。使用率を 75%、93% にすると、リングが黄色、赤になった

## 確かめたこと（2026-11-18、1.0.1）

負荷の高い Mac（load average が200〜340）で、Claude Code 2.1.326 を使って確かめた。

- フックを止めても、`get_usage` の答えまで38〜62秒かかり、答えてから Claude Code が終わるまで13〜14秒かかった。daemon の部分の `readLimits` は、答えの行が出た時点（起動から38秒）で値を返した
- `get_usage` は、週の上限のリセットの時刻を 13:59:59.7、Fable の週の上限を 14:00:00 で返した。分に丸めると、どちらも 23:00 と出る
- Gasho の main（`2425aba`）の試しの Gasho にビルドを入れ、ページの中でリングと同じクラスのボタンを作って、明るいテーマで Popover を開いた状態（`data-state="open"`）の色を読んだ。前のクラスでは文字の色になり、今のクラスでは黄色（amber-600）のままだった。暗いテーマでは、どちらも黄色（amber-400）だった

## 安全

- `get_usage` では、Claude Code が自分のログインで Claude.ai の使用量のエンドポイントを読む。このプラグインは、Claude Code のログインのトークンを読まない
- `limits` が Claude Code に渡す2行と引数は決まった文字列で、画面から来た値は入れない。Claude Code はシェルを通さずに起動する

## ファイルの構成とテスト

```
usage/
├─ gasho-plugin.json       methods に limits（read、100秒）
├─ package.json            build は gasho-plugin build、dev は gasho-plugin build --watch
├─ tsconfig.json
├─ src/
│  ├─ types.ts             画面と daemon の部分がやりとりする型（UsageLimits）
│  ├─ daemon/
│  │  ├─ index.ts          メソッド limits
│  │  └─ usage.ts          get_usage を読む Claude Code の起動、答えの読み方、30秒の記憶
│  └─ web/
│     ├─ index.tsx         入力欄の下の部品（composerFooter）
│     ├─ ring.tsx          リングと Popover
│     ├─ limits.ts         get_usage の値とステータスラインの値の選び方、色の段階、表示の文字列
│     ├─ style.css
│     └─ env.d.ts
└─ test/
   ├─ usage.test.ts
   └─ limits.test.ts
```

- `usage.test.ts`：`get_usage` の答えの読み方（`five_hour` が null のとき、リセットの時刻がないとき、Sonnet の週の上限をプランで分けること、`rate_limits_available` が false のとき、答えの形が違うとき、エラーのとき）、Claude Code に渡す2行、メソッドの待つ時間が読む時間より長いこと、偽の Claude Code（シェルのスクリプト）で、答えを終わる前に使うことと、フックを止める引数と、時間内に答えないとプロセスグループごと止めること、同時の呼び出しを1回にまとめて30秒覚えること、失敗の理由の伝え方
- `limits.test.ts`：リングの色の段階、使用率の切り捨て、トークン数の書き方、ステータスラインの上限の選び方、Popover に出す上限の並び、読んだ値とステータスラインの値の新しいほう、setup-token のとき、リセットの時刻の書き方と分への丸め

## 今回は扱わないこと

- Gasho の外で起動したセッションの Context Window。`gasho-daemon setup` で、中継のコマンドを利用者のステータスラインとして入れる方法は、あとで考える
- ホームに使用量のタイルを出すこと
- 追加の使用量（`extra_usage`）と、ゲートウェイの利用額の上限（`rate_limits.spend_limit`）
- 自動の要約（auto-compact）までの残り
