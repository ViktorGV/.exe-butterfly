// Compact summaries of packs for gallery cards (#16).
import type { Hex, Pattern, SkinDef, ThemeDef } from '../types.ts';

export interface SkinSwatch {
  name: string;
  /** body, belly, limbs, then the first accessory colour if any */
  colors: Hex[];
  pattern: Pattern;
  eyes: SkinDef['face']['eyes'];
  mouth: SkinDef['face']['mouth'];
}

export interface ThemeSwatch {
  name: string;
  /** sky top, horizon, bottom */
  sky: [Hex, Hex, Hex];
  /** platformA, platformB, hazard, bouncy, accent */
  colors: Hex[];
}

export function skinSwatch(skin: SkinDef): SkinSwatch {
  const accent = skin.accessories[0]?.prims[0]?.color;
  return {
    name: skin.name,
    colors: [skin.body.color, skin.body.belly, skin.limbs.color, ...(accent ? [accent] : [])],
    pattern: skin.body.pattern,
    eyes: skin.face.eyes,
    mouth: skin.face.mouth,
  };
}

export function themeSwatch(theme: ThemeDef): ThemeSwatch {
  const m = theme.materials;
  return {
    name: theme.name,
    sky: [theme.sky.top, theme.sky.horizon, theme.sky.bottom],
    colors: [m.platformA.color, m.platformB.color, m.hazard.color, m.bouncy.color, m.accent.color],
  };
}
