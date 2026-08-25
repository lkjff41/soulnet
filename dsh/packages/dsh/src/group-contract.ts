/**
 * SHIM over the frozen network-layer group contract (wire spec §14.7), kept
 * in its own file so the network module can absorb it without touching the
 * alter pipeline:
 *
 *   - `NetworkClient.groups.info(gid)` (and `groups.list()` rows) carry a
 *     `profile` (speakHumans / speakAgents / agentWake / agentTier /
 *     autoPerHour / agentRounds / rules / admins …). The interface in
 *     ./network/types.ts may not declare it yet in this tree, so
 *     `groupProfileOf` reads it structurally and normalizes defaults
 *     (a missing profile = the standard template: agents allowed, wake on
 *     mention, draft tier, 10 auto posts/hour, 3 agent rounds).
 *   - `groups.send(gid, body, opts?: { by?: 'owner' | 'alter'; auto?: boolean })`
 *     — `sendGroupMessage` forwards the provenance options; a backend that
 *     does not accept them yet simply ignores the extra argument.
 *   - Group conversation entries carry `by` (message provenance) next to
 *     `from`; `entryBy` reads it structurally.
 *
 * When ./network/types.ts declares all of this, the casts here collapse and
 * this file can fold into the callers.
 */
import type { ConversationEntry, Group, GroupInfo, NetworkClient, SendReceipt } from './network/types.ts'
import { normalizeGroupWake, normalizeTier, type GroupAgentTier, type GroupAgentWake } from './policy.ts'

/** Profile defaults of the "standard group" template (a2a DefaultGroupProfile). */
export const DEFAULT_GROUP_AUTO_PER_HOUR = 10
export const DEFAULT_GROUP_AGENT_ROUNDS = 3

/** The normalized governance view of one group's profile. */
export interface GroupProfileView {
  readonly speakHumans: boolean
  readonly speakAgents: boolean
  /** Which members may post at all: all | owner | admins. */
  readonly speakWho: 'all' | 'owner' | 'admins'
  readonly agentWake: GroupAgentWake
  readonly agentTier: GroupAgentTier
  readonly autoPerHour: number
  readonly agentRounds: number
  readonly rules: string
  readonly admins: readonly string[]
  readonly room: string
}

const rec = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? value as Record<string, unknown> : {})

/** Normalize a raw profile object (or undefined) into the enforced view. */
export function normalizeGroupProfile(raw: unknown): GroupProfileView {
  const p = rec(raw)
  const who = p['speakWho']
  const perHour = p['autoPerHour']
  const rounds = p['agentRounds']
  return {
    speakHumans: p['speakHumans'] !== false,
    speakAgents: p['speakAgents'] !== false,
    speakWho: who === 'owner' || who === 'admins' ? who : 'all',
    agentWake: normalizeGroupWake(p['agentWake']),
    agentTier: normalizeTier(p['agentTier'], 'draft'),
    autoPerHour: typeof perHour === 'number' && Number.isFinite(perHour) && perHour > 0 ? Math.floor(perHour) : DEFAULT_GROUP_AUTO_PER_HOUR,
    agentRounds: typeof rounds === 'number' && Number.isFinite(rounds) && rounds > 0 ? Math.floor(rounds) : DEFAULT_GROUP_AGENT_ROUNDS,
    rules: typeof p['rules'] === 'string' ? p['rules'] : '',
    admins: Array.isArray(p['admins']) ? p['admins'].filter((a): a is string => typeof a === 'string') : [],
    room: typeof p['room'] === 'string' && p['room'] !== '' ? p['room'] : 'chat',
  }
}

/** The profile of a group row / info, read structurally (contract field `profile`). */
export function groupProfileOf(group: Group | GroupInfo): GroupProfileView {
  return normalizeGroupProfile(rec(group)['profile'])
}

/** Provenance options of one group send (contract `groups.send` opts). */
export interface GroupSendOptions {
  readonly by?: 'owner' | 'alter'
  readonly auto?: boolean
  /** Seat agent name behind a by=alter post (display provenance, e.g. "DevBot"). */
  readonly agent?: string
}

type GroupsSendWithOptions = (gid: string, body: string, opts?: GroupSendOptions) => Promise<SendReceipt>

/** Send into a group with provenance (`by` / `auto`) forwarded to the backend. */
export function sendGroupMessage(client: NetworkClient, gid: string, body: string, opts?: GroupSendOptions): Promise<SendReceipt> {
  return (client.groups.send as GroupsSendWithOptions)(gid, body, opts)
}

/** Message provenance of one archived group entry (contract field `by`). */
export function entryBy(entry: ConversationEntry): string | undefined {
  const by = rec(entry)['by']
  return typeof by === 'string' && by !== '' ? by : undefined
}
