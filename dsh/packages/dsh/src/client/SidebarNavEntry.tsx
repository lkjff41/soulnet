/**
 * `sidebar.nav.primary` entry (soulnet-dsh-sidebar installed): the "SoulMirror"
 * navigation row under New Session — icon + label + unread pill wide, icon +
 * red dot in the rail. Same behaviour as the foot entry (./SidebarEntry.tsx):
 * toggles the SoulMirror page. When this seat exists the foot entry hides
 * itself (./nav-seat.ts), so the entry shows once.
 */
import { useSyncExternalStore } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarNavPrimaryOwnerProps } from 'soulnet-dsh-sidebar/client'
import { networkStore } from './api.ts'
import type { NS } from './locales.ts'
import { pageStore } from './page-store.ts'
import { SoulMirrorIcon } from './SidebarEntry.tsx'

export type SidebarNavEntryProps = SidebarNavPrimaryOwnerProps & PropsLocale<typeof NS>

export function SidebarNavEntry({ wide, t }: SidebarNavEntryProps) {
  const net = useSyncExternalStore(networkStore.subscribe, networkStore.getSnapshot)
  const page = useSyncExternalStore(pageStore.subscribe, pageStore.getSnapshot)
  void net // subscribed for live status; read-state is deliberately NOT surfaced (owner's call)
  const label = t('sidebar.entry')

  return (
    <Tooltip label={label} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={`sm-nav${wide ? '' : ' sm-rail'}${page.open ? ' sm-nav-active' : ''}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={page.open}
        data-soulmirror-nav
        onClick={() => { pageStore.toggle() }}
      >
        <span className="sm-footer-icon">
          <SoulMirrorIcon size={wide ? 16 : 18} />
        </span>
        {wide ? <span className="sm-footer-label">{t('sidebar.entry')}</span> : null}
      </button>
    </Tooltip>
  )
}
