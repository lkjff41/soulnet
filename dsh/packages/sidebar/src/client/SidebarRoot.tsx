/**
 * The SoulMirror sidebar column: the occupant of the layout's `sidebar` seat.
 *
 * Same skeleton and fold state machine as dsh's stock column (brand row with
 * the fold toggle, New Session, the workspace/session browser region, the
 * foot with footer actions + Settings; collapse = crossfade + slide into the
 * 56px rail), plus two seats of our own: `sidebar.header.action` (icon
 * buttons in the brand row, wide only) and `sidebar.nav.primary` (navigation
 * rows under New Session, icon-only in the rail). Everything between New
 * Session and the foot is still the `sidebar.workspaces` registrant's
 * (ui-workspace), the foot still holds `sidebar.footer.action` + `sidebar.settings`.
 */
import { useEffect, useRef, useState } from 'react'
import type { SidebarRootInjected } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { IconNewChatOutline16, IconPanelLeftOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SoulmirrorBrandMark } from './brand.tsx'
import type { NS } from './locales.ts'
import type {} from './slots.ts'

/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
const COLLAPSE_SETTLE_MS = 150
/** How long the column's scrollbars stay drawn after the pointer leaves it. */
const SCROLLBAR_LINGER_MS = 2000

export type SidebarRootProps = PropsRuntime<'sidebar'>
  & PropsRenderSlots<'sidebar.brand.mark' | 'sidebar.brand.name' | 'sidebar.workspaces' | 'sidebar.settings' | 'sidebar.footer.action' | 'sidebar.nav.primary' | 'sidebar.header.action'>
  & SidebarRootInjected
  & PropsLocale<typeof NS>

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function SidebarRoot({ collapsed, width, startSession, toggleSidebar, t, renderSlot }: SidebarRootProps) {
  const [settled, setSettled] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) {
      setSettled(false)
      return
    }
    const timer = window.setTimeout(() => { setSettled(true) }, COLLAPSE_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [collapsed])
  const wide = !collapsed || !settled
  const lastWideWidth = useRef(width)
  if (!collapsed) lastWideWidth.current = width
  const everWide = useRef(!collapsed)
  if (!collapsed) everWide.current = true

  const column = useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
  useEffect(() => {
    if (!pointerInside) return
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect()
      if (rect === undefined) return
      if (event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom) cancelLinger()
      else armLinger()
    }
    document.addEventListener('pointermove', onMove)
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelLinger()
    }
  }, [pointerInside])

  const mark = renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: <SoulmirrorBrandMark size={24} /> })

  return (
    <div
      ref={column}
      className={cx('sn-sb', !wide && 'sn-collapsed', !wide && everWide.current && 'sn-railIn', collapsed && wide && 'sn-fading', !pointerInside && 'sn-quiet')}
      style={wide ? { width: collapsed ? lastWideWidth.current : width } : undefined}
      onPointerEnter={() => { cancelLinger(); setPointerInside(true) }}
      onPointerLeave={() => { armLinger() }}
      data-soulmirror-sidebar
    >
      <div className="sn-logoRow">
        {wide ? (
          <button type="button" className="sn-brand sn-wide" aria-label={t('session.new.label')} onClick={() => { startSession() }}>
            <span className="sn-brandIdentity" aria-hidden="true">
              <span className="sn-brandMark">{mark}</span>
              <span className="sn-brandName">
                {renderSlot('sidebar.brand.name', {}, { fallback: <span>SoulMirror</span> })}
              </span>
            </span>
          </button>
        ) : null}
        {wide ? <span className="sn-headerActions">{renderSlot('sidebar.header.action', { wide })}</span> : null}
        <Tooltip label={collapsed ? t('toggle.open') : t('toggle.collapse')} delayMs={500}>
          <button
            type="button"
            className="sn-iconButton sn-toggle"
            aria-label={collapsed ? t('toggle.open') : t('toggle.collapse')}
            onClick={() => { toggleSidebar() }}
          >
            {!wide ? <span className="sn-railMark" aria-hidden="true">{mark}</span> : null}
            <IconPanelLeftOutline16 className="sn-panelIcon" size={wide ? 16 : 18} />
          </button>
        </Tooltip>
      </div>

      <Tooltip label={t('session.new.label')} delayMs={500} disabled={wide}>
        <button type="button" className="sn-newSession" aria-label={t('session.new.label')} onClick={() => { startSession() }}>
          <IconNewChatOutline16 size={wide ? 14 : 18} />
          {wide ? <span className="sn-newSessionLabel sn-wide">{t('session.new')}</span> : null}
        </button>
      </Tooltip>

      <div className="sn-nav" data-soulmirror-sidebar-nav>
        {renderSlot('sidebar.nav.primary', { wide })}
      </div>

      <div className="sn-region">
        {renderSlot('sidebar.workspaces', { wide, expandSidebar: () => { if (collapsed) toggleSidebar() } })}
      </div>

      <div className="sn-foot">
        <div className="sn-footerActions">{renderSlot('sidebar.footer.action', { wide })}</div>
        <div className="sn-settings">{renderSlot('sidebar.settings', { wide })}</div>
      </div>
    </div>
  )
}
