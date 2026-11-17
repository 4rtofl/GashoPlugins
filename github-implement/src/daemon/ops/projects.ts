// The projects (GitHub Projects) an issue or pull request is in, with the values of their fields, and the open projects
// it can be put in (the repository's, its owner's and gh's own login's): { repo, number, fresh? } → ProjectsRead. One
// GraphQL query (1 point), read when the screen shows, not in the background. gh's login needs the scope "project" (or
// "read:project") for it; without it the answer is { noScope: true }, so that the screen can say how to add it.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh, itemRead } from "../core.ts";
import { num, numberArg, repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";

/** The kinds of fields the screen shows; the others (title, assignees, labels, …) are the item's own. */
export type ProjectFieldType = "single_select" | "date" | "number" | "text" | "iteration";

/** A value as GitHub's mutations take it (ProjectV2FieldValue): one key. A date is YYYY-MM-DD. */
export type ProjectValue = { text: string } | { number: number } | { date: string } | { singleSelectOptionId: string } | { iterationId: string };

export interface ProjectOption {
  id: string;
  name: string;
  /** GitHub's name of its color: GRAY, BLUE, GREEN, YELLOW, ORANGE, RED, PINK or PURPLE. */
  color?: string;
}

export interface ProjectField {
  id: string;
  name: string;
  type: ProjectFieldType;
  /** Single select. */
  options?: ProjectOption[];
  value?: ProjectValue;
  /** How a single select's or an iteration's value shows: the option's name, the iteration's title. */
  valueName?: string;
}

export interface ProjectRef {
  id: string;
  number: number;
  title: string;
  url: string;
  /** gh's login may change its items. */
  canUpdate: boolean;
}

/** The item of a project that holds the issue or pull request. */
export interface ProjectItem {
  id: string;
  project: ProjectRef;
  fields: ProjectField[];
}

export interface ItemProjects {
  /** The node id of the issue or pull request, which a project is given to put it in. */
  contentId: string;
  items: ProjectItem[];
  /** Open projects gh's login may change, that do not hold it yet. */
  choices: ProjectRef[];
}

export type ProjectsRead = ItemProjects | { noScope: true };

const PROJECT = "id number title url closed viewerCanUpdate";
const FIELD = "... on ProjectV2FieldCommon { id name dataType } ... on ProjectV2SingleSelectField { options { id name color } }";
const OF = "field { ... on ProjectV2FieldCommon { id } }";
const VALUE =
  `__typename ... on ProjectV2ItemFieldTextValue { text ${OF} } ... on ProjectV2ItemFieldNumberValue { number ${OF} } ` +
  `... on ProjectV2ItemFieldDateValue { date ${OF} } ... on ProjectV2ItemFieldSingleSelectValue { optionId name ${OF} } ` +
  `... on ProjectV2ItemFieldIterationValue { iterationId title ${OF} }`;
const ITEMS = `id projectItems(first: 20, includeArchived: false) { nodes { id project { ${PROJECT} fields(first: 50) { nodes { ${FIELD} } } } fieldValues(first: 50) { nodes { ${VALUE} } } } }`;
const LIST = `projectsV2(first: 30, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ${PROJECT} } }`;

export function projectsQueryArgs(repo: string, number: number): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const query =
    `query($owner: String!, $name: String!, $number: Int!) { viewer { ${LIST} } repository(owner: $owner, name: $name) { ` +
    `issueOrPullRequest(number: $number) { ... on Issue { ${ITEMS} } ... on PullRequest { ${ITEMS} } } ` +
    `owner { ... on User { ${LIST} } ... on Organization { ${LIST} } } ${LIST} } }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`];
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (typeof v === "object" && v !== null ? (v as Raw) : {});
const nodes = (v: unknown): Raw[] => (Array.isArray(obj(v).nodes) ? (obj(v).nodes as unknown[]).map(obj) : []);

const TYPES: Record<string, ProjectFieldType> = { SINGLE_SELECT: "single_select", DATE: "date", NUMBER: "number", TEXT: "text", ITERATION: "iteration" };

function project(raw: Raw): (ProjectRef & { closed: boolean }) | undefined {
  const id = str(raw.id);
  const number = num(raw.number);
  const title = str(raw.title);
  const url = str(raw.url);
  if (!id || number === undefined || title === undefined || !url?.startsWith("https://github.com/")) return undefined;
  return { id, number, title, url, canUpdate: raw.viewerCanUpdate === true, closed: raw.closed === true };
}

/** A field's value, and the name it shows with. */
function value(raw: Raw): { value: ProjectValue; valueName?: string } | undefined {
  switch (raw.__typename) {
    case "ProjectV2ItemFieldTextValue":
      return typeof raw.text === "string" ? { value: { text: raw.text } } : undefined;
    case "ProjectV2ItemFieldNumberValue":
      return num(raw.number) !== undefined ? { value: { number: raw.number as number } } : undefined;
    case "ProjectV2ItemFieldDateValue":
      return str(raw.date) ? { value: { date: (raw.date as string).slice(0, 10) } } : undefined;
    case "ProjectV2ItemFieldSingleSelectValue":
      return str(raw.optionId) ? { value: { singleSelectOptionId: raw.optionId as string }, valueName: str(raw.name) ?? "" } : undefined;
    case "ProjectV2ItemFieldIterationValue":
      return str(raw.iterationId) ? { value: { iterationId: raw.iterationId as string }, valueName: str(raw.title) ?? "" } : undefined;
  }
  return undefined;
}

function item(raw: Raw): ProjectItem | undefined {
  const id = str(raw.id);
  const p = project(obj(raw.project));
  if (!id || !p) return undefined;
  const values = new Map<string, NonNullable<ReturnType<typeof value>>>();
  for (const v of nodes(raw.fieldValues)) {
    const fid = str(obj(v.field).id);
    const val = value(v);
    if (fid && val) values.set(fid, val);
  }
  const fields = nodes(obj(raw.project).fields).flatMap((f): ProjectField[] => {
    const fid = str(f.id);
    const type = TYPES[str(f.dataType) ?? ""];
    if (!fid || !type) return [];
    const options =
      type === "single_select"
        ? (Array.isArray(f.options) ? f.options : [])
            .map(obj)
            .flatMap((o) => (str(o.id) ? [{ id: o.id as string, name: str(o.name) ?? "", ...(str(o.color) ? { color: o.color as string } : {}) }] : []))
        : undefined;
    return [{ id: fid, name: str(f.name) ?? "", type, ...(options ? { options } : {}), ...values.get(fid) }];
  });
  const { closed: _, ...ref } = p;
  return { id, project: ref, fields };
}

/** The output of projectsQueryArgs; undefined when the number is not an issue or pull request. */
export function parseProjects(json: string): ItemProjects | undefined {
  const data = obj(obj(JSON.parse(json)).data);
  const repo = obj(data.repository);
  const content = obj(repo.issueOrPullRequest);
  const contentId = str(content.id);
  if (!contentId) return undefined;
  const items = nodes(content.projectItems).flatMap((n) => item(n) ?? []);
  const lists = [data.viewer, repo.owner, repo].flatMap((o) => nodes(obj(o).projectsV2));
  const seen = new Set(items.map((i) => i.project.id));
  const choices = lists.flatMap((n): ProjectRef[] => {
    const p = project(n);
    if (!p || p.closed || !p.canUpdate || seen.has(p.id)) return [];
    seen.add(p.id);
    const { closed: _, ...ref } = p;
    return [ref];
  });
  return { contentId, items, choices };
}

/** gh's login has no scope for projects: a classic token without "project" (and "read:project" for reading). GitHub names the scopes it wants in quotes. */
export function lacksProjectScope(e: unknown): boolean {
  const err = obj(e);
  const text = [err.stdout, err.stderr, err.message].filter((t): t is string => typeof t === "string").join("\n");
  return /not been granted the required scopes/.test(text) && /'(read:)?project'/.test(text);
}

export const NO_SCOPE_MESSAGE = "gh のログインに Projects の権限がありません。working server で gh auth refresh -s project を実行し、ブラウザーで許可してください。";

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    return gh(
      `read the projects of #${number}`,
      async (): Promise<ProjectsRead> => {
        let stdout: string;
        try {
          stdout = (await itemRead(ctx, repo, number, p)(projectsQueryArgs(repo, number))).stdout;
        } catch (e) {
          if (lacksProjectScope(e)) return { noScope: true };
          throw e;
        }
        const read = parseProjects(stdout);
        if (!read) throw new PluginError("この番号の Issue や Pull request は見つかりません。");
        return read;
      },
      ctx,
    );
  },
} satisfies Op;
