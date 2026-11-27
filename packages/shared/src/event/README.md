# event

Event mode helpers shared by the event pipeline (`tools/event`), the game server and the client.

- Seam seeded by #54. `normalizeUsername` and `rosterKey` are real and frozen (the pipeline and the server must derive the same keys).
- `skinSignature` and `randomThemedSkin` are stubs, replaced by **#68**.
