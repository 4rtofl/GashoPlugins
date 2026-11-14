// Follows a session folder's commands with `watch` (README.md「出力は変化を待つ呼び出しで届ける」): the daemon part
// answers once something changed, and the next call goes out at once; 0.2 s later while output flows, 2 s later when
// the daemon part has too many calls waiting, a second later when an answer brought nothing. It pauses while the page
// is hidden and goes on from where it was. The state lives in usePluginState, so that reopening the panel or a hot
// reload shows it without reading it again.
import { useEffect, useRef } from "react";
import { useCall, usePluginState } from "@gasho/plugin-sdk";
import type { ShellView } from "../types.ts";
import { EMPTY_STATE, mergeView, offsetsFor, type ShellState } from "./state";

const WAIT_MS = 20_000;
const FLOWING_PAUSE_MS = 200;
const BUSY_PAUSE_MS = 2000;
const IDLE_PAUSE_MS = 1000;
const HIDDEN_PAUSE_MS = 60_000;
const RETRY_MS = [1000, 2000, 5000];

export interface Shell {
  state: ShellState;
  /** Changes the state here (the answer of `run`, of `output`), until the next answer of `watch`. */
  update: (change: (s: ShellState) => ShellState) => void;
}

export function useShell(machine: string, sessionId: string, enabled: boolean): Shell {
  const call = useCall();
  const [state, setState] = usePluginState<ShellState>(`shell:${machine}/${sessionId}`, EMPTY_STATE);
  const latest = useRef(state);
  latest.current = state;
  const callRef = useRef(call);
  callRef.current = call;
  const setRef = useRef(setState);
  setRef.current = setState;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let wake: () => void = () => undefined;
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") wake();
    };
    const put = (next: ShellState) => {
      latest.current = next;
      setRef.current(next);
    };
    document.addEventListener("visibilitychange", onVisible);
    void (async () => {
      let failures = 0;
      while (!stopped) {
        if (document.visibilityState !== "visible") {
          await pause(HIDDEN_PAUSE_MS);
          continue;
        }
        const before = latest.current;
        const r = await callRef.current<ShellView>({
          machine,
          sessionId,
          method: "watch",
          params: { ...(before.version ? { since: before.version } : {}), offsets: offsetsFor(before), waitMs: WAIT_MS },
        });
        if (stopped) return;
        if (!r.ok) {
          failures++;
          put({ ...latest.current, error: r.error });
          await pause(RETRY_MS[Math.min(failures, RETRY_MS.length) - 1] ?? 5000);
          continue;
        }
        failures = 0;
        const flowing = Object.keys(r.data.output).length > 0;
        const moved = flowing || r.data.version !== before.version;
        put(mergeView(latest.current, r.data, Date.now()));
        if (r.data.busy) await pause(BUSY_PAUSE_MS);
        else if (flowing) await pause(FLOWING_PAUSE_MS);
        else if (!moved) await pause(IDLE_PAUSE_MS);
      }
    })();
    return () => {
      stopped = true;
      wake();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [machine, sessionId, enabled]);

  const update = (change: (s: ShellState) => ShellState) => {
    const next = change(latest.current);
    latest.current = next;
    setState(next);
  };
  return { state, update };
}
