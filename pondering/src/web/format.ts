// How Pondering writes the time, the tokens and the tool, after Claude Code's spinner: "1m 5s · ↓ 1.2k tokens".

/** "12s", "1m 5s", "1h 2m 5s". A time before the start (the clocks of the browser and the working server differ) is 0s. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m ${s % 60}s`;
}

/**
 * "850", "1.2k", "12k", "1.2M". Cut, not rounded, so that a count never shows more than there is; in whole tenths, so
 * that no ".0" is left and no 1.3 turns into 1.2999….
 */
export function tokenCount(n: number): string {
  const t = Math.max(0, Math.floor(n));
  if (t < 1000) return String(t);
  if (t < 10_000) return `${Math.floor(t / 100) / 10}k`;
  if (t < 1_000_000) return `${Math.floor(t / 1000)}k`;
  return `${Math.floor(t / 100_000) / 10}M`;
}

/** A tool as Claude Code writes its call, "Bash(npm test)"; an MCP server's tool as "server · tool". */
export function toolLabel(tool: { name: string; summary?: string }): string {
  const name = tool.name.startsWith("mcp__") ? tool.name.slice("mcp__".length).split("__").join(" · ") : tool.name;
  const summary = tool.summary?.replace(/\s+/g, " ").trim();
  return summary ? `${name}(${summary})` : name;
}
