/**
 * Icon-only update button at the RIGHT end of the sidebar-foot SoulMirror row
 * (list seat `sidebar.footer.action`, ordered after the entry): invisible
 * until a newer release is known, then a small circled arrow. One click runs
 * the full install-restart-reload chain; while busy the tooltip narrates the
 * phase and the icon pulses. The reloaded page re-checks as current and the
 * button removes itself.
 */
import { useSyncExternalStore } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { upgradeStore } from './upgrade-store.ts'

export function UpdateAction({ t }: { wide: boolean } & PropsLocale<typeof NS>) {
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
    <Tooltip label={label} delayMs={200}>
      <button
        type="button"
        className={`sm-update-fab${busy ? ' sm-busy' : ''}`}
        disabled={busy}
        aria-label={label}
        data-soulmirror-update-action={upgrade.latest}
        onClick={() => {
          if (busy || upgrade.latest === undefined) return
          void upgradeStore.run()
        }}
      >
        <span aria-hidden style={{ lineHeight: 1, fontSize: 12 }}>{busy ? '⏳' : '⬆'}</span>
      </button>
    </Tooltip>
  )
}
