/**
 * The seats this sidebar declares on top of the stock ones.
 *
 * The five stock seats (`sidebar.brand.mark`, `sidebar.brand.name`,
 * `sidebar.workspaces`, `sidebar.settings`, `sidebar.footer.action`) keep the
 * contracts `@deepseek-ai/dsh-client-ui-sidebar/client` declares (same names,
 * same owner props), so their registrants never notice the swap. The two new
 * seats are declared here; another plugin fills them with
 * `ctx.slots.inject('sidebar.nav.primary', () => ctx.slots.register({ name:
 * 'sidebar.nav.primary', id, order }, Component))` — the inject callback fires
 * only when this sidebar is installed, so a plugin can register into both a
 * new seat and a stock one and stay correct on a stock dsh.
 */
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Primary navigation rows between New Session and the workspace/session
     * browser: one row per entry (icon + label wide, icon only in the rail).
     * The entry owns its content and click; the shell passes the column state.
     */
    'sidebar.nav.primary': {
      kind: 'list'
      scope: 'root'
      owner: SidebarNavPrimaryOwnerProps
    }
    /**
     * Icon-button seats in the brand row, left of the fold toggle (wide column
     * only — the rail shows the toggle alone). Each entry renders its own
     * 28px button.
     */
    'sidebar.header.action': {
      kind: 'list'
      scope: 'root'
      owner: SidebarHeaderActionOwnerProps
    }
  }
}

/** Owner share of a primary-nav row: the column display state only. */
export type SidebarNavPrimaryOwnerProps = SidebarFooterActionOwnerProps

/** Owner share of a header action: the column display state only (always wide when rendered). */
export type SidebarHeaderActionOwnerProps = SidebarFooterActionOwnerProps
