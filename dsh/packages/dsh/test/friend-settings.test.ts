/**
 * P3 per-friend settings file (dsh-friends.json) and the protocol.md file
 * helper (src/friend-settings.ts).
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FriendSettingsStore, ProtocolFile } from '../src/friend-settings.ts'

describe('FriendSettingsStore', () => {
  it('loads an absent file as empty, stores tiers, clears back to the default, reloads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'soulnet-dsh-friends-'))
    const store = FriendSettingsStore.at(dir)
    await store.load()
    expect(store.isLoaded).toBe(true)
    expect(store.tier('fp-a', 'draft')).toBe('draft')
    expect(store.get('fp-a')).toEqual({})

    await store.set('fp-a', { tier: 'auto' })
    expect(store.tier('fp-a', 'draft')).toBe('auto')
    expect(JSON.parse(readFileSync(join(dir, 'dsh-friends.json'), 'utf8'))).toEqual({ friends: { 'fp-a': { tier: 'auto' } } })

    await store.set('fp-b', { tier: 'notify' })
    const again = FriendSettingsStore.at(dir)
    await again.load()
    expect(again.all()).toEqual({ 'fp-a': { tier: 'auto' }, 'fp-b': { tier: 'notify' } })

    await again.set('fp-a', { tier: undefined })
    expect(again.tier('fp-a', 'draft')).toBe('draft')
    expect(again.all()).toEqual({ 'fp-b': { tier: 'notify' } })
    await again.remove('fp-b')
    expect(again.all()).toEqual({})
  })

  it('ignores garbage on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'soulnet-dsh-friends-'))
    writeFileSync(join(dir, 'dsh-friends.json'), '{"friends": {"fp-x": {"tier": "loud"}, "fp-y": 7}}', 'utf8')
    const store = FriendSettingsStore.at(dir)
    await store.load()
    expect(store.tier('fp-x', 'draft')).toBe('draft')
    expect(store.get('fp-y')).toEqual({})
    writeFileSync(join(dir, 'dsh-friends.json'), 'not json', 'utf8')
    const broken = FriendSettingsStore.at(dir)
    await broken.load()
    expect(broken.all()).toEqual({})
  })
})

describe('ProtocolFile', () => {
  it('reads empty when absent, writes and re-reads, follows external edits', () => {
    const dir = mkdtempSync(join(tmpdir(), 'soulnet-dsh-protocol-'))
    const file = ProtocolFile.at(dir)
    expect(file.exists()).toBe(false)
    expect(file.read()).toBe('')
    file.write('# rules\nbe nice')
    expect(file.exists()).toBe(true)
    expect(file.read()).toBe('# rules\nbe nice')
    expect(file.read()).toBe('# rules\nbe nice') // cached path
    writeFileSync(file.path, '# rules v2', 'utf8')
    expect(file.read()).toBe('# rules v2')
  })
})
