// Whether a PID kept in a record still names the process it was written for (README.md「プラグインが止まるとき」).
// Once a process has gone, its PID is given to another one, so a record keeps when the process started as well, and a
// PID counts as the same process only while that start is the same.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";

/** The start of a process from its line in /proc/<pid>/stat (field 22: clock ticks after boot), or undefined. */
export function statStart(stat: string): string | undefined {
  // Field 2, the program's name, is in parentheses and may hold spaces and parentheses itself: the fields after it
  // start after the last ")". fields[0] is field 3.
  const close = stat.lastIndexOf(")");
  if (close < 0) return undefined;
  const start = stat.slice(close + 2).split(" ")[19];
  return start && /^\d+$/.test(start) ? start : undefined;
}

let bootId: Promise<string> | undefined;

async function linuxStart(pid: number): Promise<string | undefined> {
  // Ticks after boot repeat from one boot to the next; the boot's id tells them apart.
  bootId ??= fs.readFile("/proc/sys/kernel/random/boot_id", "utf8").then(
    (s) => s.trim(),
    () => "",
  );
  try {
    const start = statStart(await fs.readFile(`/proc/${pid}/stat`, "utf8"));
    return start === undefined ? undefined : `${await bootId}:${start}`;
  } catch {
    return undefined;
  }
}

function psStart(pid: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    // The same locale and time zone each time, so that the same start reads the same.
    execFile("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { env: { LC_ALL: "C", TZ: "UTC" }, timeout: 5000 }, (err, stdout) => {
      const start = String(stdout ?? "").trim();
      resolve(!err && start ? start : undefined);
    });
  });
}

/** When the process `pid` started, to compare with what was read before; undefined when it is not there or cannot be read. */
export function processStart(pid: number | undefined): Promise<string | undefined> {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return Promise.resolve(undefined);
  return process.platform === "linux" ? linuxStart(pid) : psStart(pid);
}

/** `pid` still names the process that started at `start`. */
export async function sameProcess(pid: number | undefined, start: string | undefined): Promise<boolean> {
  return start !== undefined && (await processStart(pid)) === start;
}
