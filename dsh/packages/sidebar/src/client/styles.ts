/**
 * The sidebar column's rules. There is no CSS-module pipeline in the tsdown
 * replica, so one `<style>` element is appended to the document once; every
 * colour is a `--dsw-*` token (set on the document by ui-layout / ui-theme),
 * so the column follows dsh's theme. The geometry mirrors the stock
 * ui-sidebar column (12px inline padding, 60px brand row, 38px New Session,
 * 56px rail) so ui-workspace / ui-settings / footer actions look unchanged.
 */
const STYLE_ID = 'soulmirror-sidebar-styles'

const CSS = `
.sn-sb {
  --dsh-sidebar-inline-padding: 12px;
  height: 100%; padding: 6px var(--dsh-sidebar-inline-padding); box-sizing: border-box;
  background: var(--dsw-specific-sidebar-fill); color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
  display: flex; flex-direction: column; font-size: 14px;
}
.sn-sb.sn-collapsed { padding: 18px 10px 6px; }
.sn-sb.sn-quiet { --dsh-scrollbar-thumb: transparent; --dsh-scrollbar-thumb-hover: transparent; }
.sn-sb.sn-fading > * { opacity: 0; transition: opacity .15s var(--ds-ease-in-out); }
.sn-wide { animation: sn-wide-in .2s var(--ds-ease-in-out); }
@keyframes sn-wide-in { 0% { opacity: 0; } }
.sn-railIn .sn-iconButton, .sn-railIn .sn-newSession, .sn-railIn .sn-region, .sn-railIn .sn-nav { animation: sn-rail-in .15s var(--ds-ease-in-out) backwards; }
.sn-railIn .sn-foot { animation: sn-rail-fade-in .15s var(--ds-ease-in-out) backwards; }
@keyframes sn-rail-in { 0% { opacity: 0; transform: translate(49px); } }
@keyframes sn-rail-fade-in { 0% { opacity: 0; } }

.sn-logoRow {
  box-sizing: border-box; flex: none; display: flex; align-items: center; justify-content: flex-end;
  gap: 8px; height: 60px; margin-bottom: 8px; padding: 8px 0 8px 4px; overflow: hidden;
}
.sn-collapsed .sn-logoRow { justify-content: flex-start; height: 36px; margin-bottom: 12px; padding: 0; }
.sn-brand {
  min-width: 0; color: inherit; cursor: pointer; background: none; border: none; flex: 1;
  align-items: center; padding: 0; display: inline-flex; overflow: hidden; font-family: inherit;
}
.sn-brandIdentity { align-items: center; gap: 8px; min-width: 0; height: 28px; display: inline-flex; }
.sn-brandMark { flex: none; justify-content: center; align-items: center; display: inline-flex; }
.sn-brandName { letter-spacing: .04em; align-items: baseline; gap: 6px; min-width: 0; height: 24px; font-size: 18px; font-weight: 600; line-height: 24px; display: inline-flex; white-space: nowrap; }
.sn-brandSub { font-size: 11px; font-weight: 500; letter-spacing: .08em; color: var(--dsw-alias-label-secondary); }
.sn-headerActions { flex: none; display: inline-flex; align-items: center; gap: 2px; }
.sn-iconButton {
  cursor: pointer; width: 28px; height: 28px; color: var(--dsw-alias-label-secondary); background: none;
  border: none; border-radius: 50%; flex: none; justify-content: center; align-items: center; padding: 0; display: inline-flex;
}
.sn-iconButton:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sn-collapsed .sn-iconButton { width: 36px; height: 36px; color: var(--dsw-alias-label-primary); }
.sn-collapsed .sn-toggle .sn-panelIcon { display: none; }
.sn-collapsed .sn-toggle:hover .sn-panelIcon { display: inline; }
.sn-collapsed .sn-toggle:hover .sn-railMark { display: none; }
.sn-railMark { justify-content: center; align-items: center; display: inline-flex; }
.sn-logoImg { display: block; border-radius: 22%; }

.sn-newSession {
  box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-button-elevated-fill);
  height: 38px; color: var(--dsw-alias-label-primary); cursor: pointer; border-radius: 12px; flex: none;
  justify-content: center; align-items: center; gap: 6px; margin: 0 2px 8px; padding: 8px 16px;
  font-size: 14px; font-weight: 500; line-height: 22px; display: flex; overflow: hidden; font-family: inherit;
}
.sn-newSession:hover { background: var(--dsw-alias-button-floating-hover); }
.sn-collapsed .sn-newSession { background: none; border-color: transparent; align-self: flex-start; gap: 0; width: 36px; height: 36px; margin: 0 0 12px; padding: 0; }
.sn-collapsed .sn-newSession:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sn-newSessionLabel { white-space: nowrap; max-width: 200px; overflow: hidden; }
.sn-collapsed .sn-newSessionLabel { max-width: 0; }

.sn-nav { flex: none; display: flex; flex-direction: column; gap: 2px; margin: 0 0 6px; }
.sn-nav:empty { display: none; }
.sn-collapsed .sn-nav { align-items: flex-start; margin-bottom: 8px; }

.sn-region {
  min-height: 0; margin-left: -4px; margin-right: calc(-1 * var(--dsh-sidebar-inline-padding));
  flex-direction: column; flex: 1; padding-left: 4px; display: flex; overflow: hidden;
}
.sn-collapsed .sn-region { margin-left: 0; margin-right: 0; padding-left: 0; }
.sn-foot { flex-direction: column; flex: none; display: flex; }
.sn-settings, .sn-footerActions { flex: none; width: 100%; min-width: 0; }
.sn-footerActions { display: flex; }
.sn-collapsed .sn-foot { align-items: center; }
.sn-collapsed .sn-settings, .sn-collapsed .sn-footerActions { justify-content: center; width: auto; display: flex; }
@media (prefers-reduced-motion: reduce) {
  .sn-wide, .sn-fading > *, .sn-railIn .sn-iconButton, .sn-railIn .sn-newSession, .sn-railIn .sn-foot, .sn-railIn .sn-region, .sn-railIn .sn-nav { transition: none; animation: none; }
}
`

export function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset['plugin'] = 'soulnet-dsh-sidebar'
  tag.textContent = CSS
  document.head.appendChild(tag)
}

export function removeStyles(): void {
  if (typeof document === 'undefined') return
  document.getElementById(STYLE_ID)?.remove()
}
