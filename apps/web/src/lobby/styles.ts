// Lobby styles (#12): phone-first (360 px up), one column that widens to two on tablets.
export const LOBBY_CSS = `
.wl-root{--wl-bg:#fff8ee;--wl-fg:#2a2238;--wl-card:#ffffff;--wl-accent:#ff7a3d;--wl-muted:#776d86;
  display:flex;flex-direction:column;gap:12px;padding:12px 16px calc(84px + env(safe-area-inset-bottom));
  max-width:960px;margin:0 auto;color:var(--wl-fg);font:15px/1.4 system-ui,sans-serif;box-sizing:border-box}
@media (prefers-color-scheme:dark){.wl-root{--wl-bg:#1c1826;--wl-fg:#f3eefc;--wl-card:#2a2438;--wl-muted:#b6acc8}}
.wl-root *{box-sizing:border-box}
.wl-root h2,.wl-root h3{margin:0 0 8px}
.wl-header{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.wl-code{flex:1 1 auto;font-size:20px;margin:0}
.wl-count{font-variant-numeric:tabular-nums;color:var(--wl-muted)}
.wl-banner{flex-basis:100%;margin:0;padding:8px 12px;border-radius:10px;background:var(--wl-card);font-weight:600}
.wl-card{background:var(--wl-card);border-radius:14px;padding:12px}
.wl-btn{min-height:44px;padding:0 14px;border-radius:10px;border:2px solid transparent;background:#e9e3f2;color:#2a2238;
  font:inherit;font-weight:600;cursor:pointer}
.wl-btn:focus-visible{outline:3px solid var(--wl-accent);outline-offset:2px}
.wl-btn:disabled{opacity:.55;cursor:default}
.wl-primary{background:var(--wl-accent);color:#fff}
.wl-tile{display:flex;align-items:flex-end;min-height:64px;padding:6px;text-align:left;
  background:linear-gradient(135deg,var(--sw,#999),var(--sw2,var(--sw,#999)));color:#fff;text-shadow:0 1px 2px #0008}
.wl-tile.on,.wl-vote.on{border-color:var(--wl-accent)}
.wl-gallery,.wl-theme-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin-bottom:8px}
.wl-gen-row{display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:8px}
.wl-prompt{grid-column:1/-1;min-height:64px;padding:8px;border-radius:10px;font:inherit;resize:vertical}
.wl-counter{align-self:center;color:var(--wl-muted);font-size:13px}
.wl-gen{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}
.wl-msg{margin:0;flex-basis:100%}.wl-msg.warn{color:#c2410c}.wl-msg.busy{animation:wl-pulse 1s infinite alternate}
@keyframes wl-pulse{to{opacity:.5}}
.wl-preview{width:96px;height:96px;border-radius:50%}
.wl-hint{margin:0 0 8px;font-weight:600}
.wl-countdown{font-variant-numeric:tabular-nums;font-weight:700}
.wl-vote-grid{display:grid;grid-template-columns:1fr;gap:8px}
.wl-vote{display:grid;grid-template-columns:72px 1fr auto;grid-auto-rows:auto;gap:2px 10px;padding:8px;text-align:left;
  position:relative;overflow:hidden;background:var(--wl-bg);color:var(--wl-fg);min-height:88px}
.wl-vote img{grid-row:1/span 5;width:72px;height:72px;object-fit:cover;border-radius:8px}
.wl-tag,.wl-credit,.wl-mine{font-size:13px;font-weight:400;color:var(--wl-muted)}
.wl-mine{color:var(--wl-accent)}
.wl-sw{display:flex;gap:3px}.wl-sw span{width:14px;height:14px;border-radius:4px}
.wl-bar{grid-column:2/-1;height:6px;border-radius:3px;background:var(--wl-accent);width:0;transition:width .25s linear}
.wl-tally{position:absolute;top:8px;right:10px;font-variant-numeric:tabular-nums}
.reveal .wl-vote:not(.win){opacity:.45}
.reveal .wl-vote.win{animation:wl-pop .6s ease-out}
@keyframes wl-pop{0%{transform:scale(.92)}60%{transform:scale(1.04)}100%{transform:none}}
.wl-list{position:relative;height:min(50vh,360px);overflow-y:auto;contain:strict}
.wl-spacer{width:1px}
.wl-row{position:absolute;left:0;right:0;top:0;height:44px;display:flex;align-items:center;gap:8px;padding:0 6px;will-change:transform}
.wl-row.me{font-weight:700}
.wl-swatch{width:20px;height:20px;border-radius:50%;background:var(--wl-accent)}
.wl-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-badge{font-size:12px;padding:2px 6px;border-radius:6px;background:#ffd56b;color:#2a2238}
.wl-ready{color:var(--wl-muted)}.wl-ready.on{color:#15803d;font-weight:700}
.wl-chips{display:inline-block;padding:4px 10px;border-radius:999px;background:var(--wl-bg)}
.wl-footer{position:fixed;left:0;right:0;bottom:0;display:flex;gap:8px;justify-content:center;
  padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:var(--wl-card);box-shadow:0 -2px 10px #0002}
.wl-footer .wl-btn{flex:1;max-width:240px}
@media (min-width:720px){.wl-root{display:grid;grid-template-columns:1fr 1fr}.wl-header{grid-column:1/-1}
  .wl-vote-grid{grid-template-columns:1fr 1fr}}
`;
