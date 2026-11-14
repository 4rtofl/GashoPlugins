// Which worktree deployed to each Stack last, for the marks on the cards and the headings above the board. A deploy is
// a process on the working server that runs the deploy script with a Stack's name (./deploy.sh --stage dev1): `fetch`
// finds them with ps (and lsof, for the folder of a script started by a relative path) and keeps what it saw of each
// Stack in its store. The board is read only while it shows, so a deploy that starts and ends while it does not is not
// seen.
import type { BoardHeading, CardMark, FetchContext, FetchRepo, StateCard } from "../types.ts";

/** The deploys to look for: change these for your project. */
export const DEPLOY = {
  /** The script's file name, however it is started (bash ./deploy.sh, /path/to/deploy.sh). */
  scripts: ["deploy.sh"],
  /** The option that names the Stack (--stage dev1, or --stage=dev1). */
  option: "--stage",
  /** The Stacks to show, also before a deploy to them is seen; empty for every Stack a deploy is seen to. */
  stacks: [] as string[],
  /** Options with which the script does not deploy (it only shows the outputs, say). */
  skip: [] as string[],
};

/** What was seen of a Stack: the deploy that started last. */
export interface StackRecord {
  /** The worktree (or primary checkout) it ran in. */
  path: string;
  /** When it was first and last seen running (ms since the epoch). */
  started: number;
  seen: number;
  /** The folders that deployed to the Stack in the last reading: empty once the deploys are over. */
  running: string[];
}

export type Stacks = Record<string, StackRecord>;

const base = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

/** Programs that run a script, and their short options that take a command as a string (zsh -c '…', node -e '…'). */
const RUNNERS: Record<string, string> = { bash: "c", sh: "c", zsh: "c", node: "ep" };
const inline = (arg: string, letters: string): boolean =>
  arg === "--eval" || arg === "--print" || (/^-[^-]/.test(arg) && [...arg.slice(1)].some((c) => letters.includes(c)));

/** A line of `ps -o pid=,command=` that deploys to a Stack: the pid, the Stack, and the script as it was started. */
export function parseDeploy(line: string): { pid: number; stack: string; script: string } | undefined {
  const [pid = "", ...argv] = line.trim().split(/\s+/);
  const at = argv.findIndex((a) => DEPLOY.scripts.includes(base(a)));
  const runner = argv[0] === undefined ? undefined : RUNNERS[base(argv[0])];
  // Only the process that runs the script: ps does not keep where an argument ends, so a shell given the command as a
  // string (zsh -c 'cd x && ./deploy.sh …') is left out.
  if (!/^\d+$/.test(pid) || at < 0 || (at > 0 && (runner === undefined || argv.slice(1, at).some((a) => inline(a, runner))))) return undefined;
  const args = argv.slice(at + 1);
  // After "--" come the options of the tool the script runs.
  const own = args.includes("--") ? args.slice(0, args.indexOf("--")) : args;
  if (own.some((a) => DEPLOY.skip.includes(a))) return undefined;
  const i = own.indexOf(DEPLOY.option);
  const stack = i >= 0 ? own[i + 1] : own.find((a) => a.startsWith(`${DEPLOY.option}=`))?.slice(DEPLOY.option.length + 1);
  if (!stack || stack.startsWith("-") || (DEPLOY.stacks.length > 0 && !DEPLOY.stacks.includes(stack))) return undefined;
  return { pid: Number(pid), stack, script: argv[at] ?? "" };
}

/** `p` from the folder `cwd`, without "." and "..". */
function resolve(cwd: string, p: string): string {
  const parts: string[] = [];
  for (const part of (p.startsWith("/") ? p : `${cwd}/${p}`).split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** The deploys running now in the folders of `repo`: the folders deploying to each Stack. */
async function running(repo: FetchRepo, exec: FetchContext["exec"]): Promise<Map<string, string[]>> {
  const { stdout } = await exec("ps", ["axww", "-o", "pid=,command="]);
  const found = stdout.split("\n").flatMap((line) => parseDeploy(line) ?? []);
  const cwd = new Map<number, string>();
  const relative = found.filter((d) => !d.script.startsWith("/"));
  if (relative.length > 0) {
    // lsof fails when one of them ended after ps; what it printed for the others still counts. Without lsof (on some
    // Linux), the scripts started by a relative path are not seen.
    const out = await exec("lsof", ["-a", "-p", relative.map((d) => d.pid).join(","), "-d", "cwd", "-Fpn"]).then(
      (r) => r.stdout,
      (e: unknown) => {
        const printed = (e as { stdout?: unknown } | null)?.stdout;
        return typeof printed === "string" ? printed : "";
      },
    );
    let pid: number | undefined;
    for (const line of out.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      else if (line.startsWith("n") && pid !== undefined) cwd.set(pid, line.slice(1));
    }
  }
  const folders = [repo.primary.path, ...repo.worktrees.map((w) => w.path)].sort((a, b) => b.length - a.length);
  const live = new Map<string, string[]>();
  for (const d of found) {
    const dir = d.script.startsWith("/") ? "/" : cwd.get(d.pid);
    if (dir === undefined) continue;
    const file = resolve(dir, d.script);
    const folder = folders.find((f) => file.startsWith(`${f}/`));
    if (folder) live.set(d.stack, [...new Set([...(live.get(d.stack) ?? []), folder])].sort());
  }
  return live;
}

/** What is known of each Stack after a reading at `now` that found `live` (the folders deploying to each Stack). */
export function track(stacks: Stacks, live: Map<string, string[]>, now: number): Stacks {
  const out: Stacks = { ...stacks };
  for (const [stack, folders] of live) {
    const last = stacks[stack];
    // A folder that did not deploy to it in the reading before started a deploy: the one started last is kept, even
    // while another is still at it.
    const started = folders.find((f) => !last?.running.includes(f));
    out[stack] = last && started === undefined ? { ...last, seen: now, running: folders } : { path: started ?? "", started: now, seen: now, running: folders };
  }
  for (const [stack, last] of Object.entries(stacks)) if (!live.has(stack) && last.running.length > 0) out[stack] = { ...last, running: [] };
  return out;
}

/** For `fetch`: finds the deploys running now, and keeps what is known of each Stack in the store. */
export async function readStacks(repo: FetchRepo, { exec, store }: Pick<FetchContext<Stacks>, "exec" | "store">): Promise<Stacks> {
  const before = store.get() ?? {};
  const after = track(before, await running(repo, exec), Date.now());
  if (JSON.stringify(after) !== JSON.stringify(before)) await store.set(after);
  return after;
}

const clock = (ms: number): string => new Date(ms).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** The Stacks the card's worktree deploys to now. */
export function deployingTo(card: StateCard, stacks: Stacks | undefined): string[] {
  const at = card.path;
  return at === undefined ? [] : Object.keys(stacks ?? {}).filter((s) => stacks?.[s]?.running.includes(at));
}

/** The marks of a card: the Stacks its worktree deploys to now, and those it deployed to last. */
export function stackMarks(card: StateCard, stacks: Stacks | undefined): CardMark[] {
  const now = new Set(deployingTo(card, stacks));
  return Object.entries(stacks ?? {}).flatMap(([stack, r]): CardMark[] => {
    if (now.has(stack)) return [{ text: `${stack} デプロイ中`, detail: r.path === card.path ? `${clock(r.started)} から ${stack} にデプロイしている` : `${stack} にデプロイしている`, active: true }];
    return r.path === card.path ? [{ text: stack, detail: `${stack} に最後にデプロイした（${clock(r.started)} から ${clock(r.seen)} ごろまで）` }] : [];
  });
}

/** The headings above the board: for each Stack, the worktree that deployed to it last. */
export function stackHeadings(stacks: Stacks | undefined): BoardHeading[] {
  return [...new Set([...DEPLOY.stacks, ...Object.keys(stacks ?? {}).sort()])].map((stack): BoardHeading => {
    const r = stacks?.[stack];
    if (!r) return { label: stack, text: "記録なし", detail: `${stack} へのデプロイを、まだ見ていない` };
    const wt = base(r.path);
    if (r.running.length > 0) return { label: stack, text: `${wt} デプロイ中`, active: true, detail: `${clock(r.started)} から ${wt} がデプロイしている` };
    return { label: stack, text: wt, at: r.seen, detail: `${wt} が ${clock(r.started)} から ${clock(r.seen)} ごろまでデプロイした` };
  });
}
