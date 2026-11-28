// Kill stats for the results screen: who knocked you out the most, and who knocked out the fewest racers.
// A "kill" is a gun hit (seen by everyone) or a push that knocked you down (seen only by you).

export interface KillStats {
  /** `by` knocked out `target`; `localId` is you. */
  record(by: number, target: number, localId: number | null | undefined): void;
  reset(): void;
  /** Titles for the results screen; `players` is everyone in the race, in results order. */
  titles(players: readonly { id: number; name: string }[]): { label: string; name: string }[];
}

export function createKillStats(): KillStats {
  const kills = new Map<number, number>(); // shooter -> knockouts
  const onMe = new Map<number, number>(); // attacker -> knockouts on the local player
  const bump = (m: Map<number, number>, id: number) => m.set(id, (m.get(id) ?? 0) + 1);
  return {
    record(by, target, me) {
      if (by === target) return;
      bump(kills, by);
      if (target === me) bump(onMe, by);
    },
    reset() {
      kills.clear();
      onMe.clear();
    },
    titles(players) {
      const out: { label: string; name: string }[] = [];
      const nameOf = (id: number) => players.find((p) => p.id === id)?.name ?? `Player ${id}`;
      let worst = -1;
      let worstN = 0;
      for (const [id, n] of onMe) if (n > worstN) [worst, worstN] = [id, n];
      if (worst >= 0) out.push({ label: 'Killed you the most', name: `${nameOf(worst)} (${worstN}×)` });
      if (players.length > 1) {
        let least = players[0]!;
        let leastN = Infinity;
        for (const p of players) {
          const n = kills.get(p.id) ?? 0;
          if (n < leastN) [least, leastN] = [p, n];
        }
        out.push({ label: 'Fewest kills', name: `${least.name} (${leastN})` });
      }
      return out;
    },
  };
}
