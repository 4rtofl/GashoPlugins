// The instructions sent to the session started in a review worktree: templates of the setting "templates" (JSON, the
// same for every browser and every repository), whose {number}, {title}, {branch} and {url} become the pull request's.
import { headName } from "./types.ts";

export interface Template {
  name: string;
  body: string;
}

export const MAX_TEMPLATES = 20;
export const MAX_NAME = 40;
export const MAX_BODY = 4000;

/**
 * The templates of the setting, and why some of it is left out: anything that is not a template is, so a hand-edited
 * value never breaks the page, but the settings screen and the menu say so rather than lose them unseen.
 */
export function readTemplates(v: unknown): { templates: Template[]; problem?: string } {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) return { templates: [] };
  let list: unknown;
  try {
    list = typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return { templates: [], problem: "設定のテンプレートの JSON を読めないので、テンプレートを使えません。設定画面で、JSON を直すか、テンプレートの欄で作り直して保存してください。" };
  }
  if (!Array.isArray(list)) return { templates: [], problem: "設定のテンプレートの JSON が一覧（[ … ]）ではないので、テンプレートを使えません。設定画面で、JSON を直すか、テンプレートの欄で作り直して保存してください。" };
  const templates = list.flatMap((t): Template[] => {
    const { name, body } = (t ?? {}) as { name?: unknown; body?: unknown };
    if (typeof name !== "string" || typeof body !== "string") return [];
    const n = name.trim();
    return n && n.length <= MAX_NAME && body.trim() && body.length <= MAX_BODY ? [{ name: n, body }] : [];
  });
  const left = list.length - Math.min(templates.length, MAX_TEMPLATES);
  return {
    templates: templates.slice(0, MAX_TEMPLATES),
    ...(left > 0
      ? { problem: `設定のテンプレートの JSON のうち ${left} 個は、使えないので出していません（名前と本文が要り、名前は ${MAX_NAME} 文字、本文は ${MAX_BODY} 文字、テンプレートは ${MAX_TEMPLATES} 個まで）。` }
      : {}),
  };
}

/**
 * A template's body for a pull request. Each placeholder is replaced once, so a title holding "{url}" stays as it is. A
 * value that would start what is sent loses its leading spaces and symbols: Claude Code takes the text sent, trimmed,
 * as a command when it starts with "/", or a shell command with "!", and a title or a branch is anyone's words. What the
 * template itself starts with is kept; its text after a value that came to nothing would start it in the value's place,
 * so that loses them too.
 */
export function fillTemplate(body: string, pr: { number: number; title: string; branch: string; url: string; fork?: boolean; headOwner?: string }): string {
  const values: Record<string, string> = { number: String(pr.number), title: pr.title, branch: headName(pr), url: pr.url };
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
