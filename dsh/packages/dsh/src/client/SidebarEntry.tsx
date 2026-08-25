/**
 * `sidebar.footer.action` entry: the "SoulMirror" button at the sidebar foot
 * (stacked above Settings in both widths). Wide: icon + label + unread pill;
 * rail: icon + red dot. Clicking toggles the SoulMirror page
 * (./SoulmirrorPage.tsx, a `shell.overlay` entry that fills the frame right
 * of this sidebar). The unread number is the sum over all friends, folded
 * live from the host SSE stream.
 */
import { useSyncExternalStore } from 'react'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { networkStore } from './api.ts'
import type { NS } from './locales.ts'
import { navSeatStore } from './nav-seat.ts'
import { pageStore } from './page-store.ts'

export type SidebarEntryProps = SidebarFooterActionOwnerProps & PropsLocale<typeof NS>

/** The SoulMirror glyph: a mirror (rounded frame) with a reflected spark. */
export function SoulMirrorIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M8 1.2c-3.2 0-5.6 2.6-5.6 6.1 0 2.9 1.7 5.3 4.2 6.1v1.4h2.8v-1.4c2.5-.8 4.2-3.2 4.2-6.1 0-3.5-2.4-6.1-5.6-6.1Zm0 1.4c2.4 0 4.2 2 4.2 4.7S10.4 12 8 12 3.8 10 3.8 7.3 5.6 2.6 8 2.6Z" fill="currentColor" />
      <path d="M8.6 4.2 9.2 5.8l1.6.6-1.6.6-.6 1.6L8 7l-1.6-.6L8 5.8l.6-1.6Z" fill="currentColor" />
    </svg>
  )
}

export function SidebarEntry({ wide, t }: SidebarEntryProps) {
  const net = useSyncExternalStore(networkStore.subscribe, networkStore.getSnapshot)
  const page = useSyncExternalStore(pageStore.subscribe, pageStore.getSnapshot)
  const navClaimed = useSyncExternalStore(navSeatStore.subscribe, navSeatStore.getSnapshot)
  void net // subscribed for live status; read-state is deliberately NOT surfaced (owner's call)
  // The SoulMirror sidebar shows this entry in its primary nav instead (./SidebarNavEntry.tsx).
  if (navClaimed) return null
  const label = t('sidebar.entry')

  return (
    <Tooltip label={label} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={`sm-footer${wide ? '' : ' sm-rail'}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={page.open}
        data-soulmirror-footer
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
