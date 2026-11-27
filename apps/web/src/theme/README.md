# theme

Owned by #10 (theme renderer). See the issue for scope, and `docs/CONTRACTS.md` §5 / §8 for the interfaces this folder keeps.
ThemeDef v2 features (#64) go in `v2/` and plug in as extra feature builders.

## Usage

```ts
import { applyTheme } from '../theme/index.ts';

const theme = applyTheme(themeDef, { scene, renderer, bounds: courseDef.bounds });
mesh.material = theme.getMaterial('platformA'); // stable object for the runtime's whole life

// every frame (allocation-free)
theme.tick(raceTimeSec); // decor float/spin; without calls the wall clock drives it
theme.setShadowFocus(player.x, player.y, player.z); // sun shadow box follows the player

theme.update(otherThemeDef); // hot-swap in place: same material objects, old textures/decor disposed
theme.dispose(); // removes sky, fog, lights and decor; disposes everything it created
```

## What it builds

| Part      | File           | Notes                                                                                                                                                        |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fallbacks | `resolve.ts`   | `resolveTheme(x)` never throws; each missing or invalid field falls back to `DEFAULT_THEME` (the fixture theme), numbers are clamped.                        |
| Sky, fog  | `sky.ts`       | One 16×8 sphere with a gradient shader, drawn at the far plane around the camera. Fog and clear colour use `sky.horizon`; `fog.near/far` from the theme.     |
| Lights    | `lights.ts`    | Hemisphere (ambient over a lifted ground tint) + one shadow-casting sun. Shadow box ±24 m around the focus. Map size and type stay under the engine preset.  |
| Materials | `materials.ts` | One `MeshStandardMaterial` per slot. Patterns: `drawPattern` into a 128 px `CanvasTexture`, box-projected world UVs (one tile = 2 m × `pattern.scale`), rim. |
| Decor     | `decor.ts`     | Each kind's prims merge into one vertex-coloured geometry → one `InstancedMesh` (≤ 6 draw calls). Seeded scatter in a band ≥ 6 m outside `bounds`.           |

Patterns need a 2D canvas: `document` or `OffscreenCanvas` by default, or `canvasFactory` in the options. Without one (tests, workers) patterns are skipped and the slot colour is used.

Extra features: pass `features: [(theme, { scene, renderer, bounds }) => ({ update, tick?, dispose })]`.
