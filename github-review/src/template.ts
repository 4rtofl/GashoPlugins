// The instructions sent to the session started in a review worktree: templates of the setting "templates" (JSON, the
// same for every browser and every repository), whose {number}, {title}, {branch} and {url} become the pull request's.

export interface Template {
  name: string;
  body: string;
}

export const MAX_TEMPLATES = 20;
export const MAX_NAME = 40;
export const MAX_BODY = 4000;

/** The templates of the setting; anything that is not one is left out, so a hand-edited value never breaks the page. */
export function parseTemplates(v: unknown): Template[] {
  let list: unknown;
  try {
    list = typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .flatMap((t): Template[] => {
      const { name, body } = (t ?? {}) as { name?: unknown; body?: unknown };
      if (typeof name !== "string" || typeof body !== "string") return [];
      const n = name.trim();
      return n && n.length <= MAX_NAME && body.trim() && body.length <= MAX_BODY ? [{ name: n, body }] : [];
    })
    .slice(0, MAX_TEMPLATES);
}

/**
 * A template's body for a pull request. Each placeholder is replaced once, so a title holding "{url}" stays as it is. A
 * value that would start what is sent loses its leading spaces and symbols: Claude Code takes the text sent, trimmed,
 * as a command when it starts with "/", or a shell command with "!", and a title or a branch is anyone's words. What the
 * template itself starts with is kept; its text after a value that came to nothing would start it in the value's place,
 * so that loses them too.
 */
export function fillTemplate(body: string, pr: { number: number; title: string; branch: string; url: string }): string {
  const values: Record<string, string> = { number: String(pr.number), title: pr.title, branch: pr.branch, url: pr.url };
  const lead = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, "");
  let out = "";
  let from = 0;
  const text = (s: string) => (from > 0 && !out.trim() ? lead(s) : s);
  for (const m of body.matchAll(/\{(number|title|branch|url)\}/g)) {
    out += text(body.slice(from, m.index));
    const value = values[m[1] ?? ""] ?? "";
    out += out.trim() ? value : lead(value);
    from = m.index + m[0].length;
  }
  return out + text(body.slice(from));
}
