# ayu Dark（ayu-dark）

Gasho の画面全体を、ayu Dark（ayu-theme/vscode-ayu の `ayu-dark.json`、MIT）の色にするテーマ。色は `gasho-plugin.json` の `theme` に書く。値は `ayu-dark.json` のキーから写し、次の2つだけを変えた。

- `primary-foreground`（主ボタンの文字）は `#10141c`（ayu の `editor.background`）にした。ayu の `button.foreground`（`#765b24`）のままだと、主ボタンの背景（`button.background`、`#e6b450`）とのコントラストが 3.34:1 で、文字の目安の 4.5:1 に届かない。`#10141c` では 9.67:1 になる
- `input` は `#c4d6fe6b`（ayu の `descriptionForeground`）にした。Gasho はこの色を、スイッチが OFF のときの溝に使う。ayu の `input.border`（`#c4d6fe15`）のままだと、溝と背景のコントラストが 1.2:1 で、OFF のスイッチがつまみの丸だけに見える。`#c4d6fe6b` では 3.17:1 になる
