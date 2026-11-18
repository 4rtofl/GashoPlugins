// Below the "refreshSeconds" input of the settings screen: how many points of GitHub's hourly limit the background
// reads take, per working server, and how many worktrees each interval allows. GitHub's GraphQL API allows 5000
// points an hour per login, shared with every other use of gh (the kanban plugin, gh in a terminal).
import { useDaemonReady, useMachines, useRequest, useSetting } from "@gasho/plugin-sdk";
import { readOp } from "./daemon.ts";
import { Gauge } from "./ui/gauge.tsx";

const HOURLY_LIMIT = 5000;
/** Points one worktree takes per round while its issues and pull requests do not change: the read of its tabs. */
const POINTS_PER_ROUND = 1;
/**
 * What a round reads besides when they changed, or when what was read of them is REREAD_SECONDS old (KEEP_MAX_SECONDS
 * of src/daemon/core.ts): the issue its branch is named after (2 points) and one open pull request (1).
 */
const POINTS_PER_REREAD = 3;
const REREAD_SECONDS = 600;
/** The share of the limit the background reads should keep to, leaving the rest to everything else. */
const SHARE = 0.5;
const INTERVALS = [30, 60, 120, 300, 600];

/** Points an hour while nothing changes: the tabs every round, the rest at the first round REREAD_SECONDS after they were read. */
export function pointsPerHour(worktrees: number, seconds: number): number {
  if (seconds <= 0) return 0;
  const rereads = 3600 / (seconds * Math.ceil(REREAD_SECONDS / seconds));
  return Math.ceil(worktrees * ((3600 / seconds) * POINTS_PER_ROUND + rereads * POINTS_PER_REREAD));
}
export const worktreesFor = (seconds: number): number => Math.floor((HOURLY_LIMIT * SHARE) / pointsPerHour(1, seconds));

export function RefreshSettings() {
  const [refresh] = useSetting<number>("refreshSeconds");
  const machines = useMachines().filter((m) => m.connected);
  return (
    <div className="space-y-3 text-xs text-muted-foreground">
      <p>
        GitHub の API は、1 時間に {HOURLY_LIMIT.toLocaleString()} 点まで使えます。読み直すたびに、worktree 1 つにつき {POINTS_PER_ROUND} 点使います。Issue や Pull request が変わったときと、前に読んでから {REREAD_SECONDS / 60}{" "}
        分たったときは、さらに最大 {POINTS_PER_REREAD} 点使います。ほかの gh（カンバンなど）の分を残すため、半分の {(HOURLY_LIMIT * SHARE).toLocaleString()} 点に収まる worktree の数を、Issue や Pull
        request が変わらないものとして、間隔ごとに示します。
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
        <MachineLoad key={m.id} machine={m.id} name={m.name} refresh={refresh} />
      ))}
    </div>
  );
}

/**
 * What the background reads take on one working server, while nothing changes: a gauge of the points an hour against
 * the share kept to. The interval is the one in the input above, which the daemon part gets with its next call.
 */
function MachineLoad({ machine, name, refresh }: { machine: string; name: string; refresh: number | undefined }) {
  const daemon = useDaemonReady(machine);
  const r = useRequest<{ worktrees: number; refreshSeconds: number }>(daemon.ready ? readOp(machine, "status") : undefined, { staleSeconds: 0 });
  if (!r.data) return null;
  const { worktrees } = r.data;
  const refreshSeconds = typeof refresh === "number" && Number.isFinite(refresh) && refresh >= 0 ? refresh : r.data.refreshSeconds;
  const points = pointsPerHour(worktrees, refreshSeconds);
  const over = refreshSeconds > 0 && worktrees > worktreesFor(refreshSeconds);
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border px-4 py-3">
      <Gauge value={points} max={HOURLY_LIMIT * SHARE} label="1 時間に" caption={`${(HOURLY_LIMIT * SHARE).toLocaleString()} 点のうち`} tone={over ? "warning" : "success"} size={160} />
      <p className={over ? "min-w-0 flex-1 text-amber-600 dark:text-amber-400" : "min-w-0 flex-1"}>
        {name}：ここ 24 時間に開いた worktree は {worktrees} 個です。
        {refreshSeconds > 0 ? `${refreshSeconds} 秒おきに読み直すと、Issue や Pull request が変わらなければ 1 時間に ${points.toLocaleString()} 点使います。` : "裏では読み直していません。"}
        {over && "多すぎるので、間隔を延ばしてください。"}
      </p>
    </div>
  );
}
