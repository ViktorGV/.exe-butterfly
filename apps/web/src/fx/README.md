# fx

Owned by #29 (game feel: effects). See the issue for scope, and `docs/CONTRACTS.md` for the interfaces this folder must keep.

- `fx.ts`: `createFx({ scene })` draws every particle effect in one pooled `THREE.Points` (one draw call, `FX.maxParticles` cap, round-robin recycle when full, allocation-free spawn/update). Effects: `dust` (run/jump/land), `ring` (bumper), `stars` (sweeper hit/stumble), `sparkle` (checkpoint sparkle + flag pop), `poof` (respawn), `confetti` (finish), `speedLines` (dive), `shake` (light camera shake, off under prefers-reduced-motion). `watchRemote` gives remote players a reduced subset (land dust, respawn poof) within `FX.remoteNear` of the camera. Colors come from a v2 theme's `fx` via `setColors`.
- Squash/stretch is not done: the Wobbler pose has no scale hook.
