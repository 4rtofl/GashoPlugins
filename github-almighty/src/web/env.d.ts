// Stylesheets imported for their effect: the build writes them into web.css.
declare module "*.css";

interface ImportMeta {
  /** Vite (gasho-plugin build) puts here every module whose path matches the pattern, by that path. */
  glob<T>(pattern: string, options: { eager: true }): Record<string, T>;
}
