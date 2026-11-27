# course

Owned by #7. Turns any `CourseDef` into a rendered, collidable course, driven only by the obstacle registry
(`getObstacleKind(kind).parts(def)` / `.pose(def, t, out)`), so new kinds work without changes here.
Interfaces: `docs/CONTRACTS.md` §4 and §8.

```ts
import { createCourseRuntime } from '../course/index.ts';

const theme = applyTheme(themeDef, { scene });
const course = createCourseRuntime({ courseDef, theme, scene });
const player = createPlayerController({ getColliders: course.getColliders, course: courseDef });

engine.onFixedUpdate((dt, t) => {
  course.stepColliders(t); // simulation clock: poses for t, prevPose = the previous call's pose
  player.step(input.sample(), camera.yaw, dt, t);
});
engine.onRender(() => course.update(renderTime)); // render clock: visuals only

player.respawn(course.spawnPoint(slot));
player.on('fell', () => player.respawn(course.respawnPoint(player.state.checkpoint, slot)));

course.dispose(); // removes every mesh; a new course can be created right after
```

- `getColliders()`: one `Collider` per part with `collide: true`, in entity then part order. The array and its
  `pose` / `prevPose` objects are created once and updated in place. The first `stepColliders` call sets
  `prevPose = pose` (no motion); static entities are posed once and never touched again.
- `spawnPoint(slot)` / `respawnPoint(checkpoint, slot)`: row-major grid maths from `SpawnGrid` (`spawn.ts`).
  `checkpoint` is `PlayerState.checkpoint` (-1 = none yet, uses the start grid; past the end uses the last one).
  Both take an optional `out` to avoid allocating.
- `getAnchors()`: start, checkpoint and finish poses for signage.
- `root`: the `THREE.Group` holding every course mesh.

## Rendering (phone first)

- Static visible parts are merged into one mesh per material slot (`theme.getMaterial(slot)`).
- Moving visible parts are drawn with one `InstancedMesh` per (shape, slot); its bounding sphere is the parts'
  bounds swept over a full motion cycle, so frustum culling stays correct.
- Checkpoint arches with flag rows, the finish banner and the checkered finish strip are plain primitives merged
  with the static meshes. They are visual only; the trigger volumes in the def decide checkpoints and finish.
- Meshes cast and receive shadows (`shadows: false` turns it off); they only cost anything when
  `renderer.shadowMap.enabled`.
- A 400-entity course is about 12 draw calls; `update` + `stepColliders` take well under 0.5 ms (see tests).

Unknown kinds (or kinds that throw) are skipped with a `console.warn`, never a crash.

Not done yet: theme dressing (`theme.getDressing`, #54) and side-banner anchors, which need the theme seam to
grow first; a debug wireframe view of volumes and colliders.
