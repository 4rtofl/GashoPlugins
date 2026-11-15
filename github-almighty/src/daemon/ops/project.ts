// Puts the issue or pull request in a project, takes it out, and sets or clears the value of a field of it:
//   { repo, action: "add", projectId, contentId, values? }   values: [{ fieldId, value }], set right after it is put in
//                                                           (the Undo Toast of "remove" puts it back with what it held)
//   { repo, action: "remove", projectId, contentId }
//   { repo, action: "set", projectId, itemId, fieldId, value }
//   { repo, action: "clear", projectId, itemId, fieldId }
// value is GitHub's ProjectV2FieldValue: { text }, { number }, { date: "YYYY-MM-DD" }, { singleSelectOptionId } or
// { iterationId }. "remove" finds the item by the content, as the Undo Toast of "add" does not know the new item's id.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh } from "../core.ts";
import { repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";
import { lacksProjectScope, NO_SCOPE_MESSAGE, type ProjectValue } from "./projects.ts";

/** A node id of GitHub ("PVT_kwDO…", "I_kwDO…") or an option's id: letters, digits and _ - = + / only. */
export function nodeArg(v: unknown, what: string): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_=+/-]{1,200}$/.test(v)) throw new PluginError(`${what}の指定が正しくありません。`);
  return v;
}

export function valueArg(v: unknown): ProjectValue {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  if (Object.keys(o).length === 1) {
    if (typeof o.text === "string" && o.text.trim() && o.text.length <= 1024) return { text: o.text };
    if (typeof o.number === "number" && Number.isFinite(o.number)) return { number: o.number };
    if (typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) return { date: o.date };
    if (o.singleSelectOptionId !== undefined) return { singleSelectOptionId: nodeArg(o.singleSelectOptionId, "選択肢") };
    if (o.iterationId !== undefined) return { iterationId: nodeArg(o.iterationId, "イテレーション") };
  }
  throw new PluginError("項目の値の指定が正しくありません。");
}

function valuesArg(v: unknown): { fieldId: string; value: ProjectValue }[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 50) throw new PluginError("項目の値の指定が正しくありません。");
  return v.map((x) => ({ fieldId: nodeArg((x as { fieldId?: unknown })?.fieldId, "項目"), value: valueArg((x as { value?: unknown })?.value) }));
}

const graphql = (query: string, vars: Record<string, string>): string[] => ["api", "graphql", "-f", `query=${query}`, ...Object.entries(vars).flatMap(([k, v]) => ["-f", `${k}=${v}`])];

export const addArgs = (projectId: string, contentId: string): string[] =>
  graphql("mutation($project: ID!, $content: ID!) { addProjectV2ItemById(input: {projectId: $project, contentId: $content}) { item { id } } }", { project: projectId, content: contentId });

export const removeArgs = (projectId: string, itemId: string): string[] =>
  graphql("mutation($project: ID!, $item: ID!) { deleteProjectV2Item(input: {projectId: $project, itemId: $item}) { deletedItemId } }", { project: projectId, item: itemId });

export const clearArgs = (projectId: string, itemId: string, fieldId: string): string[] =>
  graphql("mutation($project: ID!, $item: ID!, $field: ID!) { clearProjectV2ItemFieldValue(input: {projectId: $project, itemId: $item, fieldId: $field}) { clientMutationId } }", {
    project: projectId,
    item: itemId,
    field: fieldId,
  });

/**
 * Sets values of one item at once, an alias each. Texts and ids go as variables; a number goes into the query itself,
 * as gh sends a variable with a fraction as text, which GitHub refuses for a Float (it is a finite number, so only
 * digits, ".", "-", "e" and "+").
 */
export function setArgs(projectId: string, itemId: string, values: { fieldId: string; value: ProjectValue }[]): string[] {
  const vars: Record<string, string> = { project: projectId, item: itemId };
  const declared = ["$project: ID!", "$item: ID!"];
  const sets = values.map(({ fieldId, value }, i) => {
    vars[`f${i}`] = fieldId;
    declared.push(`$f${i}: ID!`);
    let input: string;
    if ("number" in value) {
      input = `{number: ${JSON.stringify(value.number)}}`;
    } else {
      const [key, text] = Object.entries(value)[0] as [string, string];
      vars[`v${i}`] = text;
      declared.push(`$v${i}: ${key === "date" ? "Date" : "String"}!`);
      input = `{${key}: $v${i}}`;
    }
    return `s${i}: updateProjectV2ItemFieldValue(input: {projectId: $project, itemId: $item, fieldId: $f${i}, value: ${input}}) { clientMutationId }`;
  });
  return graphql(`mutation(${declared.join(", ")}) { ${sets.join(" ")} }`, vars);
}

const ITEMS = "projectItems(first: 50) { nodes { id project { id } } }";
export const itemsOfArgs = (contentId: string): string[] =>
  graphql(`query($content: ID!) { node(id: $content) { ... on Issue { ${ITEMS} } ... on PullRequest { ${ITEMS} } } }`, { content: contentId });

/** The id of the item of `projectId` in the output of itemsOfArgs. */
export function itemOf(json: string, projectId: string): string | undefined {
  const nodes = (JSON.parse(json) as { data?: { node?: { projectItems?: { nodes?: { id?: unknown; project?: { id?: unknown } }[] } } } }).data?.node?.projectItems?.nodes ?? [];
  return str(nodes.find((n) => n?.project?.id === projectId)?.id);
}

/** A failure for want of the scope "project" says how to add it. */
async function scoped<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (lacksProjectScope(e)) throw new PluginError(NO_SCOPE_MESSAGE);
    throw e;
  }
}

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const projectId = nodeArg(p.projectId, "Project");
    const write = (what: string, args: string[]) => gh(what, () => scoped(() => ctx.github.write(args, { repo })), ctx);
    switch (p.action) {
      case "add": {
        const contentId = nodeArg(p.contentId, "Issue や Pull request");
        const values = valuesArg(p.values);
        const { stdout } = await write("add to a project", addArgs(projectId, contentId));
        const itemId = str((JSON.parse(stdout) as { data?: { addProjectV2ItemById?: { item?: { id?: unknown } } } }).data?.addProjectV2ItemById?.item?.id);
        if (values.length > 0) {
          if (!itemId) throw new PluginError("Project に足しましたが、項目の値を戻せませんでした。");
          await write("set the values of a project's item", setArgs(projectId, itemId, values));
        }
        return { ok: true };
      }
      case "remove": {
        const contentId = nodeArg(p.contentId, "Issue や Pull request");
        const { stdout } = await gh("read the items of projects", () => scoped(() => ctx.github.read(itemsOfArgs(contentId), { repo, maxAgeSeconds: 0 })), ctx);
        const itemId = itemOf(stdout, projectId);
        if (!itemId) throw new PluginError("この Project には入っていません。");
        await write("remove from a project", removeArgs(projectId, itemId));
        return { ok: true };
      }
      case "set":
      case "clear": {
        const itemId = nodeArg(p.itemId, "Project の項目");
        const fieldId = nodeArg(p.fieldId, "項目");
        await write(`${p.action} a project's field`, p.action === "set" ? setArgs(projectId, itemId, [{ fieldId, value: valueArg(p.value) }]) : clearArgs(projectId, itemId, fieldId));
        return { ok: true };
      }
    }
    throw new PluginError("Project の操作の指定が正しくありません。");
  },
} satisfies Op;
