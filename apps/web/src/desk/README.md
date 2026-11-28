# desk

**Chain Reaction Desk**: a course look made for Flutter. The racers are tiny, racing across a giant creative desk
that has been set up as one big butterfly-effect machine. Every obstacle is a desk object at racer scale.
Demo: `apps/web/demos/desk-course.html` (`?course=b:spin-cycle&seg=3&mode=orbit`).

```ts
import { createDeskCourse } from '../desk/index.ts';

const desk = createDeskCourse({ courseDef });
scene.add(desk.root);
engine.onRender(() => desk.update(raceTime)); // same race time as the colliders
desk.sun.target.position.copy(cameraFocus); // keep the shadow box where the camera looks
desk.dispose();
```

Visual only: it reads the same `CourseDef` and obstacle registry (`getObstacleKind(kind).parts / pose`) as the
course runtime, and every piece is built in its part's frame at the part's size, so what you see is where the
collider is. Moving obstacles are posed every frame; static ones once.

| Obstacle         | Desk object                                                          |
| ---------------- | -------------------------------------------------------------------- |
| `platform`       | green cutting mat (`platformA`), lined notebook paper (other slots)  |
| `ramp`           | notebook with spiral binding                                         |
| `movingPlatform` | keyboard keycaps with letters                                        |
| `carousel`       | polaroid photos                                                      |
| `spinnerDisc`    | vinyl record with label and spindle                                  |
| `bridge`         | hexagonal pencil (eraser at the start, sharpened tip at the end)     |
| `sweeper`        | clock hands over a clock face, brass hub                             |
| `bumper`         | thread spool                                                         |
| `pendulum`       | chrome cradle ball on a string                                       |
| `gate`           | felt-tip marker pillars, wooden ruler crossbar, index-card doors     |
| `wall`           | stack of three dominoes                                              |
| `bouncePad`      | pink eraser with a paper sleeve                                      |
| `arrowTile`      | sticky note with a marker arrow (lime forward, coral back)           |
| `slidingWall`    | chrome toaster ends, toast slices popping up, slot rail on the floor |
| `snowBlower`     | desk-fan console with a cage and spinning blades                     |

Scenery (`scenery.ts`): the wooden desk below `killY`, stacks of books holding up the solid floors, paperclip
checkpoint arches with washi-tape pennants, a checkered finish strip, and giant desk objects for scale (monitor
showing flutter.exe at the far end, coffee mug with steam, desk lamp with a warm spot, pencil cup, plant,
scissors, ruler, sticky notes, paperclips). A domino chain topples down both sides in a wave, and paper
butterflies flutter over the course. All textures are drawn in code (`textures.ts`); materials are cached
(`materials.ts`).

Not done yet: it is a demo look, not wired into the game. Plugging it in means the course runtime skipping its
own base meshes (or a theme seam for whole-course art), and a pass on draw calls for phones: today every piece
is its own mesh (about 1,000 draw calls for the default course), fine on desktop but not on a phone.

## Villain: Crumple, the paper storm

`villain.ts`: in the butterfly effect a tiny flap grows into a storm, and Crumple is that storm: a giant grumpy
thundercloud of crumpled paper with folded-paper lightning bolts for arms and paper-strip rain. It floats over
the desk-fan section and throws crumpled paper balls; a red circle on the floor shows where each will land, and
the ball bursts into paper bits when it does. Visual only, like the course: who is thrown at stays the server's
call (`apps/web/src/villain`, #84). Demo: the **Villain** button on `desk-course.html`.

```ts
const crumple = createStormVillain();
scene.add(crumple.group);
crumple.throwAt(floorPoint, 1.3); // the server's throw message
engine.onRender((_a, dt) => crumple.update(raceTime, dt));
```
