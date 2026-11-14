// What the usage plugin's daemon part reads with Claude Code's get_usage, and its web part shows (README.md).
import type { UsageWindow } from "@gasho/plugin-sdk";

export type { UsageWindow };

/** A weekly limit of one model (Fable, …), named as Claude.ai names it. */
export interface ModelWindow extends UsageWindow {
  name: string;
}

/**
 * The Claude.ai plan's usage limits, as get_usage read them on a working server. They are the account's: the same for
 * every session that uses the working server's Claude Code login.
 */
export interface UsageLimits {
  /** When they were read (ms since the epoch, the working server's clock). */
  at: number;
  /** false: the working server's Claude Code does not use a Claude.ai plan (an API key and the like), so it has none. */
  available: boolean;
  /** The 5-hour limit; some plans have none. */
  fiveHour?: UsageWindow;
  /** The weekly limit, all models together. */
  sevenDay?: UsageWindow;
  /** The weekly limits of single models. */
  models: ModelWindow[];
}
