// out/themes.html: every image, colour and note of a run on one page, for a human glance. Not committed (#59).
import { dirname, relative } from 'node:path';
import type { ThemeDefV2 } from '@wobble/shared';
import { writeText } from './lib.ts';
import { imageNames, themeDir } from './publish.ts';

export interface SheetTheme {
  slug: string;
  theme: ThemeDefV2;
  slots: { id: string; ok: boolean; attempts: number; reason?: string }[];
  notes: string[];
  screenshots: Uint8Array[];
}

const escape = (value: string) =>
  value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function writeContactSheet(
  file: string,
  eventDir: string,
  themes: SheetTheme[],
  summary: string,
): Promise<void> {
  const sections = themes.map(({ slug, theme, slots, notes, screenshots }) => {
    const base = relative(dirname(file), themeDir(eventDir, slug)).replaceAll('\\', '/');
    const images = imageNames(theme)
      .filter((name) => !name.includes('@0.5x'))
      .map(
        (name) => `<figure><img src="${base}/${name}" loading="lazy"><figcaption>${escape(name)}</figcaption></figure>`,
      );
    const tiles = [...new Set(Object.values(theme.materials).flatMap((m) => (m.texture ? [m.texture.src] : [])))].map(
      (name) =>
        `<figure><div class="tile" style="background-image:url('${base}/${name}')"></div>` +
        `<figcaption>${escape(name)} tiled 3 x 3</figcaption></figure>`,
    );
    const colours: [string, string][] = [
      ...Object.entries(theme.materials).map(([k, m]): [string, string] => [k, m.color]),
      ['sky', theme.sky.top],
      ['horizon', theme.sky.horizon],
      ['fog', theme.fog.color],
      ['ground', theme.ground.color],
      ['hud', theme.hud.accent],
    ];
    const swatches = colours.map(([k, c]) => `<span style="--c:${c}">${k} ${c}</span>`);
    const shots = screenshots.map(
      (b) => `<figure><img src="data:image/png;base64,${Buffer.from(b).toString('base64')}"></figure>`,
    );
    const rows = slots.map(
      (s) =>
        `<li>${s.ok ? 'ok' : '<b>null</b>'} ${escape(s.id)}, ${s.attempts} attempt(s) ${escape(s.reason ?? '')}</li>`,
    );
    const cast = theme.cast
      ? `<p>Hero: <b>${escape(theme.cast.hero.name)}</b>, ${escape(theme.cast.hero.description)}<br>` +
        `Villain: <b>${escape(theme.cast.villain.name)}</b>, ${escape(theme.cast.villain.description)}</p>`
      : '';
    return (
      `<section><h2>${escape(theme.title)} <small>${slug}</small></h2><p>${escape(theme.tagline)}</p>${cast}` +
      `<div class="swatches">${swatches.join('')}</div><div class="grid">${[...images, ...tiles, ...shots].join('')}</div>` +
      `<ul>${rows.join('')}${notes.map((n) => `<li>${escape(n)}</li>`).join('')}</ul></section>`
    );
  });
  const html = `<!doctype html>
<meta charset="utf-8">
<title>Event themes</title>
<style>
body{font:14px system-ui;margin:24px;background:#16161d;color:#eee}
.grid{display:flex;flex-wrap:wrap;gap:12px}figure{margin:0}img,.tile{width:240px;border-radius:8px}
img{background:repeating-conic-gradient(#555 0 25%,#777 0 50%) 0 0/20px 20px}
.tile{height:240px;background-size:80px 80px}
.swatches span{display:inline-block;margin:0 8px 8px 0;padding:4px 8px;border-left:24px solid var(--c);background:#262633}
</style>
<h1>Event themes</h1><p>${escape(summary)}</p>${sections.join('')}
`;
  await writeText(file, html);
}
