# camera

Owned by #6. See the issue for scope, and `docs/CONTRACTS.md` §8 for the interface this folder must keep:

```ts
createFollowCamera(camera) -> { update(targetPos, targetVel, dt), yaw, snapTo(pos, yaw), follow(provider), playIntro(points, ms) }
```

## Usage

```ts
import { createFollowCamera } from './camera/index.ts';

const cam = createFollowCamera(engine.camera); // drag-to-orbit listens on window by default

engine.onFixedUpdate((dt, t) => player.step(input.sample(), cam.yaw, dt, t));
engine.onRender((alpha, frameDt) => {
  cam.update(interpolatedPos, player.state.vel, frameDt); // interpolated position, every render frame
});

player.on('fell', () => {
  const point = course.respawnPoint(player.state.checkpoint, slot);
  player.respawn(point);
  cam.snapTo(point.pos, point.yaw);
});
player.on('dive', () => cam.kick('dive'));
player.on('land', () => cam.kick('land', 0.7));

cam.snapTo(spawn.pos, spawn.yaw);
await cam.playIntro(flyoverPoints, 3000); // during the countdown; ends exactly at the follow pose
cam.follow(net.sampleRemote().get(leaderId)!); // spectate after finishing; follow(null) returns
```

- `yaw` follows the shared convention: yaw 0 faces −Z, positive yaw turns left; forward is `(-sin yaw, 0, -cos yaw)`. Pass it straight to `player.step`.
- `update` runs in the render callback (it is frame-rate independent: the same motion at 30, 60 or 144 Hz). It does not allocate.
- `snapTo(pos, yaw)` cuts with no swoosh (respawn, spawn). Call it before `playIntro` so the intro lands on the spawn pose.
- `follow(provider)` spectates anything with a live `pos` (and optional `vel`), such as a `RemoteState`, or a function `(out) => boolean` that returns false while the target is missing. The hand-over eases over `handoverSec`. While spectating, `update`'s arguments are ignored.
- `playIntro(points, ms)` flies a Catmull-Rom path through `points` (camera positions) whose last point is the live follow pose, eased in and out; it resolves when done or on `cancelIntro()` / a new intro.
- `orbit(dYaw, dPitch)` and `setLookAxis(x, y)` (right stick: x right turns right, y up looks up) are the manual inputs. Pitch is clamped to `pitchMin..pitchMax`.
- `kick('dive')` (small FOV kick) and `kick('land', strength)` (view dip) do nothing under `prefers-reduced-motion` (or `reducedMotion: true`).
- `dispose()` removes the pointer listeners.

## Phone first

- **Orbit**: one-finger drag that starts on the right half of the screen. The left half is the joystick (`.wr-touch-zone`, #4) and drags starting on `.wr-touch-btn`, any button / link / input or `[data-no-orbit]` are ignored. Mouse drag (left or right button) works anywhere on desktop. Only the first finger orbits, so you can steer, orbit and jump at once. Set `orbitTarget` (default `window`, `null` for none) and `orbit: { touchSensitivity, mouseSensitivity, touchMinX, isBlocked }` to tune it.
- **Auto-rotate**: when nobody is orbiting, the camera turns gently toward the direction of travel (faster at higher speed, never spinning round when the player runs back toward it). After a manual orbit it waits `manualHoldSec`, then fades back in; pitch also drifts back to the default.
- **Portrait and landscape**: framing comes from `camera.aspect` every frame (`framing.ts`). In portrait the vertical FOV widens to keep a minimum horizontal FOV (capped), the camera pulls back and rises, and it aims further ahead, so obstacles in front stay visible. Rotating the phone eases into the new framing.

## Files

| File               | What                                                                               |
| ------------------ | ---------------------------------------------------------------------------------- |
| `followCamera.ts`  | The rig: spring follow, look-ahead, auto-rotate, snap, spectate, intro, kicks.     |
| `orbitControls.ts` | Thin pointer wiring for drag-to-orbit (takes any `EventTarget`).                   |
| `framing.ts`       | Pure aspect-aware FOV / distance / pitch.                                          |
| `math.ts`          | Pure exact integrators: critically damped spring, exponential damping, angle wrap. |
| `path.ts`          | Pure Catmull-Rom sampling for the intro.                                           |

Out of scope: camera collision (courses are open-air), screen shake (game-feel issue).
