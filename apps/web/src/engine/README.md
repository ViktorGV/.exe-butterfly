# engine

Owned by #3. The Three.js runtime every other client module plugs into.

```ts
import { createEngine } from '../engine/index.ts';

const engine = createEngine({ canvas });
engine.onFixedUpdate((dt, simTime) => {
  // exactly SIM_HZ (60) times per simulated second: input, physics, colliders
});
engine.onRender((alpha, frameDt) => {
  // once per displayed frame: interpolate visuals between the last two steps with alpha
});
engine.start();
```

- **Fixed step:** `SIM_HZ` steps per second from an accumulator, at most 5 catch-up steps per frame (extra time is dropped and counted). `simTime` is `stepCount / SIM_HZ`, so it never drifts. The loop itself (`loop.ts`) is DOM-free and reusable headless.
- **Order:** fixed updates run before render callbacks, each list in registration order. Both `onFixedUpdate` and `onRender` return an unsubscribe function.
- **Hidden tab:** rendering stops; fixed updates continue from a 10 Hz timer (up to 2 s of catch-up per tick), so networking stays alive.
- **Renderer:** WebGL2, sRGB output, ACES tone mapping, soft PCF shadows, DPR clamped by the quality setting, resize-aware, recovers from context loss.
- **Quality** (`quality.ts`): one setting for every device (`QUALITY`): DPR cap 1.5, shadows on with a 1024 shadow map, far plane 400 m, antialiasing on.
- **Debug overlay:** toggle with the backquote key. Shows fps, frame time p50/p95, draw calls, triangles, steps per frame and dropped steps. Add lines with `engine.addStat(name, getter)`.
- **`dispose()`** stops the loop, removes every listener and the overlay, and frees every geometry, material, texture and shadow map still in the scene.

Demo: `/demos/engine.html` (`bun run dev`).
