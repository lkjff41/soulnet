/**
 * Sidebar-foot upgrade button (list seat `sidebar.footer.action`, stacked
 * above the SoulMirror entry): hidden until a newer release is known, then a
 * brand-colored one-click button. One click runs the full
 * install-restart-reload chain; the label narrates each phase live, and the
 * button removes itself once the reloaded page re-checks as current.
 */
import { useSyncExternalStore } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { upgradeStore } from './upgrade-store.ts'

export function UpdateAction({ wide, t }: { wide: boolean } & PropsLocale<typeof NS>) {
  const upgrade = useSyncExternalStore(upgradeStore.subscribe, upgradeStore.getSnapshot)
  const busy = upgrade.phase === 'installing' || upgrade.phase === 'restarting' || upgrade.phase === 'reloading'
  if (!upgrade.hasUpdate && !busy) return null
  const label = busy
    ? upgrade.phase === 'installing'
      ? t('page.update.installing', { v: upgrade.latest ?? '' })
      : upgrade.phase === 'restarting'
        ? t('page.update.restarting')
        : t('page.update.reloading')
    : t('sidebar.update', { v: upgrade.latest ?? '' })
  return (
    <Tooltip label={label} delayMs={300} disabled={wide}>
      <button
        type="button"
        className={`sm-footer sm-update-action${wide ? '' : ' sm-rail'}`}
        disabled={busy}
        data-soulmirror-update-action={upgrade.latest}
        onClick={() => {
          if (busy || upgrade.latest === undefined) return
          void upgradeStore.run()
        }}
      >
        <span aria-hidden style={{ fontSize: wide ? 14 : 16, lineHeight: 1 }}>{busy ? '⏳' : '⬆'}</span>
        {wide ? <span className="sm-footer-label">{label}</span> : null}
      </button>
    </Tooltip>
  )
}
