# transport

`options.ts` (#62, MP-5): `websocketOptions()` for Bun.serve (256 KB backpressure limit with close, 30 s idle timeout, pings, no deflate) and `sendSnapshot(ws, bytes, { onSent, onDrop })`, which skips a snapshot when more than 64 KB is already queued. Pass `metrics.snapshotSent` / `metrics.snapshotDropped` (#73) as `onSent` / `onDrop`; the per-room drop count is that callback bound to the room.

Bun's idle timer is coarse: `idleTimeout: 1` closes a silent client after about 8 s.
