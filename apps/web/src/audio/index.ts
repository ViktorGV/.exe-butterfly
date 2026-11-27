// Audio (#13): procedural WebAudio sound effects, crowd/ambient beds and generative music.
// Nothing sounds until unlock() runs inside a user gesture; the first touch/click/key unlocks too.
import { INSTRUMENTS, DEFAULT_INSTRUMENT, type Voicing } from './instruments.ts';
import { PATCHES, patchLength, type Layer, type SoundName } from './patches.ts';
import { generatePattern, midiToHz, seedFor, type MusicDef, type Pattern } from './pattern.ts';
import { loadVolumes, normalizeVolumes, saveVolumes, type Volumes } from './prefs.ts';
import { createRng } from './rng.ts';
import { spatialize, type Spatial, type Vec3Like } from './spatial.ts';
import { createVoicePool } from './voices.ts';

export { PATCHES, SOUND_NAMES, type SoundName } from './patches.ts';
export { generatePattern, type MusicDef } from './pattern.ts';
export { MAX_VOICES } from './voices.ts';
export { HEAR_RADIUS_M } from './spatial.ts';
export type { Volumes } from './prefs.ts';

export type AmbienceKind = 'rain' | 'wind' | 'bubbles' | 'embers';

export interface PlayOpts {
  pos?: Vec3Like;
  volume?: number;
}

export interface Audio {
  unlock(): void;
  play(name: SoundName, opts?: PlayOpts): void;
  setMusic(def: MusicDef | null): void;
  setVolumes(v: Partial<Volumes>): void;
  getVolumes(): Volumes;
  setListener(pos: Vec3Like, yaw: number): void;
  setCrowdDensity(d: number): void;
  setAmbience(kind: AmbienceKind | null): void;
  readonly unlocked: boolean;
  /** Live voice count, for debugging and stress checks. */
  readonly voiceCount: number;
  dispose(): void;
}

export interface CreateAudioOptions {
  /** Defaults to window.AudioContext / webkitAudioContext. */
  createContext?: () => AudioContext;
  /** Attach one-shot gesture listeners that call unlock(). Default true. */
  autoUnlock?: boolean;
}

const MIN_GAIN = 0.0001;
const FADE_S = 0.012;
const LOOKAHEAD_S = 0.15;
const SCHED_MS = 30;
const XFADE_S = 1.5;
const GESTURES = ['pointerdown', 'touchend', 'keydown', 'mousedown'] as const;

function defaultContext(): AudioContext {
  const w = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio not supported');
  return new Ctor({ latencyHint: 'interactive' });
}

interface MusicTrack {
  bus: GainNode;
  pattern: Pattern;
  voicing: Voicing;
  nextStep: number;
  nextTime: number;
  rng: () => number;
}

export function createAudio(opts: CreateAudioOptions = {}): Audio {
  const makeCtx = opts.createContext ?? defaultContext;
  let ctx: AudioContext | null = null;
  let master!: GainNode;
  let sfxBus!: GainNode;
  let musicBus!: GainNode;
  let duckBus!: GainNode;
  let musicFilter!: BiquadFilterNode;
  let noiseBuf!: AudioBuffer;
  let crowd: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  let ambience: { src: AudioBufferSourceNode; gain: GainNode; lfo?: OscillatorNode } | null = null;
  let track: MusicTrack | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let crowdDensity = 0;
  let ambienceKind: AmbienceKind | null = null;
  let pendingMusic: MusicDef | null = null;
  let volumes = loadVolumes();
  const listener = { x: 0, y: 0, z: 0 };
  let listenerYaw = 0;
  const spat: Spatial = { gain: 1, pan: 0 };
  const jitterRng = createRng(0x5eed);
  const pool = createVoicePool({ minIntervalSec: (n) => PATCHES[n as SoundName]?.minInterval ?? 0.04 });

  const hasDoc = typeof document !== 'undefined';

  function onGesture(): void {
    unlock();
  }
  function onVisibility(): void {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  }
  if (hasDoc && opts.autoUnlock !== false) {
    for (const g of GESTURES) document.addEventListener(g, onGesture, { capture: true, passive: true });
  }
  if (hasDoc) document.addEventListener('visibilitychange', onVisibility);

  function removeGestures(): void {
    if (!hasDoc) return;
    for (const g of GESTURES) document.removeEventListener(g, onGesture, { capture: true });
  }

  function applyVolumes(): void {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(volumes.master, t, 0.03);
    sfxBus.gain.setTargetAtTime(volumes.sfx, t, 0.03);
    musicBus.gain.setTargetAtTime(volumes.music * 0.5, t, 0.03);
  }

  function build(c: AudioContext): void {
    master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(c.destination);
    sfxBus = c.createGain();
    sfxBus.connect(master);
    musicFilter = c.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicBus = c.createGain();
    duckBus = c.createGain();
    musicFilter.connect(duckBus).connect(musicBus).connect(master);
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    const r = createRng(1);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    applyVolumes();
  }

  function unlock(): void {
    if (disposed) return;
    try {
      if (!ctx) {
        ctx = makeCtx();
        build(ctx);
        // iOS: a silent buffer started inside the gesture fully unlocks output.
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, 22050);
        s.connect(ctx.destination);
        s.start(0);
        timer = setInterval(scheduleMusic, SCHED_MS);
        if (crowdDensity > 0) setCrowdDensity(crowdDensity);
        if (ambienceKind) setAmbience(ambienceKind);
        if (pendingMusic) setMusic(pendingMusic);
      }
      if (ctx.state !== 'running') void ctx.resume();
      if (ctx.state === 'running') removeGestures();
      else void ctx.resume().then(removeGestures, () => {});
    } catch {
      /* unsupported: stay silent */
    }
  }

  /** Attack-hold-release envelope that never steps, so note edges cannot click. */
  function envelope(g: GainNode, t0: number, dur: number, peak: number, attack: number): void {
    const p = g.gain;
    p.setValueAtTime(MIN_GAIN, t0);
    p.linearRampToValueAtTime(Math.max(MIN_GAIN, peak), t0 + attack);
    p.exponentialRampToValueAtTime(MIN_GAIN, t0 + Math.max(dur, attack + 0.01));
  }

  function layerNode(
    c: AudioContext,
    l: Layer,
    t0: number,
    pitch: number,
    out: AudioNode,
    nodes: AudioScheduledSourceNode[],
  ): void {
    const g = c.createGain();
    const attack = l.attack ?? 0.006;
    envelope(g, t0, l.dur, l.gain, attack);
    let src: AudioScheduledSourceNode;
    if (l.type === 'noise') {
      const n = c.createBufferSource();
      n.buffer = noiseBuf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(l.f0 * pitch, t0);
      f.frequency.exponentialRampToValueAtTime(l.f1 * pitch, t0 + l.dur);
      n.connect(f).connect(g);
      src = n;
    } else {
      const o = c.createOscillator();
      o.type = l.type;
      o.frequency.setValueAtTime(l.f0 * pitch, t0);
      if (l.f1 !== l.f0) o.frequency.exponentialRampToValueAtTime(l.f1 * pitch, t0 + l.dur);
      o.connect(g);
      src = o;
    }
    g.connect(out);
    src.start(t0);
    src.stop(t0 + l.dur + 0.02);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
    nodes.push(src);
  }

  function duck(t: number, len: number): void {
    const p = duckBus.gain;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(0.25, t, 0.05);
    p.setTargetAtTime(1, t + len, 0.4);
  }

  function play(name: SoundName, o: PlayOpts = {}): void {
    const c = ctx;
    if (!c || c.state !== 'running') return;
    const patch = PATCHES[name];
    if (!patch) return;
    let gain = o.volume ?? 1;
    let pan = 0;
    if (o.pos) {
      if (!spatialize(o.pos, listener, listenerYaw, spat)) return;
      gain *= spat.gain;
      pan = spat.pan;
    }
    if (gain <= 0.001) return;
    const now = c.currentTime;
    if (!pool.admit(name, now, gain)) return;
    const t0 = now + 0.005;
    const len = patchLength(patch);
    const vg = c.createGain();
    vg.gain.value = gain;
    let out: AudioNode = vg;
    let panner: StereoPannerNode | null = null;
    if (pan !== 0 && typeof c.createStereoPanner === 'function') {
      panner = c.createStereoPanner();
      panner.pan.value = pan;
      vg.connect(panner);
      out = panner;
    }
    out.connect(sfxBus);
    const pitch = 1 + (jitterRng() * 2 - 1) * patch.jitter;
    const nodes: AudioScheduledSourceNode[] = [];
    for (const l of patch.layers) layerNode(c, l, t0 + l.at, pitch, vg, nodes);
    const end = t0 + len + 0.05;
    const cleanup = setTimeout(
      () => {
        vg.disconnect();
        panner?.disconnect();
      },
      (len + 0.2) * 1000,
    );
    pool.add({
      name,
      startSec: now,
      endSec: end,
      gain,
      stop: () => {
        const t = c.currentTime;
        vg.gain.cancelScheduledValues(t);
        vg.gain.setTargetAtTime(0, t, FADE_S);
        for (const n of nodes) {
          try {
            n.stop(t + FADE_S * 5);
          } catch {
            /* already stopped */
          }
        }
        clearTimeout(cleanup);
        setTimeout(() => {
          vg.disconnect();
          panner?.disconnect();
        }, 200);
      },
    });
    if (patch.duck) duck(t0, len);
  }

  // ---- music ----

  function scheduleNote(t: MusicTrack, part: string, midi: number, at: number, dur: number, vel: number): void {
    const c = ctx!;
    const v = t.voicing;
    if (part === 'kick' || part === 'hat' || part === 'snare') {
      const l: Layer =
        part === 'kick'
          ? { type: 'sine', f0: 140, f1: 45, at: 0, dur: 0.18, gain: vel * 0.9 }
          : part === 'hat'
            ? { type: 'noise', f0: 8000, f1: 7000, at: 0, dur: 0.04, gain: vel * 0.25 }
            : { type: 'noise', f0: 1800, f1: 1200, at: 0, dur: 0.12, gain: vel * 0.35 };
      layerNode(c, l, at, 1, t.bus, []);
      return;
    }
    const type = part === 'bass' ? v.bass : part === 'chord' ? v.chord : v.lead;
    const hz = midiToHz(midi);
    const len = Math.max(0.05, dur * v.decay);
    const g = part === 'chord' ? vel * 0.5 : vel;
    const attack = part === 'chord' ? Math.min(0.08, len / 3) : 0.008;
    layerNode(c, { type, f0: hz, f1: hz, at: 0, dur: len, gain: g * 0.4, attack }, at, 1, t.bus, []);
    if (part === 'chord' && v.detune) {
      const hz2 = hz * Math.pow(2, v.detune / 1200);
      layerNode(c, { type, f0: hz2, f1: hz2, at: 0, dur: len, gain: g * 0.25, attack }, at, 1, t.bus, []);
    }
  }

  function scheduleMusic(): void {
    const c = ctx;
    const t = track;
    if (!c || !t || c.state !== 'running') return;
    const horizon = c.currentTime + LOOKAHEAD_S;
    if (t.nextTime < c.currentTime - 0.5) t.nextTime = c.currentTime + 0.05; // resumed after a stall
    const p = t.pattern;
    while (t.nextTime < horizon) {
      const step = t.nextStep;
      const swing = step % 2 === 1 ? p.swingSec : 0;
      for (const e of p.events) {
        if (e.step !== step) continue;
        if (e.part === 'lead' && t.rng() < 0.1) continue; // light variation each loop
        scheduleNote(t, e.part, e.midi, t.nextTime + swing, e.len * p.stepSec, e.vel);
      }
      t.nextStep = (step + 1) % p.steps;
      t.nextTime += p.stepSec;
    }
  }

  function setMusic(def: MusicDef | null): void {
    pendingMusic = def;
    const c = ctx;
    if (!c) return;
    const now = c.currentTime;
    if (track) {
      const old = track.bus;
      old.gain.cancelScheduledValues(now);
      old.gain.setValueAtTime(old.gain.value, now);
      old.gain.linearRampToValueAtTime(0, now + XFADE_S);
      setTimeout(() => old.disconnect(), (XFADE_S + 0.5) * 1000);
      track = null;
    }
    if (!def) return;
    const voicing = INSTRUMENTS[def.instrument ?? DEFAULT_INSTRUMENT] ?? INSTRUMENTS[DEFAULT_INSTRUMENT];
    musicFilter.frequency.setTargetAtTime(voicing.cutoff, now, 0.3);
    const bus = c.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(1, now + XFADE_S);
    bus.connect(musicFilter);
    const seed = seedFor(def);
    track = {
      bus,
      pattern: generatePattern(def, seed),
      voicing,
      nextStep: 0,
      nextTime: now + 0.1,
      rng: createRng(seed ^ 0x9e37),
    };
  }

  // ---- beds ----

  function loopNoise(
    filterType: BiquadFilterType,
    freq: number,
    q: number,
  ): { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } {
    const c = ctx!;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(sfxBus);
    src.start();
    return { src, gain, filter };
  }

  function fadeOutBed(bed: { src: AudioBufferSourceNode; gain: GainNode; lfo?: OscillatorNode }): void {
    const t = ctx!.currentTime;
    bed.gain.gain.setTargetAtTime(0, t, 0.3);
    bed.src.stop(t + 1.5);
    bed.lfo?.stop(t + 1.5);
    bed.src.onended = () => {
      bed.src.disconnect();
      bed.gain.disconnect();
      bed.lfo?.disconnect();
    };
  }

  function setCrowdDensity(d: number): void {
    crowdDensity = Math.max(0, Math.min(1, d || 0));
    if (!ctx) return;
    if (!crowd && crowdDensity > 0) crowd = loopNoise('bandpass', 500, 0.7);
    crowd?.gain.gain.setTargetAtTime(crowdDensity * 0.12, ctx.currentTime, 0.5);
  }

  function setAmbience(kind: AmbienceKind | null): void {
    ambienceKind = kind;
    if (!ctx) return;
    if (ambience) {
      fadeOutBed(ambience);
      ambience = null;
    }
    if (!kind) return;
    const cfg = {
      rain: ['highpass', 3000, 0.5, 0.06],
      wind: ['lowpass', 400, 0.8, 0.1],
      bubbles: ['bandpass', 900, 8, 0.08],
      embers: ['highpass', 5000, 1, 0.04],
    } as const;
    const [type, freq, q, level] = cfg[kind];
    const bed: { src: AudioBufferSourceNode; gain: GainNode; lfo?: OscillatorNode } = loopNoise(type, freq, q);
    if (kind === 'wind' || kind === 'bubbles') {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = kind === 'wind' ? 0.15 : 3;
      depth.gain.value = level * 0.6;
      lfo.connect(depth).connect(bed.gain.gain);
      lfo.start();
      bed.lfo = lfo;
    }
    bed.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.5);
    ambience = bed;
  }

  return {
    unlock,
    play,
    setMusic,
    setVolumes(v) {
      volumes = normalizeVolumes(v, volumes);
      saveVolumes(volumes);
      applyVolumes();
    },
    getVolumes: () => ({ ...volumes }),
    setListener(pos, yaw) {
      listener.x = pos.x;
      listener.y = pos.y;
      listener.z = pos.z;
      listenerYaw = yaw;
    },
    setCrowdDensity,
    setAmbience,
    get unlocked() {
      return ctx?.state === 'running';
    },
    get voiceCount() {
      if (ctx) pool.prune(ctx.currentTime);
      return pool.active.length;
    },
    dispose() {
      disposed = true;
      removeGestures();
      if (hasDoc) document.removeEventListener('visibilitychange', onVisibility);
      if (timer) clearInterval(timer);
      timer = null;
      pool.clear();
      track = null;
      void ctx?.close();
      ctx = null;
    },
  };
}
