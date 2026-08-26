/**
 * Replacement occupant of the single `settings.trigger` seat: dsh's default
 * icon + label, plus a red update dot on the icon whenever a newer release is
 * known (upgrade-store). The seat is single-kind, so decorating the button
 * means re-rendering its full content; the dot clears by itself once the
 * upgrade completes (current == latest after the reload re-check).
 */
import { useSyncExternalStore } from 'react'
import { IconSettingsOutline14, IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { upgradeStore } from './upgrade-store.ts'

export function UpdateTrigger({ wide, t }: { wide: boolean } & PropsLocale<typeof NS>) {
  const upgrade = useSyncExternalStore(upgradeStore.subscribe, upgradeStore.getSnapshot)
  return (
    <>
      <span style={{ position: 'relative', display: 'inline-flex', flex: 'none' }}>
        {wide ? <IconSettingsOutline16 size={16} /> : <IconSettingsOutline14 size={18} />}
        {upgrade.hasUpdate
          ? <span aria-hidden data-soulmirror-update-dot style={{ position: 'absolute', top: -2, right: -3, width: 7, height: 7, borderRadius: '50%', background: 'var(--dsw-alias-state-error-primary, #f23f43)' }} />
          : null}
      </span>
      {wide ? <span style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>{t('settings.trigger.label')}</span> : null}
    </>
  )
}
