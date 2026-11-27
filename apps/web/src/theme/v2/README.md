# theme/v2

Owned by #64 (theme renderer v2). Interfaces: `docs/CONTRACTS.md` §9 (`ThemeDefV2`, `ThemeRuntime`).
Demo: `apps/web/demos/theme-v2.html`.

```ts
import { applyThemeV2, courseForTheme, createDressingLayer } from '../theme/v2/index.ts';

const theme = applyThemeV2(themeDef, { scene, renderer, course: courseForTheme(courseDef), baseUrl, quality });
const course = createCourseRuntime({ courseDef, theme, scene });
const dressing = createDressingLayer({ getDressing: theme.getDressing, courseDef }); // until #7 calls getDressing
scene.add(dressing.group);
engine.onRender((_a, dt) => {
  course.update(t);
  dressing.update(t); // same render time as course.update: no lag versus the colliders
  theme.update(dt, camera);
});
await theme.ready; // every image decoded or missing
theme.dispose(); // disposes every geometry, material and texture it made
```

| File           | What                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------- |
| `layout.ts`    | Pure: anchors from a `CourseDef` (incl. side banners), landmark/signage poses, scatter.   |
| `quality.ts`   | Pure: per-preset texture scale, particle and decor counts, anisotropy.                    |
| `coverage.ts`  | Pure: the `hideBase` rule (prims must cover ≥ 80% of the part's bounds).                  |
| `images.ts`    | `createImageBitmap` decode, `@0.5x` on low, resource tracking; < 8 px = placeholder.      |
| `materials.ts` | Slot materials, textures mapped in world space (triplanar), mipmaps, anisotropy.          |
| `sky.ts`       | Gradient dome; the panorama fades in above the horizon once decoded.                      |
| `ground.ts`    | One animated shader plane per `ground.kind`, below `killY`.                               |
| `particles.ts` | ≤ 2 `Points` systems wrapping around the camera in the vertex shader.                     |
| `decor.ts`     | Instanced prim decor and alpha-tested billboard sprites with sway, outside the bounds.    |
| `setPieces.ts` | Landmarks merged into one mesh; signage as one instanced quad per slot.                   |
| `dressing.ts`  | Cached `getDressing` templates and `createDressingLayer`, posed by the obstacle registry. |

Draw calls added: sky 1, ground 1, particles ≤ 2, landmarks 1, decor ≤ 8, signage ≤ 4, dressing 1 per template.

Not done here: `applyTheme` in `../index.ts` still points at the v1 stub (wiring waits for #10); the course
runtime (#7) does not yet call `getDressing` or hide base meshes (`createDressingLayer().hiddenBase` lists them).
