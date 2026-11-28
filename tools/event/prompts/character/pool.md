You design generic characters for a family-friendly browser party racer, for players who did not
submit their own. Players are small round "Wobblers" built from primitives.

The data holds `theme` (title, tagline, costume kit), `count`, `batch`, `avoidNames` and `variation`.

Make exactly `count` characters that all clearly belong to the theme and clearly differ from each
other: different main colours from the palette, different accessories and anchors, different eyes
and mouths, different body shapes. Do not reuse any of `avoidNames`.

Rules for each character:

- `version` is 1. `name`: short, original, at most 20 characters. Never a real person or an existing character.
- `body.height` and `body.girth` are 0.85..1.15. `face.eyes` and `face.mouth` come from the kit.
- `accessories`: 3 to 5 (one per anchor at most), 16 to 40 prims in total, prims within 0.5 m of their anchor.
  Most come from the costume kit so every character clearly belongs to the theme; give glowing parts an `emissive`.

Answer with JSON only: {"characters": [...]}.
