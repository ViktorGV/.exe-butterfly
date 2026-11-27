// tools/event/out/characters.html: a contact sheet per theme plus counts per status (#63).
// Swatches only, no 3D: enough to see whether a person's colours and motifs survive each theme.
import type { Pack, SkinDef } from '@wobble/shared';
import type { PregenResult } from './pregen.ts';
import type { ThemeInput } from './types.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function card(p: Pack): string {
  const s = p.data as SkinDef;
  const dots = [s.body.color, s.body.belly, s.limbs.color, ...s.accessories.map((a) => a.prims[0]!.color)]
    .map((c) => `<i style="background:${esc(c)}"></i>`)
    .join('');
  const acc = s.accessories.map((a) => `${a.anchor}:${a.prims.length}`).join(' ');
  return (
    `<div class="c"><b style="background:${esc(s.body.color)}"></b><div>${dots}</div><p>${esc(s.name)}</p>` +
    `<small>${esc(p.id)}<br>${esc(s.body.pattern.type)} · ${esc(s.face.eyes)}/${esc(s.face.mouth)} · ${esc(acc)}</small></div>`
  );
}

export function contactSheet(result: PregenResult, themes: ThemeInput[]): string {
  const byId = new Map(result.packs.map((p) => [p.id, p]));
  const cardFor = (id: string | undefined) => {
    const p = id ? byId.get(id) : undefined;
    return p ? card(p) : '';
  };
  // Row = person, column = theme, so the same person's skins line up.
  const people = Object.values(result.roster.entries).filter((e) => Object.keys(e.skins).length > 0);
  const personalRows = people
    .map(
      (e) =>
        `<tr><td class="d">${esc(e.characterPrompt ?? '')}</td>${themes.map((t) => `<td>${cardFor(e.skins[t.id])}</td>`).join('')}</tr>`,
    )
    .join('');
  const themeBlocks = themes
    .map((t) => {
      const cast = result.cast[t.id];
      const castCards = cast ? cardFor(cast.hero) + cardFor(cast.villain) : '';
      const pool = (result.pools[t.id] ?? []).map(cardFor);
      return (
        `<h2>${esc(t.def.title)} <small>${esc(t.id)}</small></h2><h3>Hero and villain</h3><div class="g">${castCards}</div>` +
        `<h3>Pool (${pool.length})</h3><div class="g">${pool.join('')}</div>`
      );
    })
    .join('');
  const c = result.counts;
  return `<!doctype html><meta charset="utf-8"><title>Characters</title><style>
body{font:13px system-ui;margin:16px;background:#f6f6f9}table{border-collapse:collapse}td{vertical-align:top;padding:4px;border-bottom:1px solid #ddd}
.d{max-width:220px}.g{display:flex;flex-wrap:wrap;gap:6px}.c{width:150px;background:#fff;border-radius:8px;padding:6px}
.c b{display:block;width:48px;height:56px;border-radius:24px 24px 18px 18px;margin:0 auto 4px}.c i{display:inline-block;width:14px;height:14px;border-radius:7px;margin:1px;border:1px solid #0002}
.c p{margin:2px 0;font-weight:600}.c small{color:#666;font-size:10px;word-break:break-all}</style>
<h1>Characters</h1><p>ok ${c.ok} · tooVague ${c.tooVague} · unsafe ${c.unsafe} · empty ${c.empty} · reinterpreted from IP ${c.reinterpretedFromIP} · fallback skins ${result.fallbacks} · packs ${result.packs.length}</p>
<h2>Personal skins</h2><table><tr><th>screened prompt</th>${themes.map((t) => `<th>${esc(t.def.title)}</th>`).join('')}</tr>${personalRows}</table>
${themeBlocks}
`;
}
