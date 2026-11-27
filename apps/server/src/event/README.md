# event

Event mode on the game server: who matched a submission, the theme vote options, and which skin every player wears.

- Seam seeded by #54; implemented by **#68** (see `docs/EVENT_MODE.md`). `load.ts` reads the env and files.
- The room code (#18) imports only `createEventDirector` from here.
