# racers

Racer concepts: five original kart-racer characters, sculpted entirely in code. Demo: `apps/web/demos/racers.html`
(`?view=pip|kappi|spinny|zara|grizzle` opens one racer; "Save PNG" downloads the current view).

| Racer              | Archetype        | Theme          | Palette             |
| ------------------ | ---------------- | -------------- | ------------------- |
| Pip Glimmerfin     | Friendly alien   | Deep-sea diver | Mint & coral        |
| Kappi Kurokawa     | Capybara         | Samurai        | Royal purple & gold |
| Spinny Glitterbolt | Whimsical robot  | Disco dancer   | Pastel neon         |
| Zara Dunewhistle   | Stylised human   | Desert nomad   | Bright primaries    |
| Grizzle Fuzzbang   | Friendly monster | Punk rocker    | Mint & coral        |

## How a racer is made

1. `cast/<racer>.ts` sculpts the racer like clay: signed distance shapes (`sdf.ts`) are added or carved one
   after another and blend smoothly into each other. Every shape names a material (colour and finish).
2. `mesher.ts` turns the blended field into one smooth mesh (Surface Nets). Each vertex takes the colour and
   finish of the nearest shape, a normal from the field and ambient occlusion measured from the field.
3. `material.ts` renders all of it with one physical material whose roughness, metalness, clearcoat and glow
   vary per vertex: glossy toy plastic, soft fabric, brass and glowing parts in one draw call.
4. `kit.ts` holds the parts every racer shares: A-pose arms, chunky gloves, boots and big glossy toy eyes
   (separate meshes, so they stay crisp).

Racers stand in a symmetrical A-pose, feet at the origin, facing -Z. They are concept models for a character
sheet, not game-ready: about 250k triangles each and several seconds to sculpt.

## Moves

Demo: `apps/web/demos/racer-moves.html` (`?racer=<id>&action=<id>&t=<seconds>` opens one moment, paused).

Every racer is skinned to the 11-bone skeleton in `bones.ts`: each sculpted shape names its bone
(`b.bone(...)` in the cast files; the kit's arms, gloves and boots tag themselves), and the mesher gives each
vertex up to 4 bone weights from the nearest shapes, so the clay bends smoothly at the neck, shoulders, elbows,
hips and ankles. Eyes and head extras ride on the head bone.

`anim.ts` holds the actions as looping key poses (eased between) plus procedural motion:

- Idle, Run (waddling cycle), Jump, Dive (launch, belly slide, get up)
- Fall (knocked onto the back, flailing, get up) and Get up (alone, from lying on the back, in 2 s)
- Push: the chosen racer shoves the next racer from the front, who stumbles back and falls over
- Pushed from behind / from the side: the chosen racer is shoved by the next racer and face-plants, or tips
  over onto its side, then gets up
- Help up: about 1 s to pull a fallen racer up, then both turn and run on with the race

`PAIR_LAYOUT` places the two racers of a pair move. Arm poses are directions for the right arm in the spine's
space, mirrored for the left.
