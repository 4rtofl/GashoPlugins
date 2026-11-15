// GitHub Packages of a repository, and one package's versions. GraphQL's repository.packages leaves out npm packages,
// so the owner's packages are read with REST, one kind at a time (/orgs/{org}/packages, /user/packages for gh's own
// login, /users/{user}/packages for another user), and those whose repository is the session's are kept. gh's login
// needs read:packages; without it, the answer says how to add it.
import type { Package, PackageDetail, Packages, PackageType, PackageVersion } from "../types.ts";
import { arr, githubUrl, missingScope, num, parseJson, rec, str, type Gh } from "./gh.ts";

export const PACKAGE_TYPES: readonly PackageType[] = ["npm", "container", "maven", "rubygems", "nuget", "docker"];
const VERSIONS_MAX = 100;

export const packageTypeArg = (v: unknown): PackageType | undefined => (PACKAGE_TYPES as readonly unknown[]).includes(v) ? (v as PackageType) : undefined;

/** A package's name as GitHub allows it: no "..", nothing gh would take as a flag. */
export const packageNameArg = (v: unknown): string | undefined =>
  typeof v === "string" && /^[A-Za-z0-9_.@][A-Za-z0-9_.@/-]{0,199}$/.test(v) && !v.includes("..") ? v : undefined;

/** The REST path of an owner's packages: an organization's, gh's own login's, or another user's. */
export function packagesBase(owner: string, kind: "org" | "me" | "user"): string {
  return kind === "org" ? `orgs/${owner}/packages` : kind === "me" ? "user/packages" : `users/${owner}/packages`;
}

/** A package of `/…/packages` output, if it is the repository's (`repo`: owner/name, any case). */
export function parsePackage(raw: unknown, repo?: string): Package | undefined {
  const p = rec(raw);
  const type = packageTypeArg(p.package_type);
  const name = str(p.name);
  const url = githubUrl(p.html_url);
  if (!type || !name || !url) return undefined;
  if (repo !== undefined && str(rec(p.repository).full_name)?.toLowerCase() !== repo.toLowerCase()) return undefined;
  return {
    type,
    name,
    visibility: str(p.visibility) ?? "",
    ...(num(p.version_count) !== undefined ? { versions: num(p.version_count) } : {}),
    ...(str(p.created_at) ? { createdAt: str(p.created_at) } : {}),
    ...(str(p.updated_at) ? { updatedAt: str(p.updated_at) } : {}),
    url,
  };
}

/** `/…/packages?package_type=…` output: the packages of `repo`. */
export function parsePackages(json: string, repo: string): Package[] {
  return arr(parseJson(json)).flatMap((p) => {
    const pkg = parsePackage(p, repo);
    return pkg ? [pkg] : [];
  });
}

/** `/…/packages/{type}/{name}/versions` output, newest first. */
export function parseVersions(json: string): PackageVersion[] {
  return arr(parseJson(json))
    .flatMap((raw): PackageVersion[] => {
      const v = rec(raw);
      const id = num(v.id);
      const name = str(v.name);
      if (!id || !name) return [];
      const tags = arr(rec(rec(v.metadata).container).tags).filter((t): t is string => typeof t === "string" && t !== "");
      return [
        {
          id,
          name,
          ...(rec(rec(v.metadata).container).tags !== undefined ? { tags } : {}),
          ...(str(v.created_at) ? { createdAt: str(v.created_at) } : {}),
          ...(githubUrl(v.html_url) ? { url: githubUrl(v.html_url) } : {}),
        },
      ];
    })
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/** How to install `version` of `pkg` (of `owner`, in `repo`'s name `repoName`); undefined when the name does not tell. */
export function installCommand(pkg: Pick<Package, "type" | "name">, owner: string, repoName: string, version?: PackageVersion): string | undefined {
  const o = owner.toLowerCase();
  switch (pkg.type) {
    case "npm":
      return `npm install @${o}/${pkg.name}${version ? `@${version.name}` : ""} --registry=https://npm.pkg.github.com`;
    case "container": {
      const tag = version?.tags?.[0];
      const ref = tag ? `:${tag}` : version?.name.startsWith("sha256:") ? `@${version.name}` : "";
      return `docker pull ghcr.io/${o}/${pkg.name.toLowerCase()}${ref}`;
    }
    case "rubygems":
      return `gem install ${pkg.name}${version ? ` --version ${version.name}` : ""} --source https://rubygems.pkg.github.com/${o}`;
    case "nuget":
      return `dotnet add package ${pkg.name}${version ? ` --version ${version.name}` : ""} --source https://nuget.pkg.github.com/${o}/index.json`;
    case "docker":
      return `docker pull docker.pkg.github.com/${o}/${repoName.toLowerCase()}/${pkg.name}${version ? `:${version.name}` : ""}`;
    default:
      // Maven names a package by group and artifact, which its name does not split into.
      return undefined;
  }
}

/** Whose packages these are: an organization, gh's own login, or another user. Both answers change rarely. */
async function ownerKind(ctx: Gh, owner: string, repo: string): Promise<"org" | "me" | "user"> {
  const o = { repo, maxAgeSeconds: 600, timeoutMs: 20_000 };
  const [who, me] = await Promise.all([ctx.github.read(["api", `users/${owner}`], o), ctx.github.read(["api", "user"], o)]);
  if (rec(parseJson(who.stdout)).type === "Organization") return "org";
  return str(rec(parseJson(me.stdout)).login)?.toLowerCase() === owner.toLowerCase() ? "me" : "user";
}

/** The packages of `repo` (owner/name), newest change first. */
export async function listPackages(ctx: Gh, repo: string, o: { maxAgeSeconds: number }): Promise<Omit<Packages, "repo">> {
  const [owner = ""] = repo.split("/");
  const base = packagesBase(owner, await ownerKind(ctx, owner, repo));
  const errors: string[] = [];
  let missing: Packages["missing"];
  const lists = await Promise.all(
    PACKAGE_TYPES.map(async (type) => {
      try {
        const { stdout } = await ctx.github.read(["api", `${base}?package_type=${type}&per_page=100`], { repo, maxAgeSeconds: o.maxAgeSeconds, timeoutMs: 25_000 });
        return parsePackages(stdout, repo);
      } catch (e) {
        const scope = missingScope(e);
        if (scope) missing = scope;
        else errors.push(type);
        return [];
      }
    }),
  );
  const packages = lists.flat().sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return { packages, ...(missing ? { missing } : {}), ...(errors.length ? { errors } : {}) };
}

/** Package `type`/`name` of `repo`'s owner with its versions; undefined when it is not there or not the repository's. */
export async function readPackage(ctx: Gh, repo: string, type: PackageType, name: string, o: { maxAgeSeconds: number }): Promise<Omit<PackageDetail, "repo"> | undefined> {
  const [owner = "", repoName = ""] = repo.split("/");
  const path = `${packagesBase(owner, await ownerKind(ctx, owner, repo))}/${type}/${encodeURIComponent(name)}`;
  const read = { repo, maxAgeSeconds: o.maxAgeSeconds, timeoutMs: 25_000 };
  const [info, versions] = await Promise.all([
    ctx.github.read(["api", path], read),
    ctx.github.read(["api", `${path}/versions?per_page=${VERSIONS_MAX}`], { ...read, maxBuffer: 16 * 1024 * 1024 }),
  ]);
  const pkg = parsePackage(parseJson(info.stdout), repo);
  if (!pkg) return undefined;
  const list = parseVersions(versions.stdout);
  const install = installCommand(pkg, owner, repoName, list[0]);
  return { package: pkg, versions: list, truncated: list.length >= VERSIONS_MAX, ...(install ? { install } : {}) };
}
