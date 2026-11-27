# crowd

Owned by #9. Draws every remote player. See `docs/CONTRACTS.md` §8 for the interface.

```ts
import { createCrowd } from '../crowd/index.ts';

const crowd = createCrowd({ scene, max: 299 }); // wobblerFactory defaults to createWobbler
crowd.setPlayers(roster); // [{ id, name, skin? }]; ids not in the list are removed
crowd.setSkin(id, skin); // late skins swap in place (default look until then)
engine.onRender((_a, dt) => crowd.update(net.sampleRemote(), camera.position, dt));
```

## Tiers

- **Near** (`nearMax`, default 6): the closest players get a pooled full-detail Wobbler from `wobblerFactory`.
  Already-near players get a 0.75 multiplier on squared distance (hysteresis, about 13% in distance), so nobody
  flickers at the boundary. At most `maxPromotePerFrame` (default 3) Wobblers are built per frame, closest first, so
  20 players crossing at once are spread over a few frames instead of hitching.
- **Far** (everyone else): one `InstancedMesh` of `getLodGeometry()` with per-instance primary/belly/limb colours.
  The pose (idle bob, run tilt and sway, jump stretch, fall wobble, dive and prone lean, stumble, celebrate hop) runs
  in the vertex shader from per-instance `anim`, `phase` and `speed`; JS only writes a matrix and 12 floats.
- **Blob shadows**: one instanced quad layer for every visible player.
- **Name tags**: pooled sprites for the nearest `nameTags` (default 6) near players; disabled without a DOM.

Players missing from the `remoteStates` map are hidden. Speed comes from the position delta, smoothed.

## Budget

Draw calls for 300 players: near 6 × 3 + far 1 + shadows 1 + tags 6 = 26 (≤ 30). Raise `nearMax` on desktop if
the budget allows. `update` allocates nothing; Wobblers are only built or disposed when a player changes tier or
skin.

## Not done here

The butterfly circling marked players (#84) needs a "marked" flag that `WIRE` does not have yet.

## Files

- `crowd.ts`: `createCrowd`
- `tiers.ts`: allocation-free tier assignment (quickselect + hysteresis + promotion cap)
- `pool.ts`: id to slot pool
- `farMaterial.ts`: far-tier shader and blob-shadow material
