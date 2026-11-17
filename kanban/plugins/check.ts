// node check.ts [<name>]: what the board plugin <name> makes of the cards written out with "カードを書き出す"
// (cards/*.json), by default the plugin each repository chose then: each card's column, reason, marks and instructions,
// and the headings above the board, as the board shows them (place.ts). Exits with 1 when the plugin cannot be loaded,
// or cannot tell a card's column. The kanban writes this file again whenever it starts.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { headingsWith, KANBAN_COLUMNS, placeWith } from "./place.ts";
import type { FetchRepo, StateCard } from "./types.ts";

/** A file of cards/: the cards of a repository, written out by the kanban. */
interface Written {
  exportedAt?: string;
  /** The board plugin the repository chose, whose `fetch` gave `fetched`. */
  plugin?: string;
  repo: FetchRepo;
  fetched?: unknown;
  cards: StateCard[];
}

const here = import.meta.dirname;
const cardsDir = path.join(here, "cards");
const asked = process.argv[2];
const files = fs.existsSync(cardsDir) ? fs.readdirSync(cardsDir).filter((f) => f.endsWith(".json")).sort() : [];
if (files.length === 0) {
  console.error("cards/ に書き出したカードがありません。カンバンの「カードを書き出す」を押してから流します。");
  process.exit(1);
}

const when = (iso: string | undefined): string => (iso ? new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const prOf = (c: StateCard): string => (c.pr ? `PR #${c.pr.number} ${c.pr.draft ? "Draft" : c.pr.state}` : "PR なし");

let failed = 0;
for (const file of files) {
  const written = JSON.parse(fs.readFileSync(path.join(cardsDir, file), "utf8")) as Written;
  const name = asked ?? written.plugin;
  if (!name) {
    console.log(`■ ${written.repo.repo}（cards/${file}）\n  プラグインを選んでいなかった repo です。node check.ts <名前> で、当てるプラグインを指定します。\n`);
    continue;
  }
  // What `fetch` gave goes only to the plugin that gave it, as on the board.
  const fetched = written.plugin === name ? written.fetched : undefined;
  console.log(`■ ${written.repo.repo} に ${name} を当てる（cards/${file}、${when(written.exportedAt)} に書き出した ${written.cards.length} 枚、fetch の結果${fetched === undefined ? "なし" : "あり"}）`);
  let mod: { state?: unknown; headings?: unknown };
  try {
    mod = (await import(pathToFileURL(path.join(here, name, "index.ts")).href)) as typeof mod;
  } catch (e) {
    console.log(`  ${name}/index.ts を読み込めません：${e instanceof Error ? e.message : String(e)}\n`);
    failed++;
    continue;
  }
  const headings = headingsWith(mod.headings, written.repo, fetched);
  if ("error" in headings) console.log(`  見出しを出せません：${headings.error}`);
  else for (const h of headings) console.log(`  見出し：${h.label}${h.text ? ` ${h.text}` : ""}${h.active ? "（今）" : ""}${h.detail ? `　${h.detail}` : ""}`);

  const placed = written.cards.map((card) => ({ card, placed: placeWith(mod.state, card, fetched) }));
  for (const column of [...KANBAN_COLUMNS, { id: undefined, label: "列を決められない（ボードでは「自分の番」に置く）" }]) {
    const rows = placed.filter(({ placed: p }) => ("error" in p ? column.id === undefined : p.column === column.id));
    if (rows.length === 0) continue;
    console.log(`  ${column.label}（${rows.length}）`);
    for (const { card, placed: p } of rows) {
      const where = [card.branch, prOf(card)].filter(Boolean).join("・");
      if ("error" in p) {
        failed++;
        console.log(`    ${card.label}（${where}）：${p.error}`);
        continue;
      }
      console.log(`    ${card.label}（${where}）${p.reason ? `：${p.reason}` : ""}`);
      for (const m of p.marks ?? []) console.log(`      印「${m.text}」${m.active ? "（今）" : ""}${m.detail ? `　${m.detail}` : ""}`);
      for (const a of p.actions ?? []) console.log(`      指示「${a.label}」：${a.text}`);
    }
  }
  console.log("");
}
process.exit(failed > 0 ? 1 : 0);
