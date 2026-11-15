// What the buttons of a pull request's row do: make its review worktree on a working server, start a session there,
// send the chosen template and open the session; open the worktree it has (its Gasho session, or one started there);
// and remove its review worktree. The daemon part does the git; the page asks the person before trusting a folder and
// before removing.
import { relativeTime, type MachineInfo, type Navigation, type SessionInfo, type useCall, type useLaunchSession, type useSendInput } from "@gasho/plugin-sdk";
import type { Item as AnyItem, Spot as AnySpot } from "../items.ts";
import { fillTemplate, type Template } from "../template.ts";
import type { Created, PrRow, Removed } from "../types.ts";

/** Where a pull request is on one working server: the clone of its repository, and its worktree there. */
export type Spot = AnySpot<MachineInfo>;
/** A pull request of the page, with where it is on every working server that listed it. */
export type Item = AnyItem<MachineInfo>;

/** What a row's button is doing or did, shown at the bottom of the page. */
export interface Notice {
  text: string;
  tone?: "danger";
  /** Still going: the notice stays until it is done. */
  busy?: boolean;
}

/** What the rows ask of the page. */
export interface Actions {
  notify: (n: Notice | undefined) => void;
  askTrust: (q: { path: string; warnings: string[] }) => Promise<boolean>;
  askRemove: (q: { item: Item; spot: Spot }) => Promise<boolean>;
  /** Reads a working server's list again. */
  reload: (machine: string) => void;
}

export interface Tools {
  call: ReturnType<typeof useCall>;
  launch: ReturnType<typeof useLaunchSession>;
  send: ReturnType<typeof useSendInput>;
  nav: Navigation;
  actions: Actions;
}

const lastUsed = (s: SessionInfo): number => s.lastActivityAt ?? s.startedAt ?? 0;

/** The sessions Gasho started in a folder (or below it), the one used last first: only these open in Gasho. */
export function sessionsIn(machine: MachineInfo, dir: string): SessionInfo[] {
  return machine.sessions.filter((s) => s.managed && (s.cwd === dir || s.cwd.startsWith(`${dir}/`))).sort((a, b) => lastUsed(b) - lastUsed(a));
}

const folderName = (p: string): string => p.split("/").filter(Boolean).pop() ?? p;

/** Starts a session in a folder; its id, or undefined (with the reason shown) when it did not start. */
async function start(machine: MachineInfo, cwd: string, t: Tools): Promise<string | undefined> {
  const starting: Notice = { text: `${folderName(cwd)} でセッションを起動しています…`, busy: true };
  t.actions.notify(starting);
  let r = await t.launch({ machine: machine.id, cwd });
  if (!r.ok && r.needsTrust) {
    t.actions.notify(undefined);
    if (!(await t.actions.askTrust({ path: cwd, warnings: r.trustWarnings ?? [] }))) return undefined;
    t.actions.notify(starting);
    r = await t.launch({ machine: machine.id, cwd, trust: true });
  }
  if (r.ok) return r.sessionId;
  t.actions.notify({ text: r.error, tone: "danger" });
  return undefined;
}

/** Opens the Gasho session used last in a folder, or one started there. */
async function openIn(machine: MachineInfo, dir: string, t: Tools): Promise<void> {
  const sessionId = sessionsIn(machine, dir)[0]?.sessionId ?? (await start(machine, dir, t));
  if (!sessionId) return;
  t.actions.notify(undefined);
  t.nav.openSession(machine.id, sessionId);
}

/**
 * Makes the review worktree of a pull request on a working server, starts a session there, sends the template (none
 * for "何も送らない") and opens the session. When the worktree turns out to be there already, it only opens.
 */
export async function createWorktree({ pr }: Item, spot: Spot, template: Template | undefined, t: Tools): Promise<void> {
  const { machine } = spot;
  t.actions.notify({ text: `#${pr.number} のレビュー用の worktree を作っています…`, busy: true });
  const r = await t.call<Created>({
    machine: machine.id,
    method: "create",
    params: { repo: pr.repo, number: pr.number },
    summary: `${pr.repo}#${pr.number} のレビュー用の worktree を作る`,
  });
  t.actions.reload(machine.id);
  if (!r.ok) {
    t.actions.notify({ text: r.error, tone: "danger" });
    return;
  }
  if (!r.data.created) {
    await openIn(machine, r.data.path, t);
    return;
  }
  const sessionId = await start(machine, r.data.path, t);
  if (!sessionId) return;
  if (template) {
    t.actions.notify({ text: `「${template.name}」を送っています…`, busy: true });
    const sent = await t.send({ machine: machine.id, sessionId, text: fillTemplate(template.body, pr) });
    if (!sent.ok) {
      t.actions.notify({ text: `セッションは起動しましたが、「${template.name}」を送れませんでした：${sent.error}`, tone: "danger" });
      return;
    }
  }
  t.actions.notify(undefined);
  t.nav.openSession(machine.id, sessionId);
}

/** Opens the worktree a pull request has on a working server. */
export async function openWorktree(spot: Spot, t: Tools): Promise<void> {
  if (spot.worktree) await openIn(spot.machine, spot.worktree.path, t);
}

/** Removes a pull request's review worktree and its local branch, once the person agrees. */
export async function removeWorktree(item: Item, spot: Spot, t: Tools): Promise<void> {
  const { pr } = item;
  if (!spot.worktree?.review || !(await t.actions.askRemove({ item, spot }))) return;
  t.actions.notify({ text: `${folderName(spot.worktree.path)} を片付けています…`, busy: true });
  const r = await t.call<Removed>({
    machine: spot.machine.id,
    method: "remove",
    params: { repo: pr.repo, number: pr.number },
    summary: `${pr.repo}#${pr.number} のレビュー用の worktree を片付ける`,
  });
  t.actions.reload(spot.machine.id);
  t.actions.notify(
    r.ok
      ? { text: `${folderName(r.data.path)} を片付けました${r.data.branch ? `（ローカルのブランチ ${r.data.branch} も消しました）` : ""}。` }
      : { text: r.error, tone: "danger" },
  );
}

/** "totosuki が 3日前に開いた": who opened a pull request, and when. */
export function openedText(pr: Pick<PrRow, "author" | "createdAt">, now: number): string {
  const when = pr.createdAt ? relativeTime(Date.parse(pr.createdAt), now) : undefined;
  return [pr.author ? `${pr.author} が` : undefined, when ? `${when}に開いた` : "開いた"].filter(Boolean).join(" ");
}
