/**
 * The `group.room` client slot: rooms are the pluggable applications that
 * render a group (wire spec §14.7 — transport / governance / ROOM). The
 * GroupPane is the room HOST: it owns the header and the group home and
 * renders the room named by `profile.room` through this keyed seat; the
 * built-in chat room registers under the key `chat` (./rooms/ChatRoom.tsx),
 * and any other dsh plugin can ship another room by registering another key —
 * see "How to write a room plugin" in the package README.
 *
 * The seat is DECLARED by the soulmirror-page registration's `children` table
 * (client/index.ts) — declaring is claiming: the page's `renderSlot` is handed
 * down to GroupPane as plain props, the authorizing identity stays the page
 * entry. This module also holds the pure helpers (room key resolution, the
 * speak gate, the group URI) so they are unit-testable under node.
 */
// Import the augmented module so the augmentation below resolves in every
// program that pulls this file (the node test program included).
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ApiGroup, ApiGroupProfile } from './api.ts'
import type { ThreadEntry } from './page-state.ts'

export interface RoomMember {
  readonly fp: string
  readonly name: string
  /** Seat-agent names this member announced in the group (their @-able agents). */
  readonly agents?: readonly string[]
}

/** The visible slice of the group's archive (a subset of the page store's ThreadState). */
export interface RoomThread {
  readonly entries: readonly ThreadEntry[]
  readonly loading: boolean
  readonly loaded: boolean
  readonly complete: boolean
  /** The last archive fetch failed (rooms should offer a retry). */
  readonly error?: string
}

export interface RoomActions {
  /** Send into the group; resolves false when the send failed. `by` defaults to `owner`. */
  send(body: string, opts?: { by?: 'owner' | 'alter' }): Promise<boolean>
  /** Widen the archive window by one page (scroll-up). */
  loadOlder(): void
  /** Re-fetch the archive (retry after an error / a lost request). */
  reload(): void
  /** Report the group as read (the host also calls it while visible). */
  markRead(): void
}

/** Owner props of one `group.room` occupant: everything a room needs to render one group. */
export interface RoomOwnerProps {
  readonly gid: string
  /** The group row, `profile` included. */
  readonly group: ApiGroup
  readonly me: { readonly fp: string; readonly name: string }
  readonly members: readonly RoomMember[]
  readonly thread: RoomThread
  readonly actions: RoomActions
  /** The governance gate already resolved for ME: may I post as a human / may my alter post. */
  readonly canSpeakHuman: boolean
  readonly canSpeakAgent: boolean
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Keyed room seat: one registrant per room-module id; the GroupPane
     * dispatches on `profile.room` (missing/unknown key falls back to the
     * built-in chat with a notice).
     */
    'group.room': {
      kind: 'keyed'
      scope: 'root'
      owner: RoomOwnerProps
    }
  }
}

/** The built-in room key ("" and absent resolve to it). */
export const DEFAULT_ROOM_KEY = 'chat'

/** The room-module key a group renders with. */
export function roomKeyOf(profile: ApiGroupProfile | undefined): string {
  const room = profile?.room
  return room === undefined || room === '' ? DEFAULT_ROOM_KEY : room
}

export type GroupRole = 'owner' | 'admin' | 'member'

/**
 * The governance speak gate, client side (mirrors Go `GroupRoster.AllowSpeak`):
 * may a member of `role` post with provenance `by`. A missing profile allows
 * everything (legacy groups).
 */
export function canSpeakAs(profile: ApiGroupProfile | undefined, role: GroupRole, by: 'owner' | 'alter'): boolean {
  if (profile === undefined) return true
  const who = profile.speakWho ?? 'all'
  if (who === 'owner' && role !== 'owner') return false
  if (who === 'admins' && role === 'member') return false
  return by === 'alter' ? profile.speakAgents : profile.speakHumans
}

/** My role in a group from its row + roster data (group.get carries it authoritatively). */
export function roleOf(group: Pick<ApiGroup, 'mine' | 'profile'>, myFp: string | undefined): GroupRole {
  if (group.mine) return 'owner'
  if (myFp !== undefined && (group.profile?.admins ?? []).includes(myFp)) return 'admin'
  return 'member'
}

/**
 * The public join handle of a group (`soulmirror://group?gid=…&name=…&relay=…`;
 * mirrors Go `EncodeGroupURI` — keys in alphabetical order like url.Values.Encode).
 */
export function encodeGroupUri(gid: string, relay: string, name?: string): string {
  const q = new URLSearchParams()
  q.set('gid', gid)
  if (name !== undefined && name !== '') q.set('name', name)
  q.set('relay', relay)
  return `soulmirror://group?${q.toString()}`
}
