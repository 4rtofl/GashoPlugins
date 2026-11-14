# GashoPlugins

[Gasho](https://github.com/4rtoflow/Gasho) のプラグインを置くリポジトリ。プラグインごとに、ID と同じ名前のフォルダーを並べる。プラグインの仕組みと API は、Gasho の [docs/plugins.md](https://github.com/4rtoflow/Gasho/blob/main/docs/plugins.md) にまとめた。

| フォルダー | プラグイン |
|---|---|
| `github/` | セッションのリポジトリの、開いている Issue と Pull request を読む。working server の GitHub CLI（gh）を使う |

## ビルドする

SDK は、GitHub Packages の `@4rtoflow/gasho-plugin-sdk` を `@gasho/plugin-sdk` の名前で入れて使う。GitHub Packages から入れるには、`read:packages` の権限のあるトークンを `~/.npmrc` に書いておく。書き方は、Gasho の [docs/daemon-setup.md](https://github.com/4rtoflow/Gasho/blob/main/docs/daemon-setup.md) と同じ。

```bash
npm install
npm run build -w github       # github/dist/ に gasho-plugin.json、web.js、web.css、daemon.js を書く
npm run dev -w github         # 保存するたびにビルドし直す
npm run typecheck
npm test
```

## Gasho に入れる

Gasho サーバーの、Gasho のリポジトリで実行する。入れたプラグインは、Gasho のサイドバーの「プラグイン」の画面に出る。

```bash
npm run hub:plugin -- add ~/repos/GashoPlugins/github/dist          # ビルドしたものを入れる
npm run hub:plugin -- add --link ~/repos/GashoPlugins/github/dist   # 作っているあいだ。ビルドするたびに画面と gasho-daemon が入れ替わる
```

daemon の部分（working server で動く部分）は、プラグインに対応した gasho-daemon（0.12.0 以降）でだけ動く。
