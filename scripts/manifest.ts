// The rules a Gasho server checks a plugin's gasho-plugin.json by (checkManifest in Gasho's apps/hub/src/plugins.ts),
// so that what it would refuse fails here first: scripts/check.ts checks every plugin's gasho-plugin.json, and
// release.ts the one of dist/ with its files, before releasing it. Keep them in line with the hub's.
//
// It runs before anything is installed (scripts/check.ts): it imports only types of the SDK.
import type { PluginInfo } from "@gasho/plugin-sdk";

type PluginManifest = PluginInfo["manifest"];
type Permission = NonNullable<PluginManifest["permissions"]>[number];
type ThemeName = keyof NonNullable<PluginManifest["theme"]>;

export const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
export const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const API_RE = /^(\d+)\.(\d+)$/;
const KEY_RE = /^[A-Za-z][\w-]{0,63}$/;
const API_MAJOR = 1;
/** The plugin API that brought themes. */
const THEME_API_MINOR = 6;
const THEME_VALUE_MAX = 64;
const MAX_TIMEOUT_SECONDS = 120;

// Checked against the SDK's types: a permission or a theme's name that the SDK adds or takes away fails npm run typecheck.
const PERMISSIONS = { "session.input": true, "session.launch": true, "session.remove": true, "worktree.remove": true, "session.notification": true } satisfies Record<Permission, true>;
const THEME_NAMES = {
  background: true,
  foreground: true,
  card: true,
  "card-foreground": true,
  popover: true,
  "popover-foreground": true,
  surface: true,
  "surface-raised": true,
  "surface-hover": true,
  primary: true,
  "primary-foreground": true,
  secondary: true,
  "secondary-foreground": true,
  muted: true,
  "muted-foreground": true,
  accent: true,
  "accent-foreground": true,
  destructive: true,
  border: true,
  "border-hover": true,
  input: true,
  ring: true,
  sidebar: true,
  "sidebar-foreground": true,
  "sidebar-primary": true,
  "sidebar-primary-foreground": true,
  "sidebar-accent": true,
  "sidebar-accent-foreground": true,
  "sidebar-border": true,
  "sidebar-ring": true,
  "chart-1": true,
  "chart-2": true,
  "chart-3": true,
  "chart-4": true,
  "chart-5": true,
  "neutral-50": true,
  "neutral-100": true,
  "neutral-200": true,
  "neutral-300": true,
  "neutral-400": true,
  "neutral-500": true,
  "neutral-600": true,
  "neutral-700": true,
  "neutral-800": true,
  "neutral-900": true,
  "neutral-950": true,
  radius: true,
} satisfies Record<ThemeName, true>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Orders two plugin versions ("1.2.0", "1.2.0-beta.1"), as the Gasho server does: negative when `a` is older than `b`. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v);
    return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] } : { nums: [0, 0, 0], pre: undefined };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
  // A pre-release comes before its release.
  if (x.pre === y.pre) return 0;
  if (x.pre === undefined) return 1;
  if (y.pre === undefined) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** A file of the plugin, relative to its folder ("web.js", "assets/x.js"): never one outside it. */
function safeRelative(p: unknown): string | undefined {
  if (typeof p !== "string" || !p || p.length > 300 || p.includes("\0") || p.includes("\\")) return undefined;
  const parts = p.split("/");
  return parts.every((s) => s !== "" && s !== "." && s !== "..") ? parts.join("/") : undefined;
}

function settingProblem(key: string, spec: unknown): string | undefined {
  const where = `settings.${key}`;
  if (!isRecord(spec)) return `${where} must be an object`;
  if (!isText(spec.label, 80)) return `${where}.label must be 1-80 characters`;
  if (spec.description !== undefined && (typeof spec.description !== "string" || spec.description.length > 300)) return `${where}.description must be up to 300 characters`;
  if (spec.scope !== "browser" && spec.scope !== "server") return `${where}.scope must be browser or server`;
  const d = spec.default;
  switch (spec.type) {
    case "boolean":
      return d === undefined || typeof d === "boolean" ? undefined : `${where}.default must be true or false`;
    case "number":
      for (const k of ["default", "min", "max", "step"] as const) {
        if (spec[k] !== undefined && (typeof spec[k] !== "number" || !Number.isFinite(spec[k]))) return `${where}.${k} must be a number`;
      }
      return undefined;
    case "string":
      if (spec.maxLength !== undefined && (!Number.isInteger(spec.maxLength) || (spec.maxLength as number) < 1)) return `${where}.maxLength must be an integer of 1 or more`;
      return d === undefined || typeof d === "string" ? undefined : `${where}.default must be a string`;
    case "select": {
      const options = spec.options;
      if (!Array.isArray(options) || options.length === 0) return `${where}.options must list the choices`;
      if (!options.every((o) => isRecord(o) && typeof o.value === "string" && isText(o.label, 80))) return `${where}.options must each have a value and a label of 1-80 characters`;
      if (d !== undefined && !options.some((o) => (o as { value: string }).value === d)) return `${where}.default must be one of the options`;
      return undefined;
    }
    default:
      return `${where}.type must be boolean, number, string or select`;
  }
}

function themeProblem(theme: unknown): string | undefined {
  if (!isRecord(theme) || Object.keys(theme).length === 0) return "theme must give one name and value or more";
  for (const [key, value] of Object.entries(theme)) {
    if (!Object.hasOwn(THEME_NAMES, key)) return `theme has no name ${key.slice(0, 40)}`;
    // One CSS value: it cannot end the declaration, or the rule, it is put in.
    if (!isText(value, THEME_VALUE_MAX) || /[;{}]/.test(value)) return `theme.${key} must be a value of up to ${THEME_VALUE_MAX} characters without ; { }`;
  }
  return undefined;
}

export interface ManifestOptions {
  /** The name of its folder, which must be its id. */
  folder?: string;
  /** The genres of genres.json: then it must name one of them. Without it, a genre need only be of the form of an id. */
  genres?: string[];
  /** Its files, relative to its folder (those of dist/): then the files it names must be among them. */
  files?: ReadonlySet<string>;
}

/** What is wrong with a plugin's gasho-plugin.json (nothing when the Gasho server would take it). */
export function checkManifest(raw: unknown, o: ManifestOptions = {}): string[] {
  if (!isRecord(raw)) return ["it is not a JSON object"];
  const problems: string[] = [];
  const { id, name, version, description, genre, api, web, daemon, methods, permissions, settings, theme } = raw;
  if (typeof id !== "string" || !ID_RE.test(id)) problems.push("id must be 2-32 of a-z, 0-9 and -, starting with a letter");
  else if (o.folder !== undefined && id !== o.folder) problems.push(`its id (${id}) is not the folder's name`);
  if (!isText(name, 40)) problems.push("name must be 1-40 characters");
  if (typeof version !== "string" || !VERSION_RE.test(version)) problems.push(`version ${String(version)} is not like 1.2.0`);
  if (description !== undefined && (typeof description !== "string" || description.length > 300)) problems.push("description must be up to 300 characters");
  if (o.genres) {
    if (genre === undefined) problems.push(`it names no genre: give "genre", one of genres.json (${o.genres.join(", ")})`);
    else if (typeof genre !== "string" || !o.genres.includes(genre)) problems.push(`genre ${JSON.stringify(genre)} is not in genres.json (${o.genres.join(", ")})`);
  } else if (genre !== undefined && (typeof genre !== "string" || !ID_RE.test(genre))) {
    problems.push("genre must be 2-32 of a-z, 0-9 and -, starting with a letter");
  }
  // Which minor version of the plugin API is the newest is up to the Gasho server: it says when it is older.
  const a = typeof api === "string" ? API_RE.exec(api) : null;
  if (!a) problems.push(`api ${JSON.stringify(api)} is not like 1.0`);
  else if (Number(a[1]) !== API_MAJOR) problems.push(`api ${String(api)} is not of the plugin API ${API_MAJOR}`);

  const file = (v: unknown, what: string) => {
    const rel = safeRelative(v);
    if (!rel) problems.push(`${what} must name a file inside the plugin's folder`);
    else if (o.files && !o.files.has(rel)) problems.push(`${what} names ${rel}, which is not there: run npm run build first`);
  };
  for (const [part, value] of [["web", web], ["daemon", daemon]] as const) {
    if (value === undefined) continue;
    if (!isRecord(value)) {
      problems.push(`${part} must be an object with js`);
      continue;
    }
    file(value.js, `${part}.js`);
    if (part === "web" && value.css !== undefined) file(value.css, "web.css");
  }
  if (theme !== undefined) {
    if (a && Number(a[2]) < THEME_API_MINOR) problems.push(`theme needs api 1.${THEME_API_MINOR} or later`);
    const wrong = themeProblem(theme);
    if (wrong) problems.push(wrong);
  }
  if (web === undefined && daemon === undefined && theme === undefined) problems.push("give web, daemon or theme (or several)");
  if (methods !== undefined) {
    if (!isRecord(methods)) problems.push("methods must be an object");
    else {
      for (const [key, spec] of Object.entries(methods)) {
        if (!KEY_RE.test(key)) problems.push(`methods has a name that is not right (${key.slice(0, 40)})`);
        else if (!isRecord(spec) || (spec.kind !== "read" && spec.kind !== "write")) problems.push(`methods.${key}.kind must be read or write`);
        else {
          const t = spec.timeoutSeconds;
          if (t !== undefined && (typeof t !== "number" || !Number.isFinite(t) || t <= 0 || t > MAX_TIMEOUT_SECONDS)) {
            problems.push(`methods.${key}.timeoutSeconds must be a number of seconds up to ${MAX_TIMEOUT_SECONDS}`);
          }
        }
      }
      if (Object.keys(methods).length > 0 && daemon === undefined) problems.push("methods needs daemon");
    }
  }
  if (permissions !== undefined && (!Array.isArray(permissions) || !permissions.every((p) => typeof p === "string" && Object.hasOwn(PERMISSIONS, p)))) {
    problems.push(`permissions can name only ${Object.keys(PERMISSIONS).join(", ")}`);
  }
  if (settings !== undefined) {
    if (!isRecord(settings)) problems.push("settings must be an object");
    else {
      for (const [key, spec] of Object.entries(settings)) {
        const wrong = KEY_RE.test(key) ? settingProblem(key, spec) : `settings has a name that is not right (${key.slice(0, 40)})`;
        if (wrong) problems.push(wrong);
      }
    }
  }
  return problems;
}
