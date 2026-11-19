# VS Code Dark 2026（vscode-dark-2026）

Gasho の画面全体を、VS Code の既定の暗いテーマ Dark 2026（microsoft/vscode の `2026-dark.json`、MIT）の色にするテーマ。色は `gasho-plugin.json` の `theme` に書く。値は `2026-dark.json` のキーから写し、次の2つだけを変えた。

- `ring`（フォーカスの輪）は `#49C8FF` にした。Gasho はこの色を不透明度 50% にして描くので、Dark 2026 の `focusBorder`（`#3994BCB3`、不透明度 70%）のままだと 35% になり、背景とのコントラストが 1.69:1 になる。`#49C8FF` では 3.27:1 で、VS Code が `focusBorder` を背景（`editor.background`）に描いたときと同じになる
- `neutral-400`〜`700`（文字の灰色）は、Tailwind CSS の灰色より明るさ（oklch の L）を 0.03 ほど上げた。このテーマは背景の `neutral-800`〜`950` を Gasho の既定より明るくするので、文字の灰色が既定のままだと、サイドバーの2行目や見出しの説明（`neutral-500`）のコントラストが、既定の 4.18:1 から 3.68:1 に下がる。上げた値では 4.19:1 になる
