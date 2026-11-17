// Stylesheets imported for their effect: the build writes them into web.css.
declare module "*.css";

// Vite's import.meta.glob, as src/daemon/board-plugins.ts uses it (the build turns it into the files' text).
interface ImportMeta {
  glob<T>(pattern: string | string[], options: { eager: true; query?: string; import?: string }): Record<string, T>;
}
