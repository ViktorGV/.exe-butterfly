# character

Owned by #8. The **Wobbler**: the original player character, built entirely from code. Its whole look comes from a
`SkinDef` (`docs/CONTRACTS.md` §5) and it is animated procedurally, without a skeleton.

## Usage

```ts
import { createWobbler, getLodGeometry, skinToInstance } from '../character/index.ts';

const w = createWobbler(skin); // never throws: invalid or missing skin fields fall back to defaults
scene.add(w.object3d);
engine.onRender((_alpha, frameDt) => {
  // pos = feet (capsule bottom centre), yaw 0 faces -Z, anim = an Anim value, speed = horizontal m/s
  w.setPose({ pos: state.pos, yaw: state.yaw, anim: state.anim, speed }, frameDt);
});
w.dispose(); // removes it from its parent and releases shared resources (reference-counted, idempotent)
```

For the crowd renderer (#9):

- `getLodGeometry()`: one shared low-detail Wobbler (278 triangles, budget 300) in rest pose, feet at the origin,
  facing -Z. Instead of colours it has a float `part` attribute (`LOD_PART`: 0 primary, 1 belly, 2 limbs, 3 ink for
  the eyes). Do not dispose it.
- `skinToInstance(skin, out?)`: `{ primary, belly, limbs }` as `THREE.Color`s. Pass `out` to reuse them.

Tests and workers without a DOM can call `setPatternCanvasFactory(fn)` to supply the pattern canvas. When no canvas
is available the body falls back to its flat colour.

## Look

A jelly-drop body (a wide, round bottom that sits low and a top that narrows to a soft point; not a bean) with a belly patch, a sticker-style face (5 eye styles: `dot`,
`oval`, `sleepy`, `star`, `wide`; 5 mouths: `smile`, `o`, `flat`, `grin`, `none`; optional cheeks), thin noodle arms and
short, wide feet. At `height = girth = 1` it is 1.12 m tall with a 0.39 m body radius, so even at the cosmetic maximum
(1.15) it fits the 0.45 m x 1.3 m player capsule. `height` and `girth` only scale the visuals.

Accessories: up to 3, 24 prims in total, attached at `ANCHOR_POS` (`headTop`, `face`, `back`, `waist`). Prims are
**unit-sized**: at scale 1 each fits the cube [-0.5, 0.5]³ (sphere and cylinder diameter 1, cone base diameter 1 and
height 1, torus outer diameter 1, capsule 0.5 wide and 1 tall), so `scale` is the size in metres and `pos` is the
offset of the prim's centre from the anchor. Torus rings lie in the XY plane. Prims with `emissive` are drawn unlit.

## Budgets (phone first)

| What                     | Budget  | Measured                                 |
| ------------------------ | ------- | ---------------------------------------- |
| Triangles, full detail   | ≤ 2,500 | 1,324 (fixture), 2,356 (worst case)      |
| Draw calls               | ≤ 4     | 3, or 4 when the skin has emissive prims |
| LOD triangles            | ≤ 300   | 278                                      |
| Pattern texture          | ≤ 256px | 128 × 128 `CanvasTexture`                |
| 24 different skins built | < 50 ms | ~15 ms after warm-up (Bun, no WebGL)     |

Draw calls: body (pattern texture), details (belly, face and lit accessory prims merged, vertex colours), limbs (one
`InstancedMesh` of 4) and, only if needed, glowing prims. Accessory prims drop to coarser detail levels when a skin
would otherwise exceed the triangle budget.

Sharing: the body and limb meshes are shared by every Wobbler. The body material and pattern texture, the limb
material, and the face and accessory geometry are cached per distinct skin fields and freed when the last Wobbler
using them is disposed. Only the scene-graph nodes and the 4 limb matrices are per Wobbler.

## Animation

Pose channels (squash and stretch around the feet, lift, pitch, roll, twist, swing and raise per limb) are evaluated
per `Anim` state and cross-faded over 150 ms: idle bob, a waddling run that scales with `speed`, jump stretch, fall
flail, horizontal dive, prone (face down on the ground), stumble wobble and celebrate hop. The visual yaw eases toward
the target the short way round. `setPose` allocates nothing.

## Files

- `skin.ts`: `normalizeSkin` (defaults and clamping) and cache keys
- `shape.ts`: proportions, anchors, limb rig
- `geometry.ts`: mesh builder, prim templates, decals wrapped onto the body
- `parts.ts`: face, belly, accessories, limb transforms, LOD mesh
- `cache.ts`: shared and reference-counted resources, pattern texture
- `animation.ts`: pose channels and blending
- `wobbler.ts`: `createWobbler`
