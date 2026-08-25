/**
 * Pending drafts store (src/drafts.ts): add / get / list / count / counts /
 * remove / removeAll with write-through to <dir>/dsh-pending.json and a
 * tolerant load (bad rows dropped, missing file = empty).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DraftStore, PENDING_FILE } from '../src/drafts.ts'

const dirs: string[] = []
const dir = (): string => { const d = mkdtempSync(join(tmpdir(), 'soulnet-dsh-drafts-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('DraftStore', () => {
  it('starts empty without a file, adds with generated id / timestamp, writes through, reloads', async () => {
    const d = dir()
    const store = DraftStore.at(d)
    await store.load()
    expect(store.isLoaded).toBe(true)
    expect(store.list()).toEqual([])
    const a = await store.add({ fp: 'fp-bob', name: 'Bob', body: 'hi', reason: 'draft-tier', trigger: { kind: 'inbound', fp: 'fp-bob', name: 'Bob' }, sessionId: 's1' })
    expect(a.id.startsWith('draft-')).toBe(true)
    expect(Date.parse(a.createdAt)).toBeGreaterThan(0)
    const b = await store.add({ id: 'draft-custom', fp: 'fp-carol', name: 'Carol', body: 'yo', reason: 'other-friend' })
    expect(b.id).toBe('draft-custom')
    expect(store.list().map(x => x.id)).toEqual([a.id, 'draft-custom'])
    expect(store.list('fp-bob')).toEqual([a])
    expect(store.count()).toBe(2)
    expect(store.count('fp-carol')).toBe(1)
    expect(store.counts()).toEqual({ 'fp-bob': 1, 'fp-carol': 1 })
    expect(store.get('draft-custom')).toEqual(b)
    const raw = JSON.parse(readFileSync(join(d, PENDING_FILE), 'utf8')) as { drafts: unknown[] }
    expect(raw.drafts).toHaveLength(2)
    const again = DraftStore.at(d)
    await again.load()
    expect(again.list()).toEqual([a, b])
  })

  it('remove answers the record (undefined when unknown); removeAll drops one friend', async () => {
    const store = DraftStore.at(dir())
    await store.load()
    const a = await store.add({ fp: 'x', name: 'X', body: '1', reason: 'draft-tier' })
    await store.add({ fp: 'x', name: 'X', body: '2', reason: 'draft-tier' })
    await store.add({ fp: 'y', name: 'Y', body: '3', reason: 'rate-limited' })
    expect(await store.remove(a.id)).toEqual(a)
    expect(await store.remove(a.id)).toBeUndefined()
    expect(store.count()).toBe(2)
    expect(await store.removeAll('x')).toBe(1)
    expect(await store.removeAll('x')).toBe(0)
    expect(store.list().map(d => d.fp)).toEqual(['y'])
  })

  it('carries a group target: gid + name persist and reload (fp = the gid keeps the store keys uniform)', async () => {
    const gid = 'd'.repeat(32)
    const d = dir()
    const store = DraftStore.at(d)
    await store.load()
    const g = await store.add({ fp: gid, gid, name: 'Dev group', body: 'post this', reason: 'agent-rounds', trigger: { kind: 'group', gid, fp: 'fp-bob', name: 'Bob', messageId: 'm1' } })
    expect(g).toMatchObject({ fp: gid, gid, name: 'Dev group', reason: 'agent-rounds' })
    expect(g.trigger).toEqual({ kind: 'group', gid, fp: 'fp-bob', name: 'Bob', messageId: 'm1' })
    const again = DraftStore.at(d)
    await again.load()
    expect(again.get(g.id)).toEqual(g)
    expect(again.list(gid)).toEqual([g])
    expect(again.counts()).toEqual({ [gid]: 1 })
  })

  it('tolerates a damaged file: bad rows are dropped, unknown reasons normalised, a parse error = empty', async () => {
    const d = dir()
    writeFileSync(join(d, PENDING_FILE), JSON.stringify({ drafts: [{ id: 'ok', fp: 'f', body: 'b' }, { fp: 'no-id' }, 'junk', { id: 'r', fp: 'f2', reason: 7 }] }), 'utf8')
    const store = DraftStore.at(d)
    await store.load()
    expect(store.list().map(x => x.id)).toEqual(['ok', 'r'])
    expect(store.get('ok')).toMatchObject({ fp: 'f', name: 'f', body: 'b', reason: 'unknown-trigger' })
    writeFileSync(join(d, PENDING_FILE), '{not json', 'utf8')
    const broken = DraftStore.at(d)
    await broken.load()
    expect(broken.list()).toEqual([])
  })
})
