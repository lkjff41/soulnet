/**
 * Pure inbox state (src/client/inbox-state.ts): unread aggregation, the SSE
 * frame fold (message / presence / typing / friend_accept / friend_request /
 * outbound / draft), local mark-read, the new-mail cue predicate, drafts per
 * friend, and the row helpers.
 */
import { describe, expect, it } from 'vitest'
import type { ApiDraft, ApiFriend, ApiState } from '../src/client/api.ts'
import {
  EMPTY_INBOX, applyFrame, draftsFor, formatAge, fromApiState, markReadLocal, previewOf, shouldNotify, sortInbox, unreadTotal,
  type InboxState,
} from '../src/client/inbox-state.ts'

const friend = (fp: string, name: string, patch: Partial<ApiFriend> = {}): ApiFriend => ({ fp, name, unread: 0, count: 0, ...patch })
const draft = (id: string, fp: string, body = 'd'): ApiDraft => ({ id, fp, name: fp.toUpperCase(), body, createdAt: new Date(0).toISOString(), reason: 'draft-tier' })

const state = (friends: ApiFriend[], alterSessionId?: string, drafts: ApiDraft[] = []): InboxState => ({ friends, groups: [], pending: [], drafts, alterSessionId, typing: {}, groupApps: {} })

describe('unreadTotal', () => {
  it('sums unread over all friends and ignores negative counts', () => {
    expect(unreadTotal([])).toBe(0)
    expect(unreadTotal([friend('a', 'A', { unread: 2 }), friend('b', 'B'), friend('c', 'C', { unread: 5 })])).toBe(7)
    expect(unreadTotal([{ unread: -3 }, { unread: 1 }])).toBe(1)
  })
})

describe('applyFrame', () => {
  it('message: increments unread/count, updates preview, reports a notice with the alter session id', () => {
    const s0 = state([friend('a', 'Alice', { unread: 1, count: 4, lastBody: 'old' }), friend('b', 'Bob')], 'session-alter')
    const { state: s1, notice } = applyFrame(s0, { kind: 'message', message: { id: 'm1', from: 'a', name: 'alice-card', body: 'hello\nworld', ts: 1000 } })
    expect(s1.friends.find(f => f.fp === 'a')).toMatchObject({ unread: 2, count: 5, lastBody: 'hello\nworld', lastTs: 1000 })
    expect(s1.friends.find(f => f.fp === 'b')).toMatchObject({ unread: 0 })
    expect(unreadTotal(s1.friends)).toBe(2)
    // The notice carries the list's display name (note/remark), not the name on the wire.
    expect(notice).toEqual({ id: 'm1', fp: 'a', name: 'Alice', body: 'hello\nworld', ts: 1000, sessionId: 'session-alter' })
    // Immutability: the previous snapshot is untouched.
    expect(s0.friends[0]?.unread).toBe(1)
  })

  it('message from an unknown fp adds a provisional row (friend accepted while away)', () => {
    const { state: s1, notice } = applyFrame(state([friend('a', 'Alice')]), { kind: 'message', message: { id: 'm2', from: 'z', name: 'Zed', body: 'hi', ts: 5 } })
    expect(s1.friends.map(f => f.fp)).toEqual(['a', 'z'])
    expect(s1.friends[1]).toMatchObject({ name: 'Zed', unread: 1, count: 1, lastBody: 'hi' })
    expect(notice?.sessionId).toBeUndefined()
  })

  it('presence / typing / friend_accept / friend_request / status', () => {
    let s = state([friend('a', 'Alice')])
    s = applyFrame(s, { kind: 'presence', fp: 'a', online: true }).state
    expect(s.friends[0]?.online).toBe(true)
    s = applyFrame(s, { kind: 'typing', fp: 'a', on: true }).state
    expect(s.typing['a']).toBe(true)
    s = applyFrame(s, { kind: 'friend_request', request: { id: 'r1', fp: 'b', name: 'Bob', greeting: 'yo' } }).state
    s = applyFrame(s, { kind: 'friend_request', request: { id: 'r1', fp: 'b', name: 'Bob', greeting: 'yo' } }).state
    expect(s.pending).toHaveLength(1)
    s = applyFrame(s, { kind: 'friend_accept', friend: friend('b', 'Bob', { online: true }) }).state
    expect(s.friends.map(f => f.fp)).toEqual(['a', 'b'])
    expect(s.pending).toHaveLength(0)
    // accepting an already listed friend patches instead of duplicating
    s = applyFrame(s, { kind: 'friend_accept', friend: friend('b', 'Bobby') }).state
    expect(s.friends.filter(f => f.fp === 'b')).toHaveLength(1)
    expect(s.friends[1]?.name).toBe('Bobby')
    const before = s
    s = applyFrame(s, { kind: 'status', status: { backend: 'fake', state: 'ready', restarts: 0 } }).state
    expect(s).toBe(before)
  })

  it('draft: added → listed + the friend row counts it; removed → gone, count cleared; idempotent by id', () => {
    let s = state([friend('a', 'Alice'), friend('b', 'Bob')])
    s = applyFrame(s, { kind: 'draft', action: 'added', draft: draft('d1', 'a', 'first') }).state
    s = applyFrame(s, { kind: 'draft', action: 'added', draft: draft('d2', 'a', 'second') }).state
    s = applyFrame(s, { kind: 'draft', action: 'added', draft: draft('d2', 'a', 'second again') }).state
    expect(s.drafts.map(d => d.id)).toEqual(['d1', 'd2'])
    expect(draftsFor(s, 'a').map(d => d.body)).toEqual(['first', 'second again'])
    expect(s.friends[0]?.drafts).toBe(2)
    expect(s.friends[1]?.drafts).toBeUndefined()
    s = applyFrame(s, { kind: 'draft', action: 'removed', draft: draft('d1', 'a'), decision: 'approved' }).state
    expect(s.drafts.map(d => d.id)).toEqual(['d2'])
    expect(s.friends[0]?.drafts).toBe(1)
    s = applyFrame(s, { kind: 'draft', action: 'removed', draft: draft('d2', 'a'), decision: 'rejected' }).state
    expect(s.drafts).toEqual([])
    expect('drafts' in s.friends[0]!).toBe(false)
  })
})

describe('markReadLocal / fromApiState', () => {
  it('zeroes one friend and keeps identity when nothing changes', () => {
    const s0 = state([friend('a', 'A', { unread: 3 }), friend('b', 'B', { unread: 1 })])
    const s1 = markReadLocal(s0, 'a')
    expect(unreadTotal(s1.friends)).toBe(1)
    expect(markReadLocal(s1, 'a')).toBe(s1)
    expect(markReadLocal(s1, 'nobody')).toBe(s1)
  })

  it('a fresh /state answer replaces friends/pending/drafts/alter session but keeps live typing flags; draft counts come from the drafts list', () => {
    const s0: InboxState = { ...state([friend('a', 'A', { unread: 9, drafts: 3 })]), typing: { a: true } }
    const api: ApiState = {
      backend: 'fake', status: { backend: 'fake', state: 'ready', restarts: 0 }, home: '/h', settingsNamespace: 'soulmirror',
      identity: null, friends: [friend('a', 'A', { unread: 0 }), friend('c', 'C', { unread: 2 })], pending: [], drafts: [draft('d1', 'c')],
      alter: { sessionId: 'session-alter', status: 'idle', defaultTier: 'draft', autoReplyPerHour: 20, directSend: false, protocolPath: '/p', protocolExists: true, legacyFriendSessions: {} },
    }
    const s1 = fromApiState(s0, api)
    expect(unreadTotal(s1.friends)).toBe(2)
    expect(s1.alterSessionId).toBe('session-alter')
    expect(s1.typing).toEqual({ a: true })
    expect(s1.friends[0]).toEqual(friend('a', 'A', { unread: 0 }))
    expect(s1.friends[1]).toEqual(friend('c', 'C', { unread: 2, drafts: 1 }))
    expect(s1.drafts).toEqual(api.drafts)
    expect({ ...EMPTY_INBOX, friends: [], drafts: [] }).toEqual(EMPTY_INBOX)
  })
})

describe('shouldNotify', () => {
  it('fires while the alter session is not on screen (or not created yet)', () => {
    const notice = { id: 'm', fp: 'a', name: 'A', body: 'x', ts: 1, sessionId: 's-1' }
    expect(shouldNotify(notice, 's-1')).toBe(false)
    expect(shouldNotify(notice, 's-2')).toBe(true)
    expect(shouldNotify(notice, undefined)).toBe(true)
    expect(shouldNotify({ ...notice, sessionId: undefined }, 's-1')).toBe(true)
  })
})

describe('row helpers', () => {
  it('sortInbox: unread first, then newest, then name', () => {
    const sorted = sortInbox([
      friend('c', 'Carol', { lastTs: 50 }),
      friend('b', 'Bob', { unread: 1, lastTs: 10 }),
      friend('a', 'Alice', { lastTs: 100 }),
      friend('d', 'Dan'),
    ])
    expect(sorted.map(f => f.fp)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('formatAge / previewOf', () => {
    const now = 1_700_000_000_000
    expect(formatAge(undefined, now)).toBe('')
    expect(formatAge(now - 5_000, now)).toBe('now')
    expect(formatAge(now - 5 * 60_000, now)).toBe('5m')
    expect(formatAge(now - 3 * 3_600_000, now)).toBe('3h')
    expect(formatAge(now - 2 * 86_400_000, now)).toBe('2d')
    expect(previewOf(undefined)).toBe('')
    expect(previewOf('  a\n\n b   c ')).toBe('a b c')
    expect(previewOf('x'.repeat(80), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})
