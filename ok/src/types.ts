/** What the daemon part's predict answers. */
export interface Prediction {
  /** The prompts, the likeliest first. Empty when nothing came. */
  prompts: string[];
}
