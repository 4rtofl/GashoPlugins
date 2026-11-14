// Below the "refreshSeconds" input of the settings screen: how many points of GitHub's hourly limit the background
// reads take, per working server, and how many worktrees each interval allows. GitHub's GraphQL API allows 5000
// points an hour per login, shared with every other use of gh (the kanban plugin, gh in a terminal).
import { useDaemonReady, useMachines, useRequest, useSetting } from "@gasho/plugin-sdk";
import { readOp } from "./daemon.ts";
import { Gauge } from "./ui/gauge.tsx";

const HOURLY_LIMIT = 5000;
/** Points one worktree takes per round, at most: its tabs, the issue its branch is named after, one open pull request. */
const POINTS_PER_ROUND = 3;
/** The share of the limit the background reads should keep to, leaving the rest to everything else. */
const SHARE = 0.5;
const INTERVALS = [30, 60, 120, 300, 600];

export const pointsPerHour = (worktrees: number, seconds: number): number => (seconds > 0 ? Math.ceil((worktrees * POINTS_PER_ROUND * 3600) / seconds) : 0);
export const worktreesFor = (seconds: number): number => Math.floor((HOURLY_LIMIT * SHARE * seconds) / (POINTS_PER_ROUND * 3600));

export function RefreshSettings() {
  const [refresh] = useSetting<number>("refreshSeconds");
  const machines = useMachines().filter((m) => m.connected);
  return (
    <div className="space-y-3 text-xs text-muted-foreground">
      <p>
        GitHub の API は、1 時間に {HOURLY_LIMIT.toLocaleString()} 点まで使えます。読み直すたびに、worktree 1 つにつき最大 {POINTS_PER_ROUND} 点使います。ほかの gh（カンバンなど）の分を残すため、半分の {(HOURLY_LIMIT * SHARE).toLocaleString()}{" "}
        点に収まる worktree の数を、間隔ごとに示します。
      </p>
      <table className="w-full max-w-sm border-collapse text-left tabular-nums">
        <thead>
          <tr className="border-b border-border">
            <th className="py-1 font-medium">間隔</th>
            <th className="py-1 font-medium">worktree の数の目安</th>
          </tr>
        </thead>
        <tbody>
          {INTERVALS.map((s) => (
            <tr key={s} className={s === refresh ? "text-foreground" : undefined}>
              <td className="py-0.5">{s} 秒</td>
              <td className="py-0.5">{worktreesFor(s)} 個まで</td>
            </tr>
          ))}
        </tbody>
      </table>
      {machines.map((m) => (
        <MachineLoad key={m.id} machine={m.id} name={m.name} />
      ))}
    </div>
  );
}

/** What the background reads take on one working server now: a gauge of the points an hour against the share kept to. */
function MachineLoad({ machine, name }: { machine: string; name: string }) {
  const daemon = useDaemonReady(machine);
  const r = useRequest<{ worktrees: number; refreshSeconds: number }>(daemon.ready ? readOp(machine, "status") : undefined, { staleSeconds: 0 });
  if (!r.data) return null;
  const { worktrees, refreshSeconds } = r.data;
  const points = pointsPerHour(worktrees, refreshSeconds);
  const over = refreshSeconds > 0 && worktrees > worktreesFor(refreshSeconds);
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border px-4 py-3">
      <Gauge value={points} max={HOURLY_LIMIT * SHARE} label="1 時間に最大" caption={`${(HOURLY_LIMIT * SHARE).toLocaleString()} 点のうち`} tone={over ? "warning" : "success"} size={160} />
      <p className={over ? "min-w-0 flex-1 text-amber-600 dark:text-amber-400" : "min-w-0 flex-1"}>
        {name}：ここ 24 時間に開いた worktree は {worktrees} 個です。
        {refreshSeconds > 0 ? `${refreshSeconds} 秒おきに読み直すと、1 時間に最大 ${points.toLocaleString()} 点使います。` : "裏では読み直していません。"}
        {over && "多すぎるので、間隔を延ばしてください。"}
      </p>
    </div>
  );
}
