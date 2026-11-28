import { describe, expect, test } from 'bun:test';
import { LIMITS } from '@wobble/shared';
import { deltaE } from '../images/color.ts';
import { clampDraft, MIN_PARTS, shrinkToFit } from './clamp.ts';
import { composeTheme, SANITIZER_V1_ONLY, sanitizeV2 } from './compose.ts';
import type { Draft } from './draft.ts';
import { autoFix, checkTheme, fogAt, RULES } from './legibility.ts';
import { proceduralDraft } from './procedural.ts';
import { readSelection } from './selection.ts';
import { SAMPLE_SELECTION } from './args.ts';

const picks = await readSelection(SAMPLE_SELECTION);
const good = () => clampDraft(proceduralDraft(picks[0]));
const fallback = autoFix(good(), good());

/** A draft that breaks every rule and every limit. */
function broken(): Draft {
  const draft = proceduralDraft(picks[1]);
  const { look, props } = draft;
  for (const m of look.materials) Object.assign(m, { color: '#777777', roughness: 9, metalness: -3 });
  look.materials = look.materials.filter((m) => m.slot !== 'rail');
  look.ground.color = '#777777';
  look.fog = { color: '#777777', near: -5, far: 10 };
  Object.assign(look.light, { sunIntensity: 99, ambientIntensity: 0, sunDir: { x: 1, y: -1, z: 0 } });
  look.sky.top = 'blue';
  look.name = 'A name that is much too long to fit in the contract limit';
  look.tagline = 'x'.repeat(300);
  look.particles = [];
  look.music = { ...look.music, tempo: 900, energy: 7, swing: -1 };
  look.cast.hero.name = 'Super Mario';
  look.cast.villain.description = 'Basically Darth Vader in a hat, ' + 'very long '.repeat(40);
  props.landmarks = [];
  props.dressing = [{ kind: 'platform', part: 9, hideBase: true, prims: props.dressing[0].prims }];
  props.costume.accessories = [];
  props.costume.palette = ['#ffffff'];
  const huge = Array.from({ length: 200 }, () => props.decor[0].prims[0]);
  props.decor = Array.from({ length: 20 }, () => ({ ...props.decor[0], prims: huge }));
  return draft;
}

describe('legibility', () => {
  test('reports every broken rule, tagged with the call that can repair it', () => {
    const issues = checkTheme(clampDraft(broken()));
    const text = issues.map((i) => i.message).join('\n');
    for (const word of ['hazard', 'bouncy', 'finish', 'ground', 'fog colour', 'fog.near', 'sunIntensity']) {
      expect(text).toContain(word);
    }
    expect(text).toContain('cast.hero refers to an existing character');
    expect(text).toContain('cast.villain refers to an existing character');
    expect(issues.filter((i) => i.part === 'props').map((i) => i.message)).toHaveLength(3);
  });

  test('autoFix leaves nothing to report, even for the worst draft', () => {
    const fixed = autoFix(clampDraft(broken()), fallback);
    expect(checkTheme(fixed)).toEqual([]);
    expect(deltaE(fixed.materials.hazard.color, fixed.materials.platformA.color)).toBeGreaterThanOrEqual(
      RULES.hazardVsPlatform,
    );
    expect(fogAt(RULES.checkpointDistance, fixed.fog)).toBeLessThanOrEqual(RULES.maxFogAtCheckpoint);
    expect(fixed.cast!.hero.name).not.toContain('Mario');
  });

  test('every procedural draft is complete after autoFix', () => {
    for (const pick of picks) {
      const theme = clampDraft(proceduralDraft(pick));
      expect(checkTheme(autoFix(theme, theme))).toEqual([]);
    }
  });

  test('does not change a good theme', () => {
    expect(autoFix(good(), fallback)).toEqual(good());
  });
});

describe('clamping', () => {
  test('tolerates only the v1-only rejection of the sanitizer', () => {
    const theme = composeTheme(fallback, [], null);
    const rejecting = (issue: string) => () => ({ ok: false as const, data: null, issues: [issue] });
    expect(sanitizeV2(theme, rejecting(SANITIZER_V1_ONLY))).toEqual(theme);
    expect(() => sanitizeV2(theme, rejecting('pack: still too large'))).toThrow('still too large');
  });

  test('keeps a hostile draft inside the contract', () => {
    const theme = composeTheme(autoFix(clampDraft(broken()), fallback), [], 'A very long submitter display name');
    expect(theme.version).toBe(2);
    expect(theme.name.length).toBeLessThanOrEqual(24);
    expect(theme.credit!.length).toBeLessThanOrEqual(24);
    expect(theme.music.tempo).toBeLessThanOrEqual(180);
    expect(theme.materials.rail.roughness).toBeLessThanOrEqual(1);
    // Parts exist; dressing stays within the part plus 0.75 m and at most 12 prims (fairness: you see what you hit).
    expect(theme.dressing.every((d) => d.part < MIN_PARTS[d.kind])).toBe(true);
    expect(theme.dressing.every((d) => d.prims.length <= 12)).toBe(true);
    expect(theme.dressing.flatMap((d) => d.prims).every((p) => p.pos.every((v) => Math.abs(v) <= 6.75))).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(theme))).toBeLessThanOrEqual(LIMITS.themePackMaxBytes);
  });

  test('shrinkToFit trims primitives until the JSON fits', () => {
    const theme = good();
    const small = shrinkToFit(theme, 3000);
    expect(Buffer.byteLength(JSON.stringify(small.landmarks))).toBeLessThan(
      Buffer.byteLength(JSON.stringify(theme.landmarks)),
    );
    expect(small.landmarks.every((l) => l.prims.length >= 1)).toBe(true);
  });
});

describe('obstacle dressing', () => {
  test('the procedural fallback dresses every part as an object that can hide its base', () => {
    const theme = autoFix(clampDraft(proceduralDraft(picks[0])), clampDraft(proceduralDraft(picks[0])));
    expect(theme.dressing.length).toBeGreaterThanOrEqual(RULES.dressedKinds);
    expect(theme.dressing.every((d) => d.prims.length >= RULES.dressingPrims && d.hideBase)).toBe(true);
  });

  test('plain dressing is reported for repair and dropped by autoFix', () => {
    const draft = proceduralDraft(picks[0]);
    draft.props.dressing[0].prims = draft.props.dressing[0].prims.slice(0, 1);
    const clamped = clampDraft(draft);
    expect(checkTheme(clamped).some((i) => i.part === 'props' && i.message.includes('too plain'))).toBe(true);
    expect(autoFix(clamped, clampDraft(proceduralDraft(picks[0]))).dressing.every((d) => d.prims.length > 1)).toBe(
      true,
    );
  });
});
