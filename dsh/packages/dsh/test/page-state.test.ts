/**
 * Pure SoulMirror page state (src/client/page-state.ts): selection, thread
 * merge / ordering, archive fold, optimistic send → reconcile / fail, the
 * unread-first list rows with the search filter, and the bubble helpers.
 */
import { describe, expect, it } from 'vitest'
import type { ApiEntry, ApiFriend } from '../src/client/api.ts'
import { applyFrame, type InboxState } from '../src/client/inbox-state.ts'
import {
  addOptimistic, ALTER_KEY, applyArchive, applyInbound, applyOutbound, dayKey, dropEntry, EMPTY_THREAD, failSend, filterFriends, formatClock, formatDay,
  lastSeq, listRows, mergeEntries, reconcileSend, resolveSelection, sortThread, withDaySeparators, type ThreadEntry,
} from '../src/client/page-state.ts'

const friend = (fp: string, name: string, patch: Partial<ApiFriend> = {}): ApiFriend => ({ fp, name, unread: 0, count: 0, ...patch })
const entry = (seq: number, dir: 'in' | 'out', body: string, ts: number, patch: Partial<ApiEntry> = {}): ApiEntry => ({ seq, dir, id: `m${seq}`, body, ts, ...patch })

describe('sortThread / mergeEntries', () => {
  it('orders archived entries by seq and keeps optimistic ones (seq 0) at the tail by time', () => {
    const t: ThreadEntry[] = [
      { seq: 0, dir: 'out', id: 'local-2', body: 'b', ts: 50, clientId: 'local-2', status: 'sending' },
      { seq: 3, dir: 'in', id: 'm3', body: 'c', ts: 30 },
      { seq: 1, dir: 'in', id: 'm1', body: 'a', ts: 10 },
      { seq: 0, dir: 'out', id: 'local-1', body: 'd', ts: 40, clientId: 'local-1', status: 'sending' },
    ]
    expect(sortThread(t).map(e => e.id)).toEqual(['m1', 'm3', 'local-1', 'local-2'])
  })

  it('replaces by seq (status moved), absorbs by id (keeps the clientId), appends the rest', () => {
    const existing: ThreadEntry[] = [
      { seq: 1, dir: 'out', id: 'm1', body: 'hi', ts: 10, status: 'queued' },
      { seq: 0, dir: 'out', id: 'a2a-9', body: 'yo', ts: 20, status: 'sending', clientId: 'local-9' },
    ]
    const merged = mergeEntries(existing, [
      { seq: 1, dir: 'out', id: 'm1', body: 'hi', ts: 10, status: 'sent' },
      { seq: 2, dir: 'out', id: 'a2a-9', body: 'yo', ts: 21, status: 'sent' },
      { seq: 3, dir: 'in', id: 'm3', body: 'reply', ts: 30 },
    ])
    expect(merged.map(e => e.seq)).toEqual([1, 2, 3])
    expect(merged[0]).toMatchObject({ status: 'sent' })
    expect(merged[1]).toMatchObject({ seq: 2, clientId: 'local-9', status: 'sent', ts: 21 })
    expect(merged).toHaveLength(3)
  })

  it('is idempotent: merging the same archive twice does not duplicate', () => {
    const once = mergeEntries([], [entry(1, 'in', 'a', 1), entry(2, 'out', 'b', 2)].map(e => ({ ...e })))
    const twice = mergeEntries(once, [entry(1, 'in', 'a', 1), entry(2, 'out', 'b', 2)].map(e => ({ ...e })))
    expect(twice).toHaveLength(2)
  })
})

describe('applyArchive / applyInbound / applyOutbound', () => {
  it('loads the window, marks complete when the archive is shorter than asked, keeps entries on widen', () => {
    let s = applyArchive(EMPTY_THREAD, [entry(5, 'in', 'e', 5), entry(6, 'out', 'f', 6)], 2)
    expect(s).toMatchObject({ loaded: true, loading: false, complete: false, window: 2 })
    expect(s.entries.map(e => e.seq)).toEqual([5, 6])
    s = applyArchive(s, [entry(1, 'in', 'a', 1), entry(2, 'in', 'b', 2), entry(3, 'in', 'c', 3), entry(4, 'in', 'd', 4), entry(5, 'in', 'e', 5), entry(6, 'out', 'f', 6)], 52)
    expect(s.complete).toBe(true)
    expect(s.entries.map(e => e.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(lastSeq(s)).toBe(6)
  })

  it('appends an inbound SSE message (with seq) and an outbound frame; dedupes against the archive refetch', () => {
    let s = applyArchive(EMPTY_THREAD, [entry(1, 'in', 'a', 1)], 50)
    s = applyInbound(s, { id: 'm2', body: 'hello', ts: 2, seq: 2 })
    s = applyOutbound(s, entry(3, 'out', 'back', 3, { status: 'sent' }))
    expect(s.entries.map(e => [e.seq, e.dir])).toEqual([[1, 'in'], [2, 'in'], [3, 'out']])
    // The refetch that follows carries the same lines.
    s = applyArchive(s, [entry(1, 'in', 'a', 1), { ...entry(2, 'in', 'hello', 2), id: 'm2' }, entry(3, 'out', 'back', 3)], 50)
    expect(s.entries).toHaveLength(3)
  })

  it('an inbound message without seq is matched by id once the archive names it', () => {
    let s = applyInbound(EMPTY_THREAD, { id: 'x1', body: 'hi', ts: 5 })
    expect(s.entries[0]?.seq).toBe(0)
    s = applyArchive(s, [{ seq: 7, dir: 'in', id: 'x1', body: 'hi', ts: 5 }], 50)
    expect(s.entries).toHaveLength(1)
    expect(s.entries[0]?.seq).toBe(7)
  })
})

describe('optimistic send', () => {
  it('adds a sending bubble, reconciles it with the archived entry in place (stable clientId), dedupes a raced outbound frame', () => {
    let s = applyArchive(EMPTY_THREAD, [entry(1, 'in', 'a', 1)], 50)
    s = addOptimistic(s, { clientId: 'local-1', body: 'yo', ts: 100 })
    expect(s.entries[1]).toMatchObject({ seq: 0, dir: 'out', status: 'sending', clientId: 'local-1', body: 'yo' })
    // The SSE outbound frame (same archive line) may arrive before the HTTP answer.
    s = applyOutbound(s, { seq: 2, dir: 'out', id: 'a2a-1', body: 'yo', ts: 101, status: 'sent' })
    s = reconcileSend(s, 'local-1', { seq: 2, dir: 'out', id: 'a2a-1', body: 'yo', ts: 101, status: 'sent' })
    expect(s.entries.map(e => e.seq)).toEqual([1, 2])
    expect(s.entries[1]).toMatchObject({ seq: 2, id: 'a2a-1', status: 'sent', clientId: 'local-1', ts: 101 })
  })

  it('reconcile without a matching bubble just merges; failSend keeps the bubble with the error; dropEntry removes it', () => {
    let s = reconcileSend(EMPTY_THREAD, 'nope', entry(4, 'out', 'x', 4, { status: 'queued' }))
    expect(s.entries).toHaveLength(1)
    s = addOptimistic(s, { clientId: 'local-2', body: 'z', ts: 200 })
    s = failSend(s, 'local-2', 'relay down')
    expect(s.entries[1]).toMatchObject({ status: 'failed', error: 'relay down', body: 'z' })
    s = dropEntry(s, 'local-2')
    expect(s.entries).toHaveLength(1)
  })

  it('queued outbound keeps its status until the archive says sent', () => {
    let s = addOptimistic(EMPTY_THREAD, { clientId: 'c', body: 'q', ts: 1 })
    s = reconcileSend(s, 'c', { seq: 1, dir: 'out', id: 'i', body: 'q', ts: 1, status: 'queued' })
    expect(s.entries[0]?.status).toBe('queued')
    s = applyArchive(s, [{ seq: 1, dir: 'out', id: 'i', body: 'q', ts: 1, status: 'sent' }], 50)
    expect(s.entries[0]).toMatchObject({ status: 'sent', clientId: 'c' })
  })
})

describe('list rows / selection', () => {
  const friends = [
    friend('a', 'Alice', { lastTs: 100 }),
    friend('b', 'Bob', { unread: 2, lastTs: 50 }),
    friend('c', 'Carol', { unread: 1, lastTs: 80, remark: 'college' }),
    friend('d', 'Dave', { lastTs: 200, cardName: 'David' }),
  ]

  it('unread first (newest among them), then newest, then name; search filters by name / remark / card name / fp prefix', () => {
    expect(listRows(friends, '').map(f => f.fp)).toEqual(['c', 'b', 'd', 'a'])
    expect(listRows(friends, 'col').map(f => f.fp)).toEqual(['c'])
    expect(filterFriends(friends, 'DAV').map(f => f.fp)).toEqual(['d'])
    expect(filterFriends(friends, 'a').map(f => f.fp).sort()).toEqual(['a', 'c', 'd'])
    expect(filterFriends(friends, 'zzz')).toEqual([])
  })

  it('"My alter" is the pinned default: nothing / a gone friend or group / ALTER_KEY resolve to it; a live friend or group stays selected', () => {
    expect(resolveSelection(friends, [], [], 'b')).toBe('b')
    expect(resolveSelection(friends, [], [], 'gone')).toBe(ALTER_KEY)
    expect(resolveSelection(friends, [], [], undefined)).toBe(ALTER_KEY)
    expect(resolveSelection(friends, [], [], ALTER_KEY)).toBe(ALTER_KEY)
    // seat-agent keys resolve while the agent exists, else fall back to the alter
    expect(resolveSelection(friends, [], [{ name: 'DevBot' }], 'a:DevBot')).toBe('a:DevBot')
    expect(resolveSelection(friends, [], [], 'a:DevBot')).toBe(ALTER_KEY)
    expect(resolveSelection([], [], [], 'a')).toBe(ALTER_KEY)
    expect(resolveSelection(friends, [{ gid: 'abc' }], [], 'g:abc')).toBe('g:abc')
    expect(resolveSelection(friends, [{ gid: 'abc' }], [], 'g:gone')).toBe(ALTER_KEY)
    expect(resolveSelection(friends, [], [], 'g:abc')).toBe(ALTER_KEY)
    expect(ALTER_KEY).toBe('alter')
  })

  it('an outbound frame moves the row preview / time but not the unread count', () => {
    const state: InboxState = { friends: [friend('a', 'Alice', { unread: 1, lastTs: 10, lastBody: 'old', count: 1 })], groups: [], pending: [], drafts: [], alterSessionId: undefined, typing: {}, groupApps: {} }
    const next = applyFrame(state, { kind: 'outbound', fp: 'a', entry: entry(2, 'out', 'mine', 20) }).state
    expect(next.friends[0]).toMatchObject({ unread: 1, lastTs: 20, lastBody: 'mine', count: 2 })
    const stale = applyFrame(next, { kind: 'outbound', fp: 'a', entry: entry(1, 'out', 'older', 5) }).state
    expect(stale.friends[0]).toMatchObject({ lastTs: 20, lastBody: 'mine', count: 3 })
  })
})

describe('bubble helpers', () => {
  it('day separators once per local day, keys stable (clientId > seq > id)', () => {
    const d1 = new Date(2026, 7, 20, 9, 0).getTime()
    const d2 = new Date(2026, 7, 21, 10, 30).getTime()
    const rows = withDaySeparators([
      { seq: 1, dir: 'in', id: 'a', body: '', ts: d1 },
      { seq: 2, dir: 'out', id: 'b', body: '', ts: d1 + 60_000 },
      { seq: 0, dir: 'out', id: 'local-1', body: '', ts: d2, clientId: 'local-1' },
    ])
    expect(rows.map(r => r.kind)).toEqual(['day', 'entry', 'entry', 'day', 'entry'])
    expect(rows.filter(r => r.kind === 'entry').map(r => r.key)).toEqual(['seq:1', 'seq:2', 'local-1'])
    expect(dayKey(d1)).toBe('2026-08-20')
    expect(formatClock(d2)).toBe('10:30')
  })

  it('formatDay: today / yesterday / short date / with year', () => {
    const now = new Date(2026, 7, 22, 12, 0).getTime()
    const labels = { today: 'Today', yesterday: 'Yesterday' }
    expect(formatDay(now - 3_600_000, now, labels)).toBe('Today')
    expect(formatDay(now - 24 * 3_600_000, now, labels)).toBe('Yesterday')
    expect(formatDay(new Date(2026, 0, 5).getTime(), now, labels)).toBe('1/5')
    expect(formatDay(new Date(2025, 11, 31).getTime(), now, labels)).toBe('2025/12/31')
  })
})
