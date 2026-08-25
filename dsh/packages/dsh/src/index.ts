/**
 * soulnet-dsh — host root entry = the `soulmirror-network` plugin.
 *
 * Provides `ctx.soulmirror` (NetworkClient: the `soulnet` light peer by
 * default, the in-memory fake on request) and `ctx.soulmirrorHome`, registers
 * the `soulmirror` user-settings namespace and mounts the browser-facing HTTP
 * API (./api). The bare package name is also what dsh's client-module scan keys
 * on, so this entry carries the browser bundle declaration (package.json
 * `dsh.client` + the `./client` export).
 *
 * Host side rule: NO @deepseek-ai VALUE imports into the harness instance
 * (types only; the one vendored library we do import, schemastery, is inlined).
 * A linked (`dsh plugin add ./packages/dsh`) package resolves bare specifiers
 * from its own real path, where the harness packages are not installed; and a
 * second copy of cordis/dsh-tools would be a different runtime instance anyway.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { mountApi } from './api/index.ts'
import { createFakeNetworkClient } from './network/fake.ts'
import { createSoulnetNetworkClient, defaultSoulnetHome } from './network/soulnet.ts'
import type { NetworkClient } from './network/types.ts'
import { resolveSettings, SETTINGS_NAMESPACE, SOULMIRROR_SETTINGS_SCHEMA, type SoulmirrorSettings } from './settings.ts'

export type * from './network/types.ts'
export type * from './events.ts'
export { SOULMIRROR_PLUGIN, RELAY_FORM } from './events.ts'
export { SETTINGS_NAMESPACE } from './settings.ts'
export type { SoulmirrorSettings } from './settings.ts'
// Per-group client settings (<home>/dsh-groups.json): host-side consumers (the
// sessions plugin's group routing) read the map through `readGroupSettings`.
export { GROUP_SETTINGS_FILE, GroupSettingsStore, groupSettingsPath, readGroupSettings } from './group-settings.ts'
export type { GroupSettings, GroupSettingsMap } from './group-settings.ts'

/** Live view of the `soulmirror` settings (the alter fields apply without a restart). */
export interface SoulmirrorConfig {
  current(): SoulmirrorSettings
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** SoulMirror network client (identity / card / friends / send / subscribe). */
    soulmirror: NetworkClient
    /** Backend data directory (`a2a/` underneath: identity.json, friends.yaml, conversations/ …; same layout as ~/.soulmirror/a2a). */
    soulmirrorHome: string
    /** Live settings: `defaultTier` / `autoReplyPerHour` / `directSend` are read per use; connection fields apply on reload. */
    soulmirrorConfig: SoulmirrorConfig
  }
}

/** Composition entry config; every field is also a user setting (namespace `soulmirror`). */
export type Config = Partial<SoulmirrorSettings>

export const name = 'soulmirror-network'
export const inject: string[] = []

export function apply(ctx: Context, config: Config = {}): void {
  const log = (level: 'info' | 'warn' | 'error', message: string): void => {
    ctx.logger[level](`soulmirror-network: ${message}`)
  }

  // Settings: schema defaults < composition entry (`config`) < user document.
  // When the settings service is already composed we read the resolved value
  // now; otherwise we run on the entry config and register late for the UI.
  const entry = resolveSettings(config)
  let effective: SoulmirrorSettings = entry
  // `live` follows the user document: the connection fields still apply on
  // reload (the peer is already running), the alter fields are read per use.
  let live: SoulmirrorSettings = entry
  const settingsNow = ctx.get('settings')
  if (settingsNow !== undefined) {
    const scope = settingsNow.register(SETTINGS_NAMESPACE as SettingsNamespace, SOULMIRROR_SETTINGS_SCHEMA, { base: config, applies: 'restart' })
    effective = resolveSettings(scope.get() as Partial<SoulmirrorSettings>)
    live = effective
    scope.watch(() => {
      live = resolveSettings(scope.get() as Partial<SoulmirrorSettings>)
      log('info', `settings changed (tier=${live.defaultTier}, autoReplyPerHour=${live.autoReplyPerHour}, directSend=${String(live.directSend)} apply now; connection fields apply when the plugin reloads)`)
    })
  } else {
    ctx.inject(['settings'], (sctx) => {
      const scope = sctx.settings.register(SETTINGS_NAMESPACE as SettingsNamespace, SOULMIRROR_SETTINGS_SCHEMA, { base: config, applies: 'restart' })
      live = resolveSettings(scope.get() as Partial<SoulmirrorSettings>)
      scope.watch(() => {
        live = resolveSettings(scope.get() as Partial<SoulmirrorSettings>)
        log('info', 'settings changed; alter fields apply now, connection fields when the plugin reloads')
      })
    })
  }
  const liveConfig: SoulmirrorConfig = { current: () => live }
  ctx.provide('soulmirrorConfig', liveConfig)

  const home = effective.home !== '' ? effective.home : defaultSoulnetHome()
  let client: NetworkClient
  if (effective.backend === 'fake') {
    client = createFakeNetworkClient()
  } else {
    const peer = createSoulnetNetworkClient({
      home,
      relay: effective.relay,
      displayName: effective.displayName,
      ...(effective.peerBinary === '' ? {} : { peerBinary: effective.peerBinary }),
      logger: log,
    })
    peer.start()
    client = peer
  }

  ctx.provide('soulmirrorHome', home)
  ctx.provide('soulmirror', client)
  ctx.effect(() => () => {
    void client.dispose().catch((error: unknown) => { log('warn', `dispose failed: ${String(error)}`) })
  }, 'soulmirror-network: backend process')

  mountApi(ctx, {
    client,
    home,
    settingsNamespace: SETTINGS_NAMESPACE,
    sessions: () => ctx.get('soulmirrorSessions'),
    settings: () => live,
    log,
  })
  log('info', `backend=${client.backend} home=${home} relay=${effective.relay}`)
}
