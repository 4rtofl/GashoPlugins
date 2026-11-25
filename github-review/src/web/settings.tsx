// Below the setting "templates" (its JSON) on the settings screen: the templates as a list, to add, change and remove,
// with the placeholders they can hold. Saving writes the JSON of the setting, the same for every browser.
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useSetting } from "@gasho/plugin-sdk";
import { MAX_BODY, MAX_NAME, MAX_TEMPLATES, readTemplates, type Template } from "../template.ts";
import { Button } from "./ui/parts";

/** The setting holds up to this many characters of JSON (gasho-plugin.json `maxLength`). */
const MAX_JSON = 10_000;
const FIELD = "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-border-hover";

/** Why the templates cannot be saved, if they cannot. */
function problem(list: Template[]): string | undefined {
  if (list.some((t) => !t.name.trim())) return "名前の無いテンプレートがあります。";
  if (list.some((t) => !t.body.trim())) return "本文の無いテンプレートがあります。";
  if (new Set(list.map((t) => t.name.trim())).size < list.length) return "同じ名前のテンプレートがあります。";
  if (JSON.stringify(list).length > MAX_JSON) return `テンプレートが長すぎます（JSON で ${MAX_JSON.toLocaleString()} 文字まで）。`;
  return undefined;
}

/** The templates as they are saved: the names without the spaces around them (as the setting is read). */
const asSaved = (list: Template[]): Template[] => list.map((t) => ({ name: t.name.trim(), body: t.body }));

export function TemplateSettings() {
  const [raw, setRaw] = useSetting<string>("templates");
  const { templates: saved, problem: unread } = readTemplates(raw);
  const savedJson = JSON.stringify(saved);
  const [draft, setDraft] = useState<Template[]>(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  // What another browser saved shows here, unless this one is being changed.
  const [base, setBase] = useState(savedJson);
  useEffect(() => {
    if (JSON.stringify(asSaved(draft)) === base) setDraft(saved);
    setBase(savedJson);
  }, [savedJson]);
  // A setting with what is not a template can be saved as the list shows it.
  const dirty = Boolean(unread) || JSON.stringify(asSaved(draft)) !== savedJson;
  const why = problem(draft);
  const change = (i: number, next: Partial<Template>) => setDraft((cur) => cur.map((t, j) => (j === i ? { ...t, ...next } : t)));
  const save = async () => {
    setSaving(true);
    setError(undefined);
    const next = asSaved(draft);
    try {
      await setRaw(JSON.stringify(next));
      setDraft(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSaving(false);
  };
  return (
    <div className="space-y-3">
      {unread && <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">{unread}保存すると、下の欄のとおりに書き直します。</p>}
      <p className="text-xs leading-relaxed text-muted-foreground">
        「worktree を作る」のメニューに、この順に並びます（いちばん上は「何も送らない」）。本文の <code className="font-mono">{"{number}"}</code>・<code className="font-mono">{"{title}"}</code>・
        <code className="font-mono">{"{branch}"}</code>・<code className="font-mono">{"{url}"}</code> は、Pull request の番号・題・head のブランチ・URL に置き換えて送ります。
      </p>
      {draft.length === 0 && <p className="text-xs text-muted-foreground">テンプレートはありません。</p>}
      <ol className="space-y-3">
        {draft.map((t, i) => (
          <li key={i} className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex items-center gap-2">
              <input value={t.name} maxLength={MAX_NAME} onChange={(e) => change(i, { name: e.target.value })} placeholder="名前" aria-label={`テンプレート ${i + 1} の名前`} className={FIELD} />
              <Button size="sm" variant="ghost" leftIcon={<Trash2 />} onClick={() => setDraft((cur) => cur.filter((_, j) => j !== i))} aria-label={`テンプレート ${i + 1} を消す`}>
                消す
              </Button>
            </div>
            <textarea
              value={t.body}
              maxLength={MAX_BODY}
              onChange={(e) => change(i, { body: e.target.value })}
              rows={3}
              placeholder="セッションに送る指示"
              aria-label={`テンプレート ${i + 1} の本文`}
              className={`${FIELD} resize-y font-mono text-[13px]`}
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" leftIcon={<Plus />} disabled={draft.length >= MAX_TEMPLATES} onClick={() => setDraft((cur) => [...cur, { name: "", body: "" }])}>
          テンプレートを足す
        </Button>
        <Button size="sm" variant="primary" disabled={!dirty || Boolean(why)} isLoading={saving} loadingText="保存中…" onClick={() => void save()}>
          保存
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}>
            元に戻す
          </Button>
        )}
      </div>
      {dirty && why && <p className="text-xs text-amber-700 dark:text-amber-300">{why}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
