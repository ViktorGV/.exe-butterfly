# audio

Owned by #13. See the issue for scope, and `docs/CONTRACTS.md` for the interfaces this folder must keep.

All sound is synthesised with Web Audio at runtime: no files.

```ts
const audio = createAudio(); // first touch/click/key anywhere unlocks; unlock() is also safe to call
audio.play('jump', { pos, volume }); // pos: only within HEAR_RADIUS_M (15 m) of setListener
audio.setMusic(theme.music); // cross-fades; null stops
audio.setVolumes({ master, sfx, music }); // persisted in localStorage
audio.setListener(pos, yaw);
audio.setCrowdDensity(0..1);
audio.setAmbience('rain' | 'wind' | 'bubbles' | 'embers' | null);
```

- `voices.ts`: cap of 16 voices, per-sound rate limit and per-name cap, oldest-quietest stolen first.
- `pattern.ts`: deterministic loop generator (bass, chords, lead, percussion); `energy` adds layers, `swing` delays off-beats.
- `patches.ts` / `instruments.ts`: sound-effect and instrument patches as data.
- Envelopes always ramp from/to near-zero (no clicks); finished nodes disconnect on `ended`.
- Suspends while the tab is hidden; stingers (`countdown`, `go`, `finish`, `qualified`) duck the music.
