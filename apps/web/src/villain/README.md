# villain

Part of the butterfly effect (#84). The boss that appears near the finish once someone reaches the last
checkpoint and throws obstacles at **marked** players (the ones whose pushes made others fall). This folder is
only the picture: the boss, a red circle where each throw will land (shown for `BUTTERFLY.THROW_WARN_MS`),
and the obstacle flying in. The server decides who is a target and who is hit (`throw` / `hit` in
`docs/CONTRACTS.md` §6); a player who was not marked is never thrown at and never gets a `hit`.

```ts
import { createVillainView } from '../villain/index.ts';

const villain = createVillainView({ scene });
session.on('throw', (m) => {
  villain.setBoss(bossFeetPos);
  villain.throwAt(m, floorY, session.serverNow());
});
engine.onRender((_a, dt) => villain.update(session.serverNow(), dt));
villain.reset(); // race over or left the room
```

Pooled (`MAX_THROWS`): nothing is allocated per frame or per throw.
