// Stylesheets imported for their effect: the build writes them into web.css.
declare module "*.css";

// Vite's import.meta.glob, as src/web/board-plugins.ts and src/daemon/board-plugins.ts use it (the build turns it into
// imports of the export `import`).
interface ImportMeta {
  glob<T>(pattern: string, options: { eager: true; import: string }): Record<string, T>;
}
