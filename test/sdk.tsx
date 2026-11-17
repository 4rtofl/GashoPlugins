// "@gasho/plugin-sdk" in the tests of the plugins' screens (vitest.config.ts points their imports here). In Gasho, the
// screen gives the SDK at run time (globalThis.__gasho), so the tests have none: here, the hooks give what the test put
// in `scene` (or `respond`), and keep what they were called with in the mocks of `sdk`; Page, Panel, Tile and the other
// parts draw only what they get. Typed as the SDK (GashoSdk), so that a change of the SDK shows here.
import { useCallback, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { vi } from "vitest";
import type {
  CallResult,
  DaemonReadiness,
  GashoSdk,
  LaunchResult,
  MachineInfo,
  Navigation,
  RemoveWorktreeInput,
  RemoveWorktreeResult,
  RequestOptions,
  RequestState,
  RequestTarget,
  SessionActivity,
  SessionContext,
  SessionInfo,
} from "@gasho/plugin-sdk";

/** What a test sets for the hooks to give. `reset` puts it back after each test. */
export interface Scene {
  machines: MachineInfo[];
  session: SessionContext | undefined;
  /** useDaemonReady: the same for every working server, or by its id. */
  daemon: DaemonReadiness | ((machine: string) => DaemonReadiness);
  now: number;
  /** useSetting, by key. */
  settings: Record<string, unknown>;
  /** usePluginState, by key: kept for the whole test, as Gasho keeps it while the page is open. */
  pluginState: Record<string, unknown>;
  /** useSharedState, by key. */
  shared: Record<string, unknown>;
  /** useEvent, by topic. */
  events: Record<string, unknown>;
  activity: SessionActivity;
}

/** 2026-11-18 12:00 (UTC): useNow gives it unless the test sets another. */
export const NOW = Date.UTC(2026, 10, 18, 12);

const blank = (): Scene => ({
  machines: [],
  session: undefined,
  daemon: { ready: true },
  now: NOW,
  settings: {},
  pluginState: {},
  shared: {},
  events: {},
  activity: {},
});

export const scene: Scene = blank();

let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
/** Draws again what uses the hooks, after the test changed `scene` or the answers (wrap it in act). */
export function changed(): void {
  version++;
  for (const l of listeners) l();
}
const useScene = () => useSyncExternalStore(subscribe, () => version);

/** Changes `scene` and draws again. */
export function set(next: Partial<Scene>): void {
  Object.assign(scene, next);
  changed();
}

type Answer<T> = T | ((params: any) => T);
const answer = <T,>(a: Answer<T>, params: unknown): T => (typeof a === "function" ? (a as (p: unknown) => T)(params) : a);

/** What each call gave, by the method called. */
export const sdk = {
  /** useRequest, at each draw (not with an undefined target): what it gives; undefined means still loading. */
  request: vi.fn((_target: RequestTarget, _options?: RequestOptions): Partial<RequestState<unknown>> | undefined => undefined),
  /** The `reload` of what useRequest gives, with the method. */
  reload: vi.fn((_method: string) => {}),
  /** The function of useCall; undefined gives { ok: true, data: undefined }. */
  call: vi.fn((_target: RequestTarget & { summary?: string }): CallResult<unknown> | Promise<CallResult<unknown>> | undefined => undefined),
  setSetting: vi.fn((_key: string, _value: unknown) => {}),
  setShared: vi.fn((_key: string, _value: unknown) => {}),
  sendInput: vi.fn((_input: { machine: string; sessionId: string; text: string }): CallResult<undefined> => ({ ok: true, data: undefined })),
  launchSession: vi.fn((_input: { machine: string; cwd: string; name?: string; trust?: boolean }): LaunchResult => ({ ok: true, sessionId: "launched" })),
  removeWorktree: vi.fn((_input: RemoveWorktreeInput): RemoveWorktreeResult => ({ ok: true, sessions: [] })),
  removeWorktreeProblem: vi.fn((_machine: MachineInfo, _worktree: { path: string; repo?: string }): string | undefined => undefined),
  nav: {
    openPage: vi.fn((_id: string, _params?: Record<string, string>) => {}),
    openPanel: vi.fn((_id: string, _params?: Record<string, string>, _at?: { machine: string; sessionId: string }) => {}),
    replacePanel: vi.fn((_id: string, _params?: Record<string, string>) => {}),
    closePanel: vi.fn(() => {}),
    back: vi.fn((_panel: { id: string; params?: Record<string, string> }) => {}),
    openSession: vi.fn((_machine: string, _sessionId: string) => {}),
    openWorktreeView: vi.fn((_view: string, _params?: Record<string, string>, _at?: { machine: string; path: string }) => {}),
  },
};

/** What useRequest gives, by method: a state, or a function of the params that gives one (undefined: still loading). */
export function respond(byMethod: Record<string, Answer<Partial<RequestState<unknown>> | undefined>>): void {
  sdk.request.mockImplementation((t) => (t.method in byMethod ? answer(byMethod[t.method], t.params) : undefined));
  changed();
}

/** What the function of useCall gives, by method (others: { ok: true, data: undefined }). */
export function answerCalls(byMethod: Record<string, Answer<CallResult<unknown> | Promise<CallResult<unknown>>>>): void {
  sdk.call.mockImplementation((t) => (t.method in byMethod ? answer(byMethod[t.method], t.params) : undefined));
}

/** The params of the calls of useCall's function to `method`, in order. */
export const callsOf = (method: string): unknown[] => sdk.call.mock.calls.filter(([t]) => t.method === method).map(([t]) => t.params);

/** The target and options useRequest was last drawn with for `method` (undefined when it never was). */
export const lastRequest = (method: string): (RequestTarget & { options?: RequestOptions }) | undefined => {
  const found = sdk.request.mock.calls.findLast(([t]) => t.method === method);
  return found && { ...found[0], options: found[1] };
};

/** After each test (test/setup.ts). */
export function reset(): void {
  Object.assign(scene, blank());
  const mocks = [sdk.request, sdk.reload, sdk.call, sdk.setSetting, sdk.setShared, sdk.sendInput, sdk.launchSession, sdk.removeWorktree, sdk.removeWorktreeProblem, ...Object.values(sdk.nav)];
  for (const m of mocks) m.mockReset();
  version = 0;
}

/** A working server, connected, with `sessions`. */
export function machine(over: Partial<MachineInfo> = {}): MachineInfo {
  return { id: "m1", name: "mac", connected: true, lastSeen: NOW, sessions: [], ...over };
}

/** A session in /work/app. */
export function session(over: Partial<SessionInfo> = {}): SessionInfo {
  return { sessionId: "s1", cwd: "/work/app", status: "idle", rcMode: "none", prLinks: [], ...over };
}

const query = (params?: Record<string, string>) => (params && Object.keys(params).length > 0 ? `?${new URLSearchParams(params)}` : "");

const navigation: Navigation = {
  pageHref: (id, params) => `/page/${id}${query(params)}`,
  openPage: (id, params) => sdk.nav.openPage(id, params),
  panelHref: (id, params) => `/panel/${id}${query(params)}`,
  openPanel: (id, params, at) => sdk.nav.openPanel(id, params, at),
  replacePanel: (id, params) => sdk.nav.replacePanel(id, params),
  closePanel: () => sdk.nav.closePanel(),
  back: (panel) => sdk.nav.back(panel),
  sessionHref: (machineId, sessionId) => `/session/${machineId}/${sessionId}`,
  openSession: (machineId, sessionId) => sdk.nav.openSession(machineId, sessionId),
  worktreeHref: (view, params) => `/worktree/${view}${query(params)}`,
  openWorktreeView: (view, params, at) => sdk.nav.openWorktreeView(view, params, at),
};

function useKept<T>(store: "pluginState" | "shared", key: string, initial: T): [T, (value: T | ((prev: T) => T)) => T] {
  useScene();
  const value = (key in scene[store] ? scene[store][key] : initial) as T;
  const change = (next: T | ((prev: T) => T)) => {
    const prev = (key in scene[store] ? scene[store][key] : initial) as T;
    const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
    scene[store][key] = v;
    changed();
    return v;
  };
  return [value, change];
}

// What Gasho's screen does in these (apps/web/src/plugins/sdk.tsx, components/side-panel.tsx, lib/format.ts).
const rtf = new Intl.RelativeTimeFormat("ja", { numeric: "auto" });
export const relativeTime: GashoSdk["relativeTime"] = (ms, now) => {
  if (!ms) return "-";
  const sec = (ms - now) / 1000;
  const abs = Math.abs(sec);
  if (abs < 45) return "たった今";
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), "hour");
  return rtf.format(Math.round(sec / 86400), "day");
};
export const githubRepos: GashoSdk["githubRepos"] = (s) => {
  if (s.repos?.length) return s.repos.flatMap((r) => (r.github ? [{ path: r.path, github: r.github, ...(r.branch ? { branch: r.branch } : {}) }] : []));
  return s.github ? [{ github: s.github, ...(s.gitBranch ? { branch: s.gitBranch } : {}) }] : [];
};
export const panelRepo: GashoSdk["panelRepo"] = (s, asked, fit = () => true) => {
  const repos = s.repos?.filter(fit);
  if (!repos) return {};
  return { repos, selected: repos.find((r) => r.path === asked) ?? repos[0] };
};
export const cn: GashoSdk["cn"] = (...classes) => classes.flat(Infinity).filter((c) => typeof c === "string" && c).join(" ");

export const definePlugin: GashoSdk["definePlugin"] = (def) => def;
export const useMachines: GashoSdk["useMachines"] = () => (useScene(), scene.machines);
export const useSessionContext: GashoSdk["useSessionContext"] = () => (useScene(), scene.session);
export const useDaemonReady: GashoSdk["useDaemonReady"] = (m) => (useScene(), typeof scene.daemon === "function" ? scene.daemon(m) : scene.daemon);
export const useNow: GashoSdk["useNow"] = () => (useScene(), scene.now);
export const useSessionActivity: GashoSdk["useSessionActivity"] = () => (useScene(), scene.activity);
export const useEvent: GashoSdk["useEvent"] = <T,>(topic: string) => (useScene(), scene.events[topic] as T | undefined);
export const useNavigation: GashoSdk["useNavigation"] = () => navigation;
export const removeWorktreeProblem: GashoSdk["removeWorktreeProblem"] = (m, w) => sdk.removeWorktreeProblem(m, w);

export const useRequest: GashoSdk["useRequest"] = <T,>(target: RequestTarget | undefined, options?: RequestOptions): RequestState<T> => {
  useScene();
  // The same reload while the target is the same, as in Gasho: parts put it in the dependencies of their effects.
  const key = target && JSON.stringify([target.machine, target.sessionId, target.method, target.params]);
  const targetRef = useRef(target);
  targetRef.current = target;
  const reload = useCallback(() => {
    if (targetRef.current) sdk.reload(targetRef.current.method);
  }, [key]);
  if (!target) return { loading: false, reload };
  const state = sdk.request(target, options);
  return { loading: !state, reload, ...state } as RequestState<T>;
};

export const useCall: GashoSdk["useCall"] =
  () =>
  async <T,>(target: RequestTarget & { summary?: string }) =>
    ((await sdk.call(target)) ?? { ok: true, data: undefined }) as CallResult<T>;

export const useSetting: GashoSdk["useSetting"] = <T,>(key: string): [T, (value: T) => Promise<void>] => {
  useScene();
  return [
    scene.settings[key] as T,
    async (value: T) => {
      sdk.setSetting(key, value);
      scene.settings[key] = value;
      changed();
    },
  ];
};

export const usePluginState: GashoSdk["usePluginState"] = <T,>(key: string, initial: T) => {
  const [value, change] = useKept("pluginState", key, initial);
  return [value, (next: T | ((prev: T) => T)) => void change(next)];
};

export const useSharedState: GashoSdk["useSharedState"] = <T,>(key: string, initial: T) => {
  const [value, change] = useKept("shared", key, initial);
  return [
    value,
    async (next: T | ((prev: T) => T)) => {
      sdk.setShared(key, change(next));
    },
  ];
};

export const useSendInput: GashoSdk["useSendInput"] = () => async (input) => sdk.sendInput(input);
export const useLaunchSession: GashoSdk["useLaunchSession"] = () => async (input) => sdk.launchSession(input);
export const useRemoveWorktree: GashoSdk["useRemoveWorktree"] = () => async (input) => sdk.removeWorktree(input);

export const PANEL_BUTTON: GashoSdk["PANEL_BUTTON"] = "";

export const Page: GashoSdk["Page"] = ({ title, description, actions, children }) => (
  <section>
    <h1>{title}</h1>
    {description && <p>{description}</p>}
    {actions}
    {children}
  </section>
);

export const Panel: GashoSdk["Panel"] = ({ title, subtitle, actions, children }) => (
  <section>
    <h2>{title}</h2>
    {subtitle && <p>{subtitle}</p>}
    {actions}
    {children}
  </section>
);

export const Tile: GashoSdk["Tile"] = ({ title, icon, children }) => (
  <section>
    {title && <h2>{title}</h2>}
    {icon}
    {children}
  </section>
);

export const RepoTabs: GashoSdk["RepoTabs"] = ({ repos, selected, onSelect }) => (
  <div role="tablist" aria-label="リポジトリ">
    {repos.map((r) => (
      <button key={r.path} type="button" role="tab" aria-selected={r.path === selected} onClick={() => onSelect(r.path)}>
        {r.path}
      </button>
    ))}
  </div>
);

export const Markdown: GashoSdk["Markdown"] = ({ text }) => <div>{text}</div>;

export const RelativeTime: GashoSdk["RelativeTime"] = ({ at, now }) => <time>{relativeTime(typeof at === "string" ? Date.parse(at) : at, now)}</time>;

/** Opens and closes on a press of the trigger; what it shows is drawn only while it is open, as in Gasho. */
export const Popover: GashoSdk["Popover"] = ({ trigger, children, label, open, onOpenChange }) => {
  const [inner, setInner] = useState(false);
  const shown = open ?? inner;
  const toggle = () => {
    if (open === undefined) setInner(!shown);
    onOpenChange?.(!shown);
  };
  return (
    <>
      <span onClick={toggle}>{trigger as ReactNode}</span>
      {shown && (
        <div role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </>
  );
};
