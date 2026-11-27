import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureSkinPack, fixtureThemePack } from '@wobble/shared/fixtures/index';
import type { Pack, PackStore } from '@wobble/shared/types';
import { createMemoryPackStore } from './index.ts';
import { createSqlitePackStore, openDatabase, REPORTS_TO_HIDE } from './sqlite.ts';

const dirs: string[] = [];
const tmpDb = () => {
  const dir = mkdtempSync(join(tmpdir(), 'wobble-'));
  dirs.push(dir);
  return join(dir, 'sub', 'wobble.db');
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const skin = (id: string, createdAt: string): Pack => ({ ...fixtureSkinPack, id, createdAt });

function contract(name: string, make: () => PackStore) {
  describe(`PackStore contract: ${name}`, () => {
    it('put/get round trip, unknown id is null', async () => {
      const s = make();
      await s.put(fixtureSkinPack);
      expect(await s.get(fixtureSkinPack.id)).toEqual(fixtureSkinPack);
      expect(await s.get('g:missing')).toBeNull();
    });

    it('lists newest first with a cursor, per kind', async () => {
      const s = make();
      for (let i = 0; i < 5; i++) await s.put(skin(`g:s${i}`, `2026-01-0${i + 1}T00:00:00Z`));
      await s.put(fixtureThemePack);
      const p1 = await s.list({ kind: 'skin', limit: 2 });
      expect(p1.items.map((p) => p.id)).toEqual(['g:s4', 'g:s3']);
      expect(p1.nextCursor).not.toBeNull();
      const p2 = await s.list({ kind: 'skin', limit: 2, cursor: p1.nextCursor });
      expect(p2.items.map((p) => p.id)).toEqual(['g:s2', 'g:s1']);
      const p3 = await s.list({ kind: 'skin', limit: 2, cursor: p2.nextCursor });
      expect(p3.items.map((p) => p.id)).toEqual(['g:s0']);
      expect(p3.nextCursor).toBeNull();
      expect((await s.list({ kind: 'theme' })).items).toHaveLength(1);
    });

    it('flag hides from listings but not from get', async () => {
      const s = make();
      await s.put(fixtureSkinPack);
      await s.flag(fixtureSkinPack.id);
      expect((await s.list({ kind: 'skin' })).items).toHaveLength(0);
      expect(await s.get(fixtureSkinPack.id)).not.toBeNull();
    });

    it('findByPromptHash is null when nothing is indexed', async () => {
      const s = make();
      await s.put(fixtureSkinPack);
      expect(await s.findByPromptHash('skin', 'nope')).toBeNull();
    });

    it('refuses invalid and oversized packs', async () => {
      const s = make();
      await expect(s.put({ ...fixtureSkinPack, kind: 'bogus' } as unknown as Pack)).rejects.toThrow();
      const big = { ...fixtureSkinPack, id: 'g:big', name: 'x'.repeat(9000) } as Pack;
      await expect(s.put(big)).rejects.toThrow();
      expect(await s.get('g:big')).toBeNull();
    });
  });
}

contract('MemoryPackStore', createMemoryPackStore);
contract('SqlitePackStore', () => createSqlitePackStore(openDatabase(tmpDb())));

describe('SqlitePackStore specifics', () => {
  it('survives closing and reopening the file', async () => {
    const path = tmpDb();
    const db = openDatabase(path);
    const s = createSqlitePackStore(db);
    await s.put(fixtureSkinPack);
    await s.indexPromptHash('skin', 'h1', fixtureSkinPack.id);
    await s.flag(fixtureThemePack.id);
    db.close();
    const s2 = createSqlitePackStore(openDatabase(path));
    expect(await s2.get(fixtureSkinPack.id)).toEqual(fixtureSkinPack);
    expect((await s2.findByPromptHash('skin', 'h1'))?.id).toBe(fixtureSkinPack.id);
    expect(await s2.findByPromptHash('theme', 'h1')).toBeNull();
  });

  it('packs are immutable once written', async () => {
    const s = createSqlitePackStore(openDatabase(':memory:'));
    await s.put(fixtureSkinPack);
    await s.put({ ...fixtureSkinPack, name: 'changed' });
    expect((await s.get(fixtureSkinPack.id))?.name).toBe(fixtureSkinPack.name);
  });

  it('hides a pack after 3 distinct clients report it; repeats do not count', async () => {
    const s = createSqlitePackStore(openDatabase(':memory:'));
    await s.put(fixtureSkinPack);
    const id = fixtureSkinPack.id;
    expect(await s.report(id, 'a')).toEqual({ count: 1, hidden: false });
    expect(await s.report(id, 'a')).toEqual({ count: 1, hidden: false });
    await s.report(id, 'b');
    expect((await s.list({ kind: 'skin' })).items).toHaveLength(1);
    expect(await s.report(id, 'c')).toEqual({ count: REPORTS_TO_HIDE, hidden: true });
    expect((await s.list({ kind: 'skin' })).items).toHaveLength(0);
  });

  it('batch read of 50 packs takes under 20 ms', async () => {
    const s = createSqlitePackStore(openDatabase(tmpDb()));
    const ids = Array.from({ length: 50 }, (_, i) => `g:b${i}`);
    for (const id of ids) await s.put(skin(id, '2026-01-01T00:00:00Z'));
    await s.getMany(ids); // warm up
    const t0 = performance.now();
    const res = await s.getMany([...ids.slice(0, 49), 'g:nope']);
    const ms = performance.now() - t0;
    console.log(`batch read of 50 ids: ${ms.toFixed(2)} ms`);
    expect(res.packs).toHaveLength(49);
    expect(res.missing).toEqual(['g:nope']);
    expect(ms).toBeLessThan(20);
  });
});
