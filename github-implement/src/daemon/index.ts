// The daemon part of github-implement: a worktree's issues and pull requests, one of them in full, and the changes the
// screen asks for, all with gh through gasho-daemon (ctx.github). Each operation is a file of ops/ and each part of the
// read of one item a file of detail/ (Vite puts every file of the folder here), so that new ones are new files. The
// worktrees Gasho showed in the last day are read again in the background, every "refreshSeconds" (a setting), so that
// their tabs and screens open with what GitHub has now: their items every time, the rest of an item when its version
// changed or what was read of it is KEEP_MAX_SECONDS old (core.ts).
import { defineDaemonPlugin, type DaemonStartContext } from "@gasho/plugin-sdk/daemon";
import { addDetailParts, begin, current, end, readAgain, refreshSeconds, SHOWN_WITHIN_MS, takeSettings } from "./core.ts";
import type { DetailPart } from "./gh.ts";
import { dispatch, opsByName, type Op } from "./op.ts";

const OPS = opsByName(import.meta.glob<{ default: Op }>("./ops/*.ts", { eager: true }));
addDetailParts(Object.values(import.meta.glob<{ default: DetailPart }>("./detail/*.ts", { eager: true })).map((m) => m.default));

let timer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;

/** Reads again the worktrees shown in the last day, one after another, then waits for the next round. */
async function round(ctx: DaemonStartContext): Promise<void> {
  const s = current();
  await s.load();
  for (const [, w] of s.shownSince(Date.now() - SHOWN_WITHIN_MS)) {
    if (stopped) return;
    await readAgain(ctx, w, () => stopped);
  }
}

function schedule(ctx: DaemonStartContext): void {
  if (stopped) return;
  const seconds = refreshSeconds();
  // 0 turns the background reads off; the interval is checked again in a minute.
  timer = setTimeout(
    () => {
      void (seconds === 0 ? Promise.resolve() : round(ctx)).finally(() => schedule(ctx));
    },
    (seconds === 0 ? 60 : seconds) * 1000,
  );
}

export default defineDaemonPlugin({
  start(ctx) {
    stopped = false;
    begin(ctx.dataDir, ctx.settings, ctx.log);
    schedule(ctx);
  },
  stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    end();
  },
  methods: {
    /** The operation of ops/ that only reads: { op, ... }. */
    read(params, ctx) {
      takeSettings(ctx.settings);
      return dispatch(OPS, "read", params, ctx);
    },
    /** The operation of ops/ that changes something: { op, ... }. Gasho's operation log has the call. */
    write(params, ctx) {
      takeSettings(ctx.settings);
      return dispatch(OPS, "write", params, ctx);
    },
  },
});
