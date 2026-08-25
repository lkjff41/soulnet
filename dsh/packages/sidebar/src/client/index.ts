/**
 * soulnet-dsh-sidebar browser half (served as
 * /plugins/soulnet-dsh-sidebar/client.js).
 *
 * Registers: the zh/en dictionary, the SoulMirror occupant of the layout's
 * `sidebar` seat (SidebarRoot — declares the five stock inner seats again plus
 * `sidebar.nav.primary` and `sidebar.header.action`), and the SoulMirror
 * brand in the three brand seats (`sidebar.brand.mark`, `sidebar.brand.name`,
 * `conversation.hero.brand.mark`). The stock `ui-sidebar` / `ui-brand-official`
 * rows are switched off by this package's cordis.patch.yml, so there is exactly
 * one registrant per seat. All cross-plugin collaboration goes through cordis
 * services (`ctx.slots`, `ctx.locale`, `ctx.layout`, `ctx.workspaces`); the
 * only value imports are react, ui-primitives and this package's own files.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: ctx.locale, ctx.layout / the `sidebar` seat, the stock inner seats, the hero brand seat.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from './slots.ts'
import { SoulmirrorBrandMark, SoulmirrorBrandName } from './brand.tsx'
import { en, NS, zh } from './locales.ts'
import { SidebarRoot } from './SidebarRoot.tsx'
import { ensureStyles, removeStyles } from './styles.ts'

export type { SidebarHeaderActionOwnerProps, SidebarNavPrimaryOwnerProps } from './slots.ts'
export type { SidebarKey } from './locales.ts'

export const inject = ['slots', 'layout', 'workspaces', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'soulmirror-sidebar: dictionaries')
  ctx.effect(() => {
    ensureStyles()
    return removeStyles
  }, 'soulmirror-sidebar: styles')

  // 1. The column itself: the `sidebar` seat of ui-layout's root.
  const injectProps = () => ({
    startSession: (workspaceId?: Parameters<typeof ctx.workspaces.startSession>[0]) => {
      ctx.workspaces.startSession(workspaceId)
    },
    toggleSidebar: () => {
      ctx.layout.toggleSidebar()
    },
  })
  ctx.slots.inject('sidebar', () => ctx.slots.register({
    name: 'sidebar',
    locale: NS,
    children: {
      'sidebar.brand.mark': { kind: 'single', scope: 'root' },
      'sidebar.brand.name': { kind: 'single', scope: 'root' },
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
      'sidebar.settings': { kind: 'single', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'sidebar.nav.primary': { kind: 'list', scope: 'root' },
      'sidebar.header.action': { kind: 'list', scope: 'root' },
    },
    inject: injectProps,
  }, SidebarRoot))

  // 2. The brand: our mark and name in the sidebar, our mark in the new-session hero.
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark' }, SoulmirrorBrandMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', locale: NS }, SoulmirrorBrandName))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark' }, SoulmirrorBrandMark))
}
