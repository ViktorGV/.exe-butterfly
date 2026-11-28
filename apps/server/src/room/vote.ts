// Lobby theme vote (#27): the host opens it, everyone may vote (and change their vote) until it closes,
// then the most-voted theme wins (first option on ties, the first option with no votes).
export interface ThemeVote {
  readonly options: readonly string[];
  readonly endsAt: number;
  /** Records a vote; false when the theme is not an option. */
  cast(playerId: number, themeId: string): boolean;
  drop(playerId: number): void;
  tallies(): number[];
  winner(): string;
}

export function createThemeVote(options: readonly string[], endsAt: number): ThemeVote {
  const choices = new Map<number, number>();
  const tallies = () => {
    const t = options.map(() => 0);
    for (const i of choices.values()) t[i]!++;
    return t;
  };
  return {
    options,
    endsAt,
    cast(playerId, themeId) {
      const i = options.indexOf(themeId);
      if (i < 0) return false;
      choices.set(playerId, i);
      return true;
    },
    drop: (playerId) => void choices.delete(playerId),
    tallies,
    winner() {
      const t = tallies();
      let best = 0;
      for (let i = 1; i < t.length; i++) if (t[i]! > t[best]!) best = i;
      return options[best]!;
    },
  };
}
