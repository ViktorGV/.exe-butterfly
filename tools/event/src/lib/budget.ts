// The --budget-usd guard. Owned by #56, shared with #59 and #63.

export class BudgetExceededError extends Error {
  constructor(
    readonly limitUsd: number,
    readonly spentUsd: number,
    readonly nextUsd: number,
  ) {
    super(
      `budget $${limitUsd.toFixed(2)} would be exceeded: spent or reserved $${spentUsd.toFixed(4)}, next call ~$${nextUsd.toFixed(4)}`,
    );
    this.name = 'BudgetExceededError';
  }
}

export interface BudgetGuard {
  readonly limitUsd: number;
  /**
   * Call before spending. Throws BudgetExceededError if real spend, plus calls still in flight, plus
   * `estimateUsd` would pass the limit. Call the returned function once with the real cost
   * (OpenRouter `usage.cost`, or 0 if the call failed).
   */
  reserve(estimateUsd: number): (costUsd: number) => void;
  /** Real spend so far. */
  spentUsd(): number;
}

/** Tracks spend across every AI call of a run. Cache hits cost nothing and never reach the guard. */
export function createBudgetGuard(limitUsd: number): BudgetGuard {
  let spent = 0;
  let reserved = 0;
  return {
    limitUsd,
    reserve(estimateUsd) {
      const committed = spent + reserved;
      if (committed + estimateUsd > limitUsd) throw new BudgetExceededError(limitUsd, committed, estimateUsd);
      reserved += estimateUsd;
      let open = true;
      return (costUsd) => {
        if (!open) return;
        open = false;
        reserved -= estimateUsd;
        spent += costUsd;
      };
    },
    spentUsd: () => spent,
  };
}
