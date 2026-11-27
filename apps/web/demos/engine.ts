// Demo page for the engine core (#3): a lit test scene with shadows, quality presets,
// the debug overlay, a 400-object stress test and dispose-and-recreate.
import * as THREE from 'three';
import { DEFAULT_QUALITY, createEngine, type Engine, type QualityPreset } from '../src/engine/index.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const PALETTE = ['#ff8a3d', '#7ad7ff', '#b49cff', '#5cf2a4', '#ffd23f', '#ff6bd5'];

interface Demo {
  engine: Engine;
  fixedSteps: number;
  addObjects(n: number): void;
  clearObjects(): void;
}

let demo: Demo;
let quality: QualityPreset = DEFAULT_QUALITY;

function buildDemo(): Demo {
  const engine = createEngine({ canvas, quality, debug: true });
  const { scene, camera } = engine;

  scene.background = new THREE.Color('#bfe9ff');
  scene.fog = new THREE.Fog('#bfe9ff', 40, 160);
  scene.add(new THREE.HemisphereLight('#ffffff', '#8fb4c9', 1.1));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
  sun.position.set(-12, 24, 10);
  sun.castShadow = true;
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.CylinderGeometry(26, 26, 1, 64),
    new THREE.MeshStandardMaterial({ color: '#7ad7ff', roughness: 0.6 }),
  );
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  scene.add(ground);

  // Spun on the fixed step: identical motion at any frame rate.
  const ring = new THREE.Group();
  const barGeo = new THREE.CylinderGeometry(0.35, 0.35, 12, 16);
  const barMat = new THREE.MeshStandardMaterial({ color: '#ff4f6d', roughness: 0.4 });
  for (let i = 0; i < 2; i++) {
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.rotation.z = Math.PI / 2;
    bar.rotation.y = (i * Math.PI) / 2;
    bar.position.y = 0.6;
    bar.castShadow = true;
    ring.add(bar);
  }
  scene.add(ring);

  // Moves on the fixed step, drawn interpolated with alpha.
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 32, 16),
    new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.3 }),
  );
  ball.castShadow = true;
  scene.add(ball);
  const prev = new THREE.Vector3();
  const curr = new THREE.Vector3();

  const objects = new THREE.Group();
  scene.add(objects);
  const shared = {
    geos: [
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.SphereGeometry(0.6, 20, 12),
      new THREE.CapsuleGeometry(0.4, 0.6, 6, 12),
    ],
    mats: PALETTE.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 })),
  };

  camera.position.set(0, 14, 24);
  camera.lookAt(0, 0, 0);

  const state: Demo = {
    engine,
    fixedSteps: 0,
    addObjects(n) {
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(shared.geos[i % 3], shared.mats[i % shared.mats.length]);
        const a = Math.random() * Math.PI * 2;
        const r = 4 + Math.random() * 20;
        m.position.set(Math.cos(a) * r, 0.5 + Math.random() * 3, Math.sin(a) * r);
        m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        m.castShadow = true;
        objects.add(m);
      }
    },
    clearObjects() {
      objects.clear();
    },
  };

  engine.onFixedUpdate((_dt, t) => {
    state.fixedSteps++;
    ring.rotation.y = t * ((12 * Math.PI * 2) / 60); // 12 rpm
    prev.copy(curr);
    curr.set(Math.cos(t * 1.3) * 9, 1 + Math.abs(Math.sin(t * 3)) * 3, Math.sin(t * 1.3) * 9);
  });
  engine.onRender((alpha) => {
    ball.position.lerpVectors(prev, curr, alpha);
  });
  engine.addStat('sim time', () => `${engine.simTime.toFixed(2)} s`);
  engine.addStat('objects', () => objects.children.length);

  engine.start();
  return state;
}

function syncButtons() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-quality]')) {
    b.setAttribute('aria-pressed', String(b.dataset.quality === demo.engine.quality));
  }
  document.getElementById('pause')!.setAttribute('aria-pressed', String(!demo.engine.running));
}

demo = buildDemo();
syncButtons();

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-quality]')) {
  b.addEventListener('click', () => {
    quality = b.dataset.quality as QualityPreset;
    demo.engine.setQuality(quality);
    syncButtons();
  });
}
document.getElementById('stress')!.addEventListener('click', () => demo.addObjects(400));
document.getElementById('clear')!.addEventListener('click', () => demo.clearObjects());
document.getElementById('pause')!.addEventListener('click', () => {
  if (demo.engine.running) demo.engine.stop();
  else demo.engine.start();
  syncButtons();
});
document.getElementById('recreate')!.addEventListener('click', () => {
  demo.engine.dispose();
  demo = buildDemo();
  syncButtons();
});

// Hook for automated checks (Playwright) and manual poking in the console.
(window as unknown as { __engineDemo: () => Demo }).__engineDemo = () => demo;
