// Can players still read the course, and does the theme fill every slot the event needs? (#59)
// `checkTheme` finds problems (fed to the repair call); `autoFix` removes whatever the model could not.
import { deltaE, mixHex } from '../images/color.ts';
import type { ThemeLook } from './clamp.ts';

export type Part = 'look' | 'props';

export interface Issue {
  /** Which art-direction call can repair it. */
  part: Part;
  message: string;
}

/** Obstacle kinds on b:gumdrop-gauntlet, the one event course. */
export const GAUNTLET_KINDS = ['platform', 'sweeper', 'movingPlatform', 'bumper', 'bridge', 'ramp', 'gate'] as const;

export const RULES = Object.freeze({
  /** minimum CIE76 colour difference */
  hazardVsPlatform: 30,
  bouncyVsPlatform: 25,
  bouncyVsHazard: 20,
  finishVsPlatform: 15,
  groundVsPlatform: 15,
  fogVsPlatform: 12,
  /** metres: the next checkpoint on the gauntlet is about 48 m away */
  checkpointDistance: 55,
  maxFogAtCheckpoint: 0.4,
  fogNear: 20,
  fogFar: 120,
  sun: [0.6, 2.5],
  ambient: [0.35, 1.4],
  sunHeight: 0.3,
  landmarks: 2,
  particles: 1,
  accessories: 8,
  dressedKinds: 3,
});

/** Well-known characters the cast must never be named after. */
const KNOWN_CHARACTERS =
  /\b(mario|luigi|bowser|yoshi|princess peach|sonic|pikachu|pok[eé]mon|mickey|minnie|donald duck|goofy|elsa|olaf|shrek|batman|superman|spider[- ]?man|joker|darth|vader|yoda|skywalker|harry potter|voldemort|gandalf|sauron|frodo|kirby|zelda|ganon|pac[- ]?man|hello kitty|spongebob|squidward|homer simpson|bart simpson|iron man|hulk|thanos|godzilla|king kong|lara croft|kratos|goku|naruto|totoro|bugs bunny|scooby|barbie|peppa|minions?|lightyear|simba|mufasa|sackboy|fall guys?)\b/i;

type Rule = [other: string, minimum: number];

const satisfies = (color: string, rules: Rule[]) => rules.every(([other, min]) => deltaE(color, other) >= min);

function platformRules(t: ThemeLook, minimum: number): Rule[] {
  return [
    [t.materials.platformA.color, minimum],
    [t.materials.platformB.color, minimum],
  ];
}

const colorRules = (t: ThemeLook) => ({
  hazard: platformRules(t, RULES.hazardVsPlatform),
  bouncy: [...platformRules(t, RULES.bouncyVsPlatform), [t.materials.hazard.color, RULES.bouncyVsHazard] as Rule],
  finish: platformRules(t, RULES.finishVsPlatform),
  ground: platformRules(t, RULES.groundVsPlatform),
  fog: platformRules(t, RULES.fogVsPlatform),
});

export function fogAt(distance: number, fog: { near: number; far: number }): number {
  return Math.min(1, Math.max(0, (distance - fog.near) / Math.max(1, fog.far - fog.near)));
}

function fogProblems(t: ThemeLook): string[] {
  const out: string[] = [];
  if (t.fog.near < RULES.fogNear) out.push(`fog.near must be at least ${RULES.fogNear}`);
  if (t.fog.far < RULES.fogFar) out.push(`fog.far must be at least ${RULES.fogFar}`);
  if (fogAt(RULES.checkpointDistance, t.fog) > RULES.maxFogAtCheckpoint) {
    out.push('fog hides the next checkpoint: raise fog.near and fog.far');
  }
  return out;
}

function lightProblems({ light }: ThemeLook): string[] {
  const out: string[] = [];
  const [sunMin, sunMax] = RULES.sun;
  const [ambientMin, ambientMax] = RULES.ambient;
  if (light.sunIntensity < sunMin || light.sunIntensity > sunMax) {
    out.push(`light.sunIntensity must be between ${sunMin} and ${sunMax}`);
  }
  if (light.ambientIntensity < ambientMin || light.ambientIntensity > ambientMax) {
    out.push(`light.ambientIntensity must be between ${ambientMin} and ${ambientMax}`);
  }
  if (light.sunDir[1] < RULES.sunHeight) out.push('light.sunDir.y must be higher so the course is lit from above');
  return out;
}

function castProblems(t: ThemeLook): string[] {
  if (!t.cast) return ['cast needs a hero and a villain'];
  const out: string[] = [];
  for (const role of ['hero', 'villain'] as const) {
    const { name, description } = t.cast[role];
    if (KNOWN_CHARACTERS.test(name) || KNOWN_CHARACTERS.test(description)) {
      out.push(`cast.${role} refers to an existing character: invent a new one`);
    }
  }
  if (t.cast.hero.name.toLowerCase() === t.cast.villain.name.toLowerCase()) {
    out.push('cast.hero and cast.villain need different names');
  }
  return out;
}

const dressedKinds = (t: ThemeLook) =>
  new Set(t.dressing.map((d) => d.kind).filter((k) => (GAUNTLET_KINDS as readonly string[]).includes(k)));

export function checkTheme(t: ThemeLook): Issue[] {
  const rules = colorRules(t);
  const colors = {
    hazard: t.materials.hazard.color,
    bouncy: t.materials.bouncy.color,
    finish: t.materials.finish.color,
    ground: t.ground.color,
    fog: t.fog.color,
  };
  const look: string[] = [];
  for (const key of Object.keys(rules) as (keyof typeof rules)[]) {
    if (satisfies(colors[key], rules[key])) continue;
    const needs = rules[key].map(([other, min]) => `${other} (difference ${min}+)`).join(', ');
    look.push(`the ${key} colour ${colors[key]} is too close to ${needs}`);
  }
  look.push(...fogProblems(t), ...lightProblems(t), ...castProblems(t));
  if (t.particles.length < RULES.particles) look.push('add at least one particle system');

  const props: string[] = [];
  if (t.landmarks.length < RULES.landmarks) props.push(`add at least ${RULES.landmarks} landmarks`);
  if (t.costume.accessories.length < RULES.accessories) {
    props.push(`the costume kit needs at least ${RULES.accessories} accessories`);
  }
  if (dressedKinds(t).size < RULES.dressedKinds) {
    props.push(`add dressing for at least ${RULES.dressedKinds} of: ${GAUNTLET_KINDS.join(', ')}`);
  }
  return [
    ...look.map((message): Issue => ({ part: 'look', message })),
    ...props.map((message): Issue => ({ part: 'props', message })),
  ];
}

const VIVID = ['#e8272f', '#ff7a00', '#d1007a', '#7a1fd1', '#ffd400', '#0066ff', '#00a86b', '#1c1c28', '#ffffff'];
const BACKDROPS = ['#101826', '#2b3a67', '#f4f6ff', '#3b2b4f', '#0f3d3e', '#5a1e12', '#d9f6ff', '#000000'];

/** Keep `color` if it passes; else the first candidate that does, or the one that comes closest. */
function choose(color: string, candidates: string[], rules: Rule[]): string {
  if (satisfies(color, rules)) return color;
  const margin = (c: string) => Math.min(...rules.map(([other, min]) => deltaE(c, other) - min));
  return candidates.find((c) => satisfies(c, rules)) ?? candidates.reduce((a, b) => (margin(b) > margin(a) ? b : a));
}

function fixMaterial(t: ThemeLook, slot: 'hazard' | 'bouncy' | 'finish', rules: Rule[]): void {
  const material = t.materials[slot];
  const color = choose(material.color, VIVID, rules);
  if (color === material.color) return;
  material.color = color;
  delete material.emissive;
  // A pattern keeps its shape but follows the new colour, so it cannot reintroduce the old one.
  if (material.pattern) material.pattern.colors = [color, mixHex(color, '#ffffff', 0.35)];
}

const clampTo = (v: number, [min, max]: readonly number[]) => Math.min(max, Math.max(min, v));

/** Deterministically repair every remaining problem, filling missing slots from `fallback`. */
export function autoFix(theme: ThemeLook, fallback: ThemeLook): ThemeLook {
  const t = structuredClone(theme);
  // Order matters: bouncy is compared with the (already fixed) hazard colour.
  fixMaterial(t, 'hazard', colorRules(t).hazard);
  fixMaterial(t, 'bouncy', colorRules(t).bouncy);
  fixMaterial(t, 'finish', colorRules(t).finish);
  t.ground.color = choose(t.ground.color, BACKDROPS, colorRules(t).ground);
  t.fog.color = choose(t.fog.color, [t.sky.horizon, ...BACKDROPS], colorRules(t).fog);
  if (fogProblems(t).length) t.fog = { color: t.fog.color, near: 45, far: 200 };
  t.light.sunIntensity = clampTo(t.light.sunIntensity, RULES.sun);
  t.light.ambientIntensity = clampTo(t.light.ambientIntensity, RULES.ambient);
  if (t.light.sunDir[1] < RULES.sunHeight) t.light.sunDir = [0.4, 0.8, 0.45];
  if (castProblems(t).length) t.cast = structuredClone(fallback.cast);
  if (t.particles.length < RULES.particles) t.particles = structuredClone(fallback.particles);
  for (const landmark of fallback.landmarks) {
    if (t.landmarks.length >= RULES.landmarks) break;
    t.landmarks.push(structuredClone(landmark));
  }
  for (const accessory of fallback.costume.accessories) {
    if (t.costume.accessories.length >= RULES.accessories) break;
    t.costume.accessories.push(structuredClone(accessory));
  }
  for (const dressing of fallback.dressing) {
    if (dressedKinds(t).size >= RULES.dressedKinds) break;
    if (dressedKinds(t).has(dressing.kind as (typeof GAUNTLET_KINDS)[number])) continue;
    if (t.dressing.length >= 10) t.dressing.shift();
    t.dressing.push(structuredClone(dressing));
  }
  return t;
}
