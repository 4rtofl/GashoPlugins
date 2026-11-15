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

/** A template's body for a pull request. Each placeholder is replaced once, so a title holding "{url}" stays as it is. */
export function fillTemplate(body: string, pr: { number: number; title: string; branch: string; url: string }): string {
  const values: Record<string, string> = { number: String(pr.number), title: pr.title, branch: pr.branch, url: pr.url };
  return body.replace(/\{(number|title|branch|url)\}/g, (_, key: string) => values[key] ?? "");
}
