// Bakes the racers' body meshes (racers/baked.ts) so browsers don't sculpt them. Build: every racer at the game's
// grid sizes is emitted gzipped as a hashed asset, plus /racers.json mapping `id@step` to its URL. Dev: the same
// files are served from memory, baked on first request.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';
import { RACERS, buildRacer } from '../src/racers/index.ts';
import { NEAR_STEP, PLAY_STEP } from '../src/racers/play.ts';
import { bakedKey, encodeRacerGeometry } from '../src/racers/baked.ts';

interface Baked {
  key: string;
  name: string;
  bytes: Uint8Array;
}

function bakeAll(): Baked[] {
  const out: Baked[] = [];
  for (const step of [PLAY_STEP, NEAR_STEP])
    for (const def of RACERS) {
      const r = buildRacer(def, step);
      const bytes = gzipSync(encodeRacerGeometry(r.mesh.geometry), { level: 9 });
      out.push({ key: bakedKey(def.id, step), name: `racer-${def.id}-${step}.bin`, bytes });
    }
  return out;
}

export function racersPlugin(): Plugin {
  let cache: Baked[] | null = null;
  const baked = () => (cache ??= bakeAll());
  return {
    name: 'wobble-racers-bake',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (url === '/racers.json') {
          const map = Object.fromEntries(baked().map((b) => [b.key, `/racers/${b.name}`]));
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(JSON.stringify(map));
          return;
        }
        const hit = url.startsWith('/racers/') ? baked().find((b) => `/racers/${b.name}` === url) : undefined;
        if (!hit) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(Buffer.from(hit.bytes));
      });
    },
    generateBundle() {
      const map: Record<string, string> = {};
      for (const b of baked()) {
        const hash = createHash('sha256').update(b.bytes).digest('hex').slice(0, 10);
        const fileName = `assets/${b.name.replace(/\.bin$/, '')}-${hash}.bin`;
        this.emitFile({ type: 'asset', fileName, source: b.bytes });
        map[b.key] = `/${fileName}`;
      }
      this.emitFile({ type: 'asset', fileName: 'racers.json', source: JSON.stringify(map) });
    },
  };
}
