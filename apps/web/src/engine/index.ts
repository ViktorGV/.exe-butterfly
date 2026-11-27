// Engine core (#3): one renderer, one deterministic fixed-step simulation loop, one render loop.
//
//   const engine = createEngine({ canvas });
//   engine.onFixedUpdate((dt, simTime) => { /* physics, input, colliders: exactly SIM_HZ per second */ });
//   engine.onRender((alpha, frameDt) => { /* interpolate visuals between the last two steps */ });
//   engine.start();
//
// Callbacks run in registration order. While the tab is hidden, rendering stops but fixed
// updates keep running from a low-rate timer so networking stays alive.
import * as THREE from 'three';
import { SIM_HZ } from '@wobble/shared/constants';
import { createFrameStats } from './frameStats.ts';
import { createFixedLoop } from './loop.ts';
import { createDebugOverlay, type StatGetter } from './overlay.ts';
import { QUALITY_PRESETS, isQualityPreset, pixelRatioFor, type QualityPreset } from './quality.ts';

export { createFixedLoop, type FixedLoop } from './loop.ts';
export { createFrameStats, type FrameStats } from './frameStats.ts';
export { QUALITY_PRESETS, pixelRatioFor, type QualityPreset, type QualitySettings } from './quality.ts';

export type FixedUpdateFn = (dt: number, simTime: number) => void;
export type RenderFn = (alpha: number, frameDt: number) => void;

export interface EngineInfo {
  fps: number;
  frameMsP50: number;
  frameMsP95: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  stepsPerFrame: number;
  droppedSteps: number;
  quality: QualityPreset;
  pixelRatio: number;
}

export interface Engine {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  /** Current simulation time in seconds (multiple of 1 / SIM_HZ). */
  readonly simTime: number;
  readonly running: boolean;
  readonly quality: QualityPreset;
  /** Runs exactly SIM_HZ times per simulated second. Returns an unsubscribe function. */
  onFixedUpdate(fn: FixedUpdateFn): () => void;
  /** Runs once per displayed frame, after the fixed updates. Returns an unsubscribe function. */
  onRender(fn: RenderFn): () => void;
  start(): void;
  stop(): void;
  setQuality(preset: QualityPreset): void;
  /** Add a line to the debug overlay. Returns a function that removes it. */
  addStat(name: string, getter: StatGetter): () => void;
  setDebugOverlay(visible: boolean): void;
  info(): EngineInfo;
  dispose(): void;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  /** Default 'high' on devices with a fine pointer, otherwise 'medium'. */
  quality?: QualityPreset;
  /** Element the debug overlay is attached to. Default document.body. */
  overlayParent?: HTMLElement;
  /** Show the debug overlay immediately. Default false (toggle with the backquote key). */
  debug?: boolean;
  /** Fixed updates per second while the tab is hidden. Default 10. */
  hiddenTickHz?: number;
}

const HIDDEN_MAX_STEPS = SIM_HZ * 2; // up to 2 s of catch-up per hidden tick (browsers throttle timers to ~1 Hz)
const MAX_FRAME_DT = 0.25; // a longer frame (debugger pause, alt-tab) is treated as 250 ms
const OVERLAY_REFRESH_MS = 250;

function defaultQuality(): QualityPreset {
  const fine = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
  return fine ? 'high' : 'medium';
}

export function createEngine({
  canvas,
  quality: initialQuality = defaultQuality(),
  overlayParent = document.body,
  debug = false,
  hiddenTickHz = 10,
}: EngineOptions): Engine {
  if (!isQualityPreset(initialQuality)) throw new Error(`createEngine: unknown quality preset "${initialQuality}"`);
  let quality: QualityPreset = initialQuality;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: QUALITY_PRESETS[quality].antialias,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.type = THREE.PCFShadowMap; // soft PCF in this three.js version
  renderer.info.autoReset = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, QUALITY_PRESETS[quality].far);

  const fixedFns: FixedUpdateFn[] = [];
  const renderFns: RenderFn[] = [];
  const loop = createFixedLoop({
    hz: SIM_HZ,
    maxSteps: 5,
    onStep(dt, simTime) {
      for (let i = 0; i < fixedFns.length; i++) fixedFns[i](dt, simTime);
    },
  });
  const stats = createFrameStats(120);
  const overlay = createDebugOverlay(overlayParent);
  overlay.setVisible(debug);

  // Reused rows for the overlay: values are overwritten in place, nothing is allocated per frame.
  const overlayRows: [string, string | number][] = [
    ['fps', 0],
    ['frame p50', 0],
    ['frame p95', 0],
    ['draw calls', 0],
    ['triangles', 0],
    ['steps/frame', 0],
    ['dropped', 0],
    ['quality', quality],
  ];

  let running = false;
  let disposed = false;
  let contextLost = false;
  let rafId = 0;
  let hiddenTimer: ReturnType<typeof setInterval> | null = null;
  let lastTime = 0;
  let lastOverlay = 0;
  let lastDrawCalls = 0;
  let lastTriangles = 0;
  let width = 0;
  let height = 0;

  const now = () => performance.now();

  function resize() {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    if (w === width && h === height) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function refreshOverlay(t: number) {
    if (!overlay.visible || t - lastOverlay < OVERLAY_REFRESH_MS) return;
    lastOverlay = t;
    overlayRows[0][1] = Math.round(stats.fps());
    overlayRows[1][1] = `${stats.percentile(50).toFixed(1)} ms`;
    overlayRows[2][1] = `${stats.percentile(95).toFixed(1)} ms`;
    overlayRows[3][1] = lastDrawCalls;
    overlayRows[4][1] = lastTriangles;
    overlayRows[5][1] = loop.stepsLastAdvance;
    overlayRows[6][1] = loop.droppedSteps;
    overlayRows[7][1] = `${quality} @ ${renderer.getPixelRatio().toFixed(2)}x`;
    overlay.render(overlayRows);
  }

  function frame(t: number) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const frameDt = Math.min(MAX_FRAME_DT, Math.max(0, (t - lastTime) / 1000));
    lastTime = t;
    if (contextLost) return;

    stats.push(frameDt * 1000);
    loop.advance(frameDt);
    for (let i = 0; i < renderFns.length; i++) renderFns[i](loop.alpha, frameDt);

    resize();
    renderer.render(scene, camera);
    lastDrawCalls = renderer.info.render.calls;
    lastTriangles = renderer.info.render.triangles;
    refreshOverlay(t);
  }

  function hiddenTick() {
    const t = now();
    const dt = Math.max(0, (t - lastTime) / 1000);
    lastTime = t;
    loop.advance(dt, HIDDEN_MAX_STEPS);
  }

  function beginVisible() {
    if (hiddenTimer !== null) {
      clearInterval(hiddenTimer);
      hiddenTimer = null;
    }
    lastTime = now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  function beginHidden() {
    cancelAnimationFrame(rafId);
    if (hiddenTimer === null) hiddenTimer = setInterval(hiddenTick, 1000 / hiddenTickHz);
  }

  function onVisibilityChange() {
    if (!running) return;
    if (document.hidden) beginHidden();
    else beginVisible();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.code !== 'Backquote' || e.repeat) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    overlay.toggle();
    lastOverlay = 0;
  }

  function onContextLost(e: Event) {
    e.preventDefault(); // allow the browser to restore the context
    contextLost = true;
  }

  function onContextRestored() {
    // three.js re-creates its GPU state on restore; force a fresh size and shadow pass.
    contextLost = false;
    width = 0;
    height = 0;
    applyQuality();
  }

  function applyQuality() {
    const preset = QUALITY_PRESETS[quality];
    renderer.setPixelRatio(pixelRatioFor(quality, window.devicePixelRatio));
    width = 0; // force setSize at the new pixel ratio
    resize();

    const shadowsChanged = renderer.shadowMap.enabled !== preset.shadows;
    renderer.shadowMap.enabled = preset.shadows;
    renderer.shadowMap.needsUpdate = true;

    scene.traverse((obj) => {
      const light = obj as THREE.Light & { shadow?: THREE.LightShadow };
      if (light.isLight && light.shadow) {
        if (light.shadow.mapSize.x !== preset.shadowMapSize) {
          light.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
          light.shadow.map?.dispose();
          light.shadow.map = null;
        }
      }
      if (shadowsChanged) {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) m.needsUpdate = true; // recompile with or without shadow code
        }
      }
    });

    camera.far = preset.far;
    camera.updateProjectionMatrix();
  }

  applyQuality();
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', onVisibilityChange);
  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);

  const engine: Engine = {
    scene,
    camera,
    renderer,
    get simTime() {
      return loop.simTime;
    },
    get running() {
      return running;
    },
    get quality() {
      return quality;
    },
    onFixedUpdate(fn) {
      fixedFns.push(fn);
      return () => {
        const i = fixedFns.indexOf(fn);
        if (i >= 0) fixedFns.splice(i, 1);
      };
    },
    onRender(fn) {
      renderFns.push(fn);
      return () => {
        const i = renderFns.indexOf(fn);
        if (i >= 0) renderFns.splice(i, 1);
      };
    },
    start() {
      if (running || disposed) return;
      running = true;
      if (document.hidden) {
        lastTime = now();
        beginHidden();
      } else beginVisible();
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
      if (hiddenTimer !== null) {
        clearInterval(hiddenTimer);
        hiddenTimer = null;
      }
    },
    setQuality(preset) {
      if (!isQualityPreset(preset)) throw new Error(`setQuality: unknown preset "${preset}"`);
      if (preset === quality) return;
      quality = preset;
      applyQuality();
    },
    addStat(name, getter) {
      return overlay.addStat(name, getter);
    },
    setDebugOverlay(visible) {
      overlay.setVisible(visible);
      lastOverlay = 0;
    },
    info() {
      const mem = renderer.info.memory;
      return {
        fps: stats.fps(),
        frameMsP50: stats.percentile(50),
        frameMsP95: stats.percentile(95),
        drawCalls: lastDrawCalls,
        triangles: lastTriangles,
        geometries: mem.geometries,
        textures: mem.textures,
        programs: renderer.info.programs?.length ?? 0,
        stepsPerFrame: loop.stepsLastAdvance,
        droppedSteps: loop.droppedSteps,
        quality,
        pixelRatio: renderer.getPixelRatio(),
      };
    },
    dispose() {
      if (disposed) return;
      engine.stop();
      disposed = true;
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      canvas.removeEventListener('webglcontextlost', onContextLost, false);
      canvas.removeEventListener('webglcontextrestored', onContextRestored, false);
      overlay.dispose();
      fixedFns.length = 0;
      renderFns.length = 0;

      // Release everything the scene still references, then the renderer itself.
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
        for (const m of mats) {
          for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
          m.dispose();
        }
        const light = obj as THREE.DirectionalLight;
        light.shadow?.map?.dispose();
      });
      scene.clear();
      renderer.renderLists.dispose();
      renderer.dispose();
    },
  };
  return engine;
}
