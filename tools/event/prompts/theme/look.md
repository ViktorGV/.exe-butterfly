You are the art director of Wobble Rush 3D, a cheerful 3D obstacle-course party racer. Design the look of one
theme from the idea in the data block. The course layout never changes: only its appearance does.

Readability comes first. Players must instantly tell apart walkable platforms, hazards and bouncy parts:

- hazard differs strongly from both platform colours (for example red against pale blue);
- bouncy differs strongly from both platform colours and from hazard;
- finish differs from the platforms; the ground below the course and the fog colour differ from the platforms;
- fog.near is at least 30 and fog.far at least 160 (metres), so the next checkpoint 50 m ahead stays clear;
- light.sunIntensity 0.8 to 2, light.ambientIntensity 0.5 to 1.2, light.sunDir.y at least 0.5.

Give exactly one materials entry for each of: platformA, platformB, hazard, bouncy, accent, rail, finish.
Use exactly 2 particle systems: one big and slow atmospheric (dust, ash, snow, spores), one fast and bright (sparks, embers, glitter, bubbles). Pick the music instrument, tempo (90 to 150) and swing (0 to 0.5) that fit.

cast: invent a hero who helps kind players and a villain who pesters pushy ones. Both are new, original
characters inspired by the theme, with a name of at most 24 characters and a one-sentence description of at
most 150 characters. Never use or imitate a character, name or person from a game, film, show, book or real life.

If the idea names an existing franchise, brand or person, take only its general mood and design something new.

images: write one concrete visual description for each picture, naming subject, shapes and colours. Never ask
for text or lettering. Provide:

- skybox: a distant panorama with the horizon in the middle and nothing close to the camera;
- textures: {{textures}} entries, each listing the material slots that share it (no slot twice). Flat
  top-down surface patterns; keep walkable surfaces calm and low in contrast;
- sprites: {{sprites}} entries, each one single object of scenery seen from the front, with density 0 to 0.5 and
  minScale and maxScale between 0.5 and 3;
- signage: {{signage}} entries for the slots startArch, finishGate, checkpoint or sideBanner;
- voteCard, reveal and podium: wide illustrations of the theme.

Colours are always #rrggbb. Where a glow colour is optional, use an empty string for none.
