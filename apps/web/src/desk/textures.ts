// Canvas textures for the Chain Reaction Desk, all drawn in code (original art). Each is made once and
// cached; callers clone them when they need their own repeat.
import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

function canvasTexture(
  key: string,
  size: number,
  draw: (g: CanvasRenderingContext2D, s: number) => void,
  repeat = false,
): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  cache.set(key, t);
  return t;
}

const repeatCache = new Map<string, THREE.Texture>();

/**
 * A copy of a repeating texture with its own repeat (shares the image). Repeats are rounded to 0.1 tile and
 * cached, so pieces of similar size share one texture and therefore one material (and can be merged).
 */
export function repeated(tex: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const qx = Math.max(0.1, Math.round(rx * 10) / 10);
  const qy = Math.max(0.1, Math.round(ry * 10) / 10);
  const key = `${tex.uuid}:${qx}:${qy}`;
  let t = repeatCache.get(key);
  if (!t) {
    t = tex.clone();
    t.repeat.set(qx, qy);
    t.needsUpdate = true;
    repeatCache.set(key, t);
  }
  return t;
}

/** Small seeded random so textures look the same every time. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** Green self-healing cutting mat: fine grid, bold every 5th line. One repeat = 4 m. */
export function cuttingMat(): THREE.CanvasTexture {
  return canvasTexture(
    'mat',
    512,
    (g, s) => {
      g.fillStyle = '#2f7a5a';
      g.fillRect(0, 0, s, s);
      const r = rng(3);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(255,255,255,${r() * 0.04})`;
        g.fillRect(r() * s, r() * s, 2, 2);
      }
      const step = s / 20;
      for (let i = 0; i <= 20; i++) {
        const bold = i % 5 === 0;
        g.strokeStyle = bold ? 'rgba(235,255,240,0.55)' : 'rgba(220,255,230,0.22)';
        g.lineWidth = bold ? 3 : 1.2;
        g.beginPath();
        g.moveTo(i * step, 0);
        g.lineTo(i * step, s);
        g.moveTo(0, i * step);
        g.lineTo(s, i * step);
        g.stroke();
      }
      g.strokeStyle = 'rgba(255,235,120,0.5)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(s, s);
      g.stroke();
    },
    true,
  );
}

/** Lined notebook paper with a red margin. One repeat = 4 m. */
export function linedPaper(): THREE.CanvasTexture {
  return canvasTexture(
    'paper',
    512,
    (g, s) => {
      g.fillStyle = '#fbf6e6';
      g.fillRect(0, 0, s, s);
      g.strokeStyle = '#8fb8e8';
      g.lineWidth = 2.5;
      for (let y = 32; y < s; y += 42) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(s, y);
        g.stroke();
      }
      g.strokeStyle = '#e8737a';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(70, 0);
      g.lineTo(70, s);
      g.stroke();
    },
    true,
  );
}

/** Warm desk wood grain. One repeat = 16 m. */
export function wood(): THREE.CanvasTexture {
  return canvasTexture(
    'wood',
    1024,
    (g, s) => {
      g.fillStyle = '#c18a58';
      g.fillRect(0, 0, s, s);
      const r = rng(11);
      for (let i = 0; i < 140; i++) {
        const y = r() * s;
        const dark = r() < 0.5;
        g.strokeStyle = dark ? `rgba(110,62,30,${0.08 + r() * 0.18})` : `rgba(255,220,170,${0.05 + r() * 0.1})`;
        g.lineWidth = 1 + r() * 5;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= s; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 6 + Math.sin(x * 0.043 + i * 3) * 2);
        g.stroke();
      }
      for (let i = 0; i < 4; i++) {
        const x = r() * s;
        const y = r() * s;
        for (let k = 1; k < 7; k++) {
          g.strokeStyle = `rgba(100,55,25,${0.22 - k * 0.025})`;
          g.lineWidth = 2;
          g.beginPath();
          g.ellipse(x, y, 10 * k, 4 * k, 0, 0, Math.PI * 2);
          g.stroke();
        }
      }
    },
    true,
  );
}

/** Cream clock face with numerals and ticks, seen from above (12 toward texture top). */
export function clockFace(): THREE.CanvasTexture {
  return canvasTexture('clock', 1024, (g, s) => {
    const c = s / 2;
    g.fillStyle = '#fdf3dc';
    g.beginPath();
    g.arc(c, c, c - 6, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 18;
    g.strokeStyle = '#c99a3e';
    g.stroke();
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const big = i % 5 === 0;
      const r1 = c - 30;
      const r2 = r1 - (big ? 46 : 20);
      g.strokeStyle = big ? '#2a2633' : '#7a7280';
      g.lineWidth = big ? 10 : 4;
      g.beginPath();
      g.moveTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1);
      g.lineTo(c + Math.sin(a) * r2, c - Math.cos(a) * r2);
      g.stroke();
    }
    g.fillStyle = '#2a2633';
    g.font = 'bold 92px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let h = 1; h <= 12; h++) {
      const a = (h / 12) * Math.PI * 2;
      g.fillText(String(h), c + Math.sin(a) * (c - 150), c - Math.cos(a) * (c - 150));
    }
    g.font = 'italic 44px Georgia, serif';
    g.fillStyle = '#b0453e';
    g.fillText('flutter', c, c + 150);
  });
}

/** Vinyl record seen from above: grooves, a coral label with a butterfly. */
export function vinyl(): THREE.CanvasTexture {
  return canvasTexture('vinyl', 1024, (g, s) => {
    const c = s / 2;
    g.fillStyle = '#141318';
    g.beginPath();
    g.arc(c, c, c - 2, 0, Math.PI * 2);
    g.fill();
    for (let r = c - 12; r > 190; r -= 5) {
      g.strokeStyle = r % 35 < 5 ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.045)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(c, c, r, 0, Math.PI * 2);
      g.stroke();
    }
    const sheen = g.createLinearGradient(0, 0, s, s);
    sheen.addColorStop(0.3, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    sheen.addColorStop(0.7, 'rgba(255,255,255,0)');
    g.fillStyle = sheen;
    g.beginPath();
    g.arc(c, c, c - 12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ff7b6b';
    g.beginPath();
    g.arc(c, c, 180, 0, Math.PI * 2);
    g.fill();
    butterfly(g, c, c - 30, 70, '#fff4e0', '#2b2440');
    g.fillStyle = '#2b2440';
    g.font = 'bold 40px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('FLUTTER', c, c + 95);
    g.font = '24px system-ui, sans-serif';
    g.fillText('side A · 33⅓', c, c + 130);
  });
}

/** A simple two-wing butterfly silhouette centred at (x, y). */
export function butterfly(g: CanvasRenderingContext2D, x: number, y: number, r: number, wing: string, body: string) {
  g.fillStyle = wing;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(x + s * r * 0.55, y - r * 0.25, r * 0.6, r * 0.45, s * -0.5, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(x + s * r * 0.42, y + r * 0.38, r * 0.4, r * 0.32, s * 0.5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = body;
  g.beginPath();
  g.ellipse(x, y, r * 0.09, r * 0.62, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = body;
  g.lineWidth = Math.max(2, r * 0.04);
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(x, y - r * 0.55);
    g.quadraticCurveTo(x + s * r * 0.2, y - r * 0.95, x + s * r * 0.32, y - r * 0.98);
    g.stroke();
  }
}

/** Keycap top: a soft dish with a printed letter. */
export function keycap(letter: string, ink: string): THREE.CanvasTexture {
  return canvasTexture(`key:${letter}:${ink}`, 256, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 10, s / 2, s / 2, s * 0.7);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#e6e1d6');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    g.fillStyle = ink;
    g.font = 'bold 120px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, s / 2, s / 2 + 6);
  });
}

/** Sticky note with a hand-drawn marker arrow pointing to the texture's top. */
export function stickyNote(paper: string, ink: string): THREE.CanvasTexture {
  return canvasTexture(`sticky:${paper}:${ink}`, 512, (g, s) => {
    g.fillStyle = paper;
    g.fillRect(0, 0, s, s);
    const top = g.createLinearGradient(0, 0, 0, s * 0.18);
    top.addColorStop(0, 'rgba(0,0,0,0.08)');
    top.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = top;
    g.fillRect(0, 0, s, s * 0.18);
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 46;
    g.beginPath();
    g.moveTo(s * 0.5, s * 0.84);
    g.bezierCurveTo(s * 0.46, s * 0.62, s * 0.54, s * 0.45, s * 0.5, s * 0.3);
    g.stroke();
    g.beginPath();
    g.moveTo(s * 0.5, s * 0.1);
    g.lineTo(s * 0.77, s * 0.4);
    g.lineTo(s * 0.23, s * 0.4);
    g.closePath();
    g.fill();
    g.stroke();
  });
}

/** Inside of a slice of toast: golden, with air holes. */
export function toast(): THREE.CanvasTexture {
  return canvasTexture('toast', 512, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 40, s / 2, s / 2, s * 0.7);
    grad.addColorStop(0, '#f2d08a');
    grad.addColorStop(0.75, '#e2a654');
    grad.addColorStop(1, '#b9742f');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    const r = rng(21);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(150,90,30,${0.15 + r() * 0.25})`;
      g.beginPath();
      g.ellipse(r() * s, r() * s, 2 + r() * 7, 1 + r() * 4, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Wooden ruler face with cm ticks and numbers along the texture's width. */
export function ruler(): THREE.CanvasTexture {
  return canvasTexture(
    'ruler',
    1024,
    (g, s) => {
      g.fillStyle = '#e7c27a';
      g.fillRect(0, 0, s, s);
      const r = rng(5);
      for (let i = 0; i < 40; i++) {
        g.strokeStyle = `rgba(150,100,40,${0.08 + r() * 0.1})`;
        g.lineWidth = 2 + r() * 6;
        const y = r() * s;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(s, y + r() * 20 - 10);
        g.stroke();
      }
      g.fillStyle = '#2a2420';
      g.font = 'bold 70px system-ui, sans-serif';
      g.textAlign = 'center';
      for (let i = 0; i < 40; i++) {
        const x = (i / 40) * s;
        const big = i % 4 === 0;
        g.fillRect(x, 0, 4, big ? s * 0.42 : s * 0.22);
        if (big) g.fillText(String((i / 4) | 0), x + 26, s * 0.62);
      }
    },
    true,
  );
}

/** Domino face seen from above: two halves with pips. */
export function dominoFace(a: number, b: number): THREE.CanvasTexture {
  return canvasTexture(`domino:${a}:${b}`, 512, (g, s) => {
    g.fillStyle = '#1b1a20';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#d9d4c8';
    g.fillRect(s / 2 - 4, s * 0.12, 8, s * 0.76);
    const spots: Record<number, [number, number][]> = {
      0: [],
      1: [[0.5, 0.5]],
      2: [
        [0.25, 0.25],
        [0.75, 0.75],
      ],
      3: [
        [0.25, 0.25],
        [0.5, 0.5],
        [0.75, 0.75],
      ],
      4: [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ],
      5: [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.5, 0.5],
        [0.25, 0.75],
        [0.75, 0.75],
      ],
      6: [
        [0.25, 0.2],
        [0.75, 0.2],
        [0.25, 0.5],
        [0.75, 0.5],
        [0.25, 0.8],
        [0.75, 0.8],
      ],
    };
    for (const [half, n] of [
      [0, a],
      [1, b],
    ] as const) {
      for (const [u, v] of spots[n] ?? []) {
        g.fillStyle = '#f7f2e6';
        g.beginPath();
        g.arc(half * (s / 2) + u * (s / 2), v * s, s * 0.05, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
}

/** Polaroid photo: white frame, a little painted scene. */
export function polaroid(variant: number): THREE.CanvasTexture {
  return canvasTexture(`polaroid:${variant}`, 512, (g, s) => {
    g.fillStyle = '#fbfaf6';
    g.fillRect(0, 0, s, s);
    const x = s * 0.07;
    const y = s * 0.07;
    const w = s * 0.86;
    const h = s * 0.72;
    const skies = [
      ['#ffb37a', '#ff6f8e'],
      ['#7ad0ff', '#c6f0ff'],
    ];
    const [a, b] = skies[variant % 2];
    const sky = g.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, a);
    sky.addColorStop(1, b);
    g.fillStyle = sky;
    g.fillRect(x, y, w, h);
    g.fillStyle = variant % 2 ? '#4fb36e' : '#5a3d7a';
    g.beginPath();
    g.moveTo(x, y + h);
    g.quadraticCurveTo(x + w * 0.3, y + h * 0.55, x + w * 0.6, y + h * 0.8);
    g.quadraticCurveTo(x + w * 0.85, y + h * 0.6, x + w, y + h * 0.75);
    g.lineTo(x + w, y + h);
    g.fill();
    butterfly(g, x + w * 0.55, y + h * 0.35, s * 0.12, variant % 2 ? '#ffcf3f' : '#7af0d0', '#2b2440');
    g.fillStyle = '#4a4458';
    g.font = 'italic 34px Georgia, serif';
    g.textAlign = 'center';
    g.fillText(variant % 2 ? 'first flap' : 'the storm', s / 2, s * 0.92);
  });
}

/** Lined index card (for gate doors). */
export function indexCard(): THREE.CanvasTexture {
  return canvasTexture('card', 512, (g, s) => {
    g.fillStyle = '#fffdf6';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = '#e8737a';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(0, s * 0.18);
    g.lineTo(s, s * 0.18);
    g.stroke();
    g.strokeStyle = '#9cc4ee';
    g.lineWidth = 3;
    for (let y = s * 0.3; y < s; y += s * 0.11) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(s, y);
      g.stroke();
    }
  });
}

/** Black and white checks for the finish strip. */
export function checker(): THREE.CanvasTexture {
  return canvasTexture(
    'checker',
    256,
    (g, s) => {
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          g.fillStyle = (i + j) % 2 ? '#1d1b22' : '#fbf8f0';
          g.fillRect((i * s) / 4, (j * s) / 4, s / 4, s / 4);
        }
    },
    true,
  );
}

/** Monitor screen: flutter.exe with a big butterfly. */
export function screen(): THREE.CanvasTexture {
  return canvasTexture('screen', 1024, (g, s) => {
    const bg = g.createLinearGradient(0, 0, s, s);
    bg.addColorStop(0, '#2a1f5c');
    bg.addColorStop(1, '#0f5a7a');
    g.fillStyle = bg;
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#d8d4f0';
    g.fillRect(0, 0, s, 70);
    g.fillStyle = '#2a2540';
    g.font = 'bold 40px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('flutter.exe', 30, 36);
    for (const [i, c] of ['#ff6b6b', '#ffd34d', '#5bd17a'].entries()) {
      g.fillStyle = c;
      g.beginPath();
      g.arc(s - 40 - i * 50, 36, 15, 0, Math.PI * 2);
      g.fill();
    }
    butterfly(g, s / 2, s * 0.52, s * 0.3, '#ff8fd0', '#1a1430');
    g.fillStyle = '#ffffff';
    g.font = 'bold 60px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('one flap. one storm.', s / 2, s * 0.9);
  });
}

/** Paper butterfly wing (one side) with a printed pattern; the body side is the texture's left edge. */
export function wing(hue: number): THREE.CanvasTexture {
  return canvasTexture(`wing:${hue}`, 256, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.fillStyle = `hsl(${hue} 85% 62%)`;
    g.beginPath();
    g.moveTo(0, s * 0.5);
    g.bezierCurveTo(s * 0.2, -s * 0.05, s * 1.0, s * 0.0, s * 0.92, s * 0.42);
    g.bezierCurveTo(s * 0.85, s * 0.6, s * 0.7, s * 0.95, s * 0.35, s * 0.95);
    g.bezierCurveTo(s * 0.15, s * 0.9, s * 0.05, s * 0.7, 0, s * 0.5);
    g.fill();
    g.fillStyle = `hsl(${(hue + 40) % 360} 90% 80%)`;
    g.beginPath();
    g.arc(s * 0.6, s * 0.32, s * 0.12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(30,20,50,0.55)';
    g.beginPath();
    g.arc(s * 0.6, s * 0.32, s * 0.05, 0, Math.PI * 2);
    g.fill();
  });
}
