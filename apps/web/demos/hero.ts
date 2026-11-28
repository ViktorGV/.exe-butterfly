// Demo page for the hero's bridge (#84): a snow-blower field and the bridge unrolling across it.
import * as THREE from 'three';
import { createEngine } from '../src/engine/index.ts';
import { bridgeSpan, createHeroBridge } from '../src/hero/index.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = createEngine({ canvas });
const { scene, camera } = engine;

scene.background = new THREE.Color('#bfe9ff');
scene.add(new THREE.HemisphereLight('#ffffff', '#8fb4c9', 1.1));
const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
sun.position.set(-12, 24, 10);
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.BoxGeometry(60, 1, 60),
  new THREE.MeshStandardMaterial({ color: '#7ad7ff', roughness: 0.6 }),
);
floor.position.set(0, -0.5, -30);
scene.add(floor);

const span = bridgeSpan({
  entities: [0, 1, 2, 3].map((k) => ({
    id: k,
    kind: 'snowBlower' as const,
    pos: [k % 2 === 0 ? -30 : 30, 0, -8 - k * 12] as [number, number, number],
    yaw: k % 2 === 0 ? 0 : Math.PI,
    params: { reach: 60, width: 11.5, windSpeed: 5 },
  })),
})!;

const bridge = createHeroBridge({ scene });
camera.position.set(0, 14, 8);
camera.lookAt(0, 0, -28);

document.getElementById('open')!.addEventListener('click', () => bridge.open(span, performance.now()));
engine.onRender(() => bridge.update(performance.now()));
engine.start();
