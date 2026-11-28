// How a push feels (#84), shared by online pushes and the offline bots. No imports, so bots stay light.

/** How a push feels (#84). Shared by online pushes and the offline bots. */
export const PUSH_FEEL = Object.freeze({
  /** sideways launch, m/s */
  speed: 10,
  /** upward launch, m/s: the target visibly flies before landing flat */
  hop: 5,
  /** time on the floor, ms, unless someone helps you up first */
  downMs: 4000,
  /** solo practice: bots never help you up, so a bot push keeps you down for less */
  soloDownMs: 2000,
});
