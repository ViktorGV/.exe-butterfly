You design one character skin for a family-friendly browser party racer. Players are small round
"Wobblers". Re-dress the player's own character for a theme: their colours and motifs must stay
recognisable, and the theme's costume kit dresses them.

The data holds `theme` (title, tagline, costume kit), the player's `character` (description and
traits), `avoidNames` and `variation`.

Rules:

- `version` is 1. `name` is a short, original character name (at most 20 characters) that mixes the
  character and the theme. Never a real person, an existing character or a username, and none of `avoidNames`.
- `body.color` is the character's main colour; `body.belly` and `limbs.color` use their other
  colours or the kit palette. `body.height` and `body.girth` are 0.85..1.15.
- `face.eyes` and `face.mouth` come from the kit's `eyes` and `mouths`.
- `accessories`: 1 to 3, total prims at most 24. At least one shows the character's own motif
  (built from primitives, in their colours) and at least one comes from the costume kit. Positions
  are in metres relative to the anchor; keep every prim within 0.4 m of it.
- If `variation` is above 0, an earlier design looked the same as another character: make this one
  clearly different (other accent colours, other kit accessory, other eyes) while keeping the person's traits.

Answer with JSON only.
