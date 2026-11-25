// GitHub Projects of a repository: those linked to it and the other ones of its owner (one GraphQL query, open and
// closed ones apart, so that many closed ones do not leave open ones out), and one of them as a board: its single
// select and iteration fields (what the columns can be made of) and its items with the options or iterations chosen in
// them, read 100 at a time. gh's login needs read:project; without it, the answer says how to add it.
// The owner is read as the repository's: `repository(owner:, name:)` still finds a repository by the name its clone's
// origin says after its owner was renamed, while `repositoryOwner(login:)` finds no one by the old login.
import type { Board, BoardField, BoardItem, ProjectRef, Projects } from "../types.ts";
import { arr, githubUrl, missingScope, num, parseJson, rec, str, type Gh } from "./gh.ts";

/** Open projects and closed ones read per list, and items read per board (100 a page). */
export const PROJECTS_MAX = 50;
export const BOARD_PAGES = 5;

const PROJECT_FIELDS = "number title url closed shortDescription updatedAt items { totalCount }";
const projectsOf = (state: "open" | "closed") =>
  `${state}: projectsV2(first: ${PROJECTS_MAX}, query: "is:${state}", orderBy: { field: UPDATED_AT, direction: DESC }) { totalCount nodes { ${PROJECT_FIELDS} } }`;

export const PROJECTS_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    ${projectsOf("open")}
    ${projectsOf("closed")}
    owner {
      login
      ... on ProjectV2Owner {
        ${projectsOf("open")}
        ${projectsOf("closed")}
      }
    }
  }
}`;

const ITERATION_FIELDS = "id name configuration { iterations { id title startDate } completedIterations { id title startDate } }";

export const BOARD_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    owner {
      ... on ProjectV2Owner {
        projectV2(number: $number) {
          number title url closed shortDescription
          fields(first: 50) {
            nodes { __typename ... on ProjectV2SingleSelectField { id name options { id name color } } ... on ProjectV2IterationField { ${ITERATION_FIELDS} } }
          }
          views(first: 20) {
            nodes { layout verticalGroupByFields(first: 1) { nodes { ... on ProjectV2SingleSelectField { id } ... on ProjectV2IterationField { id } } } }
          }
          items(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id type isArchived
              content {
                __typename
                ... on Issue { number title url state stateReason repository { nameWithOwner } assignees(first: 5) { nodes { login } } }
                ... on PullRequest { number title url state isDraft repository { nameWithOwner } assignees(first: 5) { nodes { login } } }
                ... on DraftIssue { title assignees(first: 5) { nodes { login } } }
              }
              fieldValues(first: 30) {
                nodes {
                  __typename
                  ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2SingleSelectField { id } } }
                  ... on ProjectV2ItemFieldIterationValue { iterationId field { ... on ProjectV2IterationField { id } } }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

/** The errors of a GraphQL answer, as one text (gh also exits non-zero then, but prints the answer). */
function graphqlErrors(data: unknown): string | undefined {
  const errors = arr(rec(data).errors);
  return errors.length ? errors.map((e) => str(rec(e).message) ?? "").join("\n") : undefined;
}

function parseProjectRef(raw: unknown): ProjectRef | undefined {
  const p = rec(raw);
  const number = num(p.number);
  const title = str(p.title);
  const url = githubUrl(p.url);
  if (!number || title === undefined || !url) return undefined;
  return {
    number,
    title,
    url,
    closed: p.closed === true,
    ...(str(p.shortDescription) ? { shortDescription: str(p.shortDescription) } : {}),
    ...(str(p.updatedAt) ? { updatedAt: str(p.updatedAt) } : {}),
    items: num(rec(p.items).totalCount) ?? 0,
  };
}

const refs = (conn: unknown): ProjectRef[] =>
  arr(rec(conn).nodes).flatMap((n) => {
    const p = parseProjectRef(n);
    return p ? [p] : [];
  });

/** The open projects and then the closed ones of an answer's `open` and `closed`, and whether GitHub has more. */
function openAndClosed(of: Record<string, unknown>): { projects: ProjectRef[]; truncated: boolean } {
  const more = (conn: unknown) => (num(rec(conn).totalCount) ?? 0) > arr(rec(conn).nodes).length;
  return { projects: [...refs(of.open), ...refs(of.closed)], truncated: more(of.open) || more(of.closed) };
}

/** The answer of PROJECTS_QUERY: the repository's projects, and its owner's others (open ones first). */
export function parseProjects(json: string): Omit<Projects, "repo"> {
  const data = rec(rec(parseJson(json)).data);
  const repository = rec(data.repository);
  const linked = openAndClosed(repository);
  const owner = rec(repository.owner);
  const seen = new Set(linked.projects.map((p) => p.number));
  const others = openAndClosed(owner);
  return {
    linked: linked.projects,
    owner: others.projects.filter((p) => !seen.has(p.number)),
    ownerLogin: str(owner.login) ?? "",
    ...(linked.truncated ? { linkedTruncated: true } : {}),
    ...(others.truncated ? { ownerTruncated: true } : {}),
  };
}

const ITEM_STATE: Record<string, BoardItem["state"]> = { OPEN: "open", CLOSED: "closed", MERGED: "merged" };
/** How GitHub shows an issue closed for a reason other than done. */
const CLOSED_AS: Record<string, BoardItem["state"]> = { NOT_PLANNED: "not_planned", DUPLICATE: "duplicate" };

function parseItem(raw: unknown, repo: string): BoardItem | undefined {
  const n = rec(raw);
  const id = str(n.id);
  if (!id || n.isArchived === true) return undefined;
  const c = rec(n.content);
  const kind = str(c.__typename);
  const type: BoardItem["type"] = kind === "Issue" ? "issue" : kind === "PullRequest" ? "pull" : kind === "DraftIssue" ? "draft" : "redacted";
  const values: Record<string, string> = {};
  for (const v of arr(rec(n.fieldValues).nodes)) {
    const value = rec(v);
    const field = str(rec(value.field).id);
    const option = value.__typename === "ProjectV2ItemFieldSingleSelectValue" ? str(value.optionId) : value.__typename === "ProjectV2ItemFieldIterationValue" ? str(value.iterationId) : undefined;
    if (field && option) values[field] = option;
  }
  const itemRepo = str(rec(c.repository).nameWithOwner);
  let state = ITEM_STATE[str(c.state) ?? ""];
  if (type === "pull" && state === "open" && c.isDraft === true) state = "draft";
  if (type === "issue" && state === "closed") state = CLOSED_AS[str(c.stateReason) ?? ""] ?? state;
  return {
    id,
    type,
    // Items the login may not read (in a private repository) come without content.
    title: str(c.title) ?? (type === "redacted" ? "（読めない項目）" : ""),
    ...(num(c.number) ? { number: num(c.number) } : {}),
    ...(githubUrl(c.url) ? { url: githubUrl(c.url) } : {}),
    ...(itemRepo && itemRepo.toLowerCase() !== repo.toLowerCase() ? { repo: itemRepo } : {}),
    ...(state ? { state } : {}),
    assignees: arr(rec(c.assignees).nodes).flatMap((a) => (str(rec(a).login) ? [str(rec(a).login) as string] : [])),
    values,
  };
}

/** An iteration field's iterations as the options of its columns: those that ended, then the others, by their start. */
function iterations(configuration: unknown): BoardField["options"] {
  const c = rec(configuration);
  const of = (list: unknown, completed: boolean) =>
    arr(list).flatMap((raw) => {
      const it = rec(raw);
      const id = str(it.id);
      const title = str(it.title);
      return id && title !== undefined ? [{ id, name: title, ...(str(it.startDate) ? { startDate: str(it.startDate) } : {}), ...(completed ? { completed: true } : {}) }] : [];
    });
  const byStart = (a: { startDate?: string }, b: { startDate?: string }) => (a.startDate ?? "").localeCompare(b.startDate ?? "");
  return [...of(c.completedIterations, true).sort(byStart), ...of(c.iterations, false).sort(byStart)];
}

/**
 * A page of BOARD_QUERY's answer: the project (undefined when there is none) and the cursor of the next page. Items
 * of `repo` (owner/name, as GitHub names it now when the answer says) do not name their repository.
 */
export function parseBoardPage(
  json: string,
  repo: string,
): { board: Omit<Board, "repo" | "truncated" | "missing">; next?: string } | undefined {
  const repository = rec(rec(rec(parseJson(json)).data).repository);
  const p = rec(rec(repository.owner).projectV2);
  const current = str(repository.nameWithOwner) ?? repo;
  const number = num(p.number);
  const url = githubUrl(p.url);
  if (!number || !url) return undefined;
  const fields = arr(rec(p.fields).nodes).flatMap((raw): BoardField[] => {
    const f = rec(raw);
    const id = str(f.id);
    const name = str(f.name);
    if (!id || !name) return [];
    if (f.__typename === "ProjectV2IterationField") return [{ id, name, iteration: true, options: iterations(f.configuration) }];
    if (f.__typename !== "ProjectV2SingleSelectField") return [];
    const options = arr(f.options).flatMap((o) => {
      const opt = rec(o);
      const oid = str(opt.id);
      const oname = str(opt.name);
      return oid && oname !== undefined ? [{ id: oid, name: oname, ...(str(opt.color) ? { color: str(opt.color) } : {}) }] : [];
    });
    return [{ id, name, options }];
  });
  const boardView = arr(rec(p.views).nodes)
    .map(rec)
    .find((v) => v.layout === "BOARD_LAYOUT" && str(rec(arr(rec(v.verticalGroupByFields).nodes)[0]).id));
  const viewField = str(rec(arr(rec(boardView?.verticalGroupByFields).nodes)[0]).id);
  const defaultField =
    (viewField && fields.some((f) => f.id === viewField) ? viewField : undefined) ??
    fields.find((f) => !f.iteration && f.name.toLowerCase() === "status")?.id ??
    fields.find((f) => !f.iteration)?.id;
  const items = rec(p.items);
  const page = rec(items.pageInfo);
  return {
    board: {
      number,
      title: str(p.title) ?? "",
      url,
      closed: p.closed === true,
      ...(str(p.shortDescription) ? { shortDescription: str(p.shortDescription) } : {}),
      fields,
      ...(defaultField ? { defaultField } : {}),
      items: arr(items.nodes).flatMap((n) => {
        const item = parseItem(n, current);
        return item ? [item] : [];
      }),
    },
    ...(page.hasNextPage === true && str(page.endCursor) ? { next: str(page.endCursor) } : {}),
  };
}

/** Runs a GraphQL read; a scope the login lacks is an answer (`missing`), any other error is thrown. */
async function graphql(ctx: Gh, repo: string, query: string, vars: string[], maxAgeSeconds: number): Promise<{ stdout?: string; missing?: Projects["missing"] }> {
  try {
    const { stdout } = await ctx.github.read(["api", "graphql", "-f", `query=${query}`, ...vars], { repo, maxAgeSeconds, timeoutMs: 30_000, maxBuffer: 16 * 1024 * 1024 });
    const errors = graphqlErrors(parseJson(stdout));
    if (errors) {
      const missing = missingScope({ message: errors });
      if (missing) return { missing };
    }
    return { stdout };
  } catch (e) {
    const missing = missingScope(e);
    if (missing) return { missing };
    throw e;
  }
}

/** The projects of `repo` (owner/name) and of its owner. */
export async function listProjects(ctx: Gh, repo: string, o: { maxAgeSeconds: number }): Promise<Omit<Projects, "repo">> {
  const [owner = "", name = ""] = repo.split("/");
  const r = await graphql(ctx, repo, PROJECTS_QUERY, ["-f", `owner=${owner}`, "-f", `name=${name}`], o.maxAgeSeconds);
  if (r.missing) return { linked: [], owner: [], ownerLogin: owner, missing: r.missing };
  return parseProjects(r.stdout ?? "");
}

/** Project `number` of `repo`'s owner as a board; undefined when there is none. */
export async function readBoard(ctx: Gh, repo: string, number: number, o: { maxAgeSeconds: number }): Promise<Omit<Board, "repo"> | undefined> {
  const [owner = "", name = ""] = repo.split("/");
  let cursor: string | undefined;
  let board: Omit<Board, "repo" | "truncated" | "missing"> | undefined;
  for (let page = 0; page < BOARD_PAGES; page++) {
    const vars = ["-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`, ...(cursor ? ["-f", `cursor=${cursor}`] : [])];
    const r = await graphql(ctx, repo, BOARD_QUERY, vars, o.maxAgeSeconds);
    if (r.missing) return { number, title: "", url: "", closed: false, fields: [], items: [], truncated: false, missing: r.missing };
    const read = parseBoardPage(r.stdout ?? "", repo);
    if (!read) return board ? { ...board, truncated: true } : undefined;
    if (board) board.items.push(...read.board.items);
    else board = read.board;
    cursor = read.next;
    if (!cursor) break;
  }
  // Archived items count in totalCount but are left out: only a page not read means that some are missing.
  return board ? { ...board, truncated: Boolean(cursor) } : undefined;
}
