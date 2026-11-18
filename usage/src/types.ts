// What the usage plugin's daemon part reads with Claude Code's get_usage, and its web part shows (README.md).

/**
 * A usage limit: the share of it used (0-100), and when it starts again (ms since the epoch). Claude.ai gives some
 * without a time (a window nothing has been used in yet), and /usage then shows the share alone.
 */
export interface LimitWindow {
  percent: number;
  resetsAt?: number;
}

/** A weekly limit of one model (Fable, …), named as Claude.ai names it. */
export interface ModelWindow extends LimitWindow {
  name: string;
}

/**
 * The Claude.ai plan's usage limits, as get_usage read them on a working server. They are the account's: the same for
 * every session that uses the working server's Claude Code login.
 */
export interface UsageLimits {
  /** When they were read (ms since the epoch, the working server's clock). */
  at: number;
  /**
   * false: get_usage cannot read them with the working server's Claude Code login: it does not use a Claude.ai plan
   * (an API key and the like), or its token may not read the account's usage (claude setup-token).
   */
  available: boolean;
  /** The 5-hour limit; some plans have none. */
  fiveHour?: LimitWindow;
  /** The weekly limit, all models together. */
  sevenDay?: LimitWindow;
  /** The weekly limit of the Sonnet models ("Current week (Sonnet only)" of /usage), on the plans /usage shows it for. */
  sevenDaySonnet?: LimitWindow;
  /** The weekly limits of single models. */
  models: ModelWindow[];
}
