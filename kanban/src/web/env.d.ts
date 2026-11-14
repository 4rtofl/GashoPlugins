// Stylesheets imported for their effect: the build writes them into web.css.
declare module "*.css";

// Vite's import.meta.glob, as src/web/board-plugins.ts uses it (the build turns it into imports).
interface ImportMeta {
  glob<T>(pattern: string, options: { eager: true }): Record<string, T>;
}
