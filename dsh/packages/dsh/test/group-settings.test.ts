/** Per-group client settings (src/group-settings.ts): dsh-groups.json read/write — v2 voices + duty, v1 fold. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GROUP_SETTINGS_FILE, GroupSettingsStore, groupSettingsPath, readGroupSettings, VOICE_ALTER } from '../src/group-settings.ts'

const home = (): string => mkdtempSync(join(tmpdir(), 'soulnet-dsh-groups-'))
const GID = 'c'.repeat(32)

describe('GroupSettingsStore', () => {
  it('reads an absent file as empty and writes the voices map through (legacy alter patch)', async () => {
    const dir = home()
    const store = GroupSettingsStore.at(dir)
    expect(store.path).toBe(groupSettingsPath(dir))
    expect(store.path.endsWith(GROUP_SETTINGS_FILE)).toBe(true)
    await store.load()
    expect(store.isLoaded).toBe(true)
    expect(store.get('g1')).toEqual({})
    expect(store.alterOn('g1')).toBe(false)
    await store.set('g1', { alter: true })
    expect(store.get('g1')).toEqual({ voices: { [VOICE_ALTER]: { on: true } } })
    expect(store.alterOn('g1')).toBe(true)
    expect(store.modeOf('g1')).toBe('mention') // no duty yet
    // the sessions-side sync reader sees the same map
    expect(readGroupSettings(dir)).toEqual({ g1: { voices: { [VOICE_ALTER]: { on: true } } } })
    // a fresh store re-reads it
    const again = GroupSettingsStore.at(dir)
    await again.load()
    expect(again.alterOn('g1')).toBe(true)
  })

  it('drops entries back at their defaults and removes forgotten groups', async () => {
    const dir = home()
    const store = GroupSettingsStore.at(dir)
    await store.load()
    await store.set(GID, { alter: true })
    expect(JSON.parse(readFileSync(groupSettingsPath(dir), 'utf8'))).toEqual({ [GID]: { voices: { [VOICE_ALTER]: { on: true } } } })
    await store.set('g2', { alter: true })
    await store.set(GID, { alter: false })
    expect(store.alterOn(GID)).toBe(false)
    expect(readGroupSettings(dir)).toEqual({ g2: { voices: { [VOICE_ALTER]: { on: true } } } })
    await store.remove('g2')
    expect(readGroupSettings(dir)).toEqual({})
  })

  it('folds a v1 file (alter + mode) into voices + duty', async () => {
    const dir = home()
    writeFileSync(groupSettingsPath(dir), JSON.stringify({
      [GID]: { alter: true, mode: 'always' },
      g2: { alter: true },
      g3: { mode: 'always' }, // mode without alter = nothing enabled → dropped
    }), 'utf8')
    const store = GroupSettingsStore.at(dir)
    await store.load()
    expect(store.alterOn(GID)).toBe(true)
    expect(store.dutyOf(GID)).toBe(VOICE_ALTER)
    expect(store.modeOf(GID)).toBe('always')
    expect(store.alterOn('g2')).toBe(true)
    expect(store.dutyOf('g2')).toBeUndefined()
    expect(store.get('g3')).toEqual({})
  })

  it('switches named voices, moves the duty slot, and keeps duty ⊆ enabled voices', async () => {
    const dir = home()
    const store = GroupSettingsStore.at(dir)
    await store.load()
    await store.set(GID, { voice: { name: 'DevBot', on: true } })
    expect(store.voiceOn(GID, 'DevBot')).toBe(true)
    expect(store.alterOn(GID)).toBe(false)
    // duty implies switching that voice on
    await store.set(GID, { duty: 'Reviewer' })
    expect(store.voiceOn(GID, 'Reviewer')).toBe(true)
    expect(store.dutyOf(GID)).toBe('Reviewer')
    // switching the duty voice off vacates the slot
    await store.set(GID, { voice: { name: 'Reviewer', on: false } })
    expect(store.dutyOf(GID)).toBeUndefined()
    expect(store.voiceOn(GID, 'Reviewer')).toBe(false)
    // legacy mode:'always' puts the alter on duty (and switches it on)
    await store.set(GID, { mode: 'always' })
    expect(store.alterOn(GID)).toBe(true)
    expect(store.dutyOf(GID)).toBe(VOICE_ALTER)
    // mode:'mention' takes the alter off duty but keeps it participating
    await store.set(GID, { mode: 'mention' })
    expect(store.alterOn(GID)).toBe(true)
    expect(store.dutyOf(GID)).toBeUndefined()
    // duty: null clears explicitly
    await store.set(GID, { duty: 'DevBot' })
    expect(store.dutyOf(GID)).toBe('DevBot')
    await store.set(GID, { duty: null })
    expect(store.dutyOf(GID)).toBeUndefined()
    // dropping every voice drops the entry
    await store.set(GID, { alter: false, voice: { name: 'DevBot', on: false } })
    expect(store.get(GID)).toEqual({})
    expect(readGroupSettings(dir)[GID]).toBeUndefined()
  })

  it('keeps per-voice commanders in the group and drops them with the voice', async () => {
    const dir = home()
    const store = GroupSettingsStore.at(dir)
    await store.load()
    await store.set(GID, { voice: { name: 'DevBot', on: true, commanders: ['fp-1', '*', 'fp-1', ''] } })
    expect(store.commandersOf(GID, 'DevBot')).toEqual(['fp-1', '*']) // deduped, blanks dropped
    // omitted commanders keep the stored list
    await store.set(GID, { voice: { name: 'DevBot', on: true } })
    expect(store.commandersOf(GID, 'DevBot')).toEqual(['fp-1', '*'])
    const again = GroupSettingsStore.at(dir)
    await again.load()
    expect(again.commandersOf(GID, 'DevBot')).toEqual(['fp-1', '*'])
    // explicit empty list = owner only
    await store.set(GID, { voice: { name: 'DevBot', on: true, commanders: [] } })
    expect(store.commandersOf(GID, 'DevBot')).toEqual([])
    await store.set(GID, { voice: { name: 'DevBot', on: false } })
    expect(store.commandersOf(GID, 'DevBot')).toEqual([])
    expect(store.voiceOn(GID, 'DevBot')).toBe(false)
  })

  it('survives a malformed file and non-boolean toggle values', async () => {
    const dir = home()
    writeFileSync(groupSettingsPath(dir), 'not json', 'utf8')
    expect(readGroupSettings(dir)).toEqual({})
    const store = GroupSettingsStore.at(dir)
    await store.load()
    expect(store.all()).toEqual({})
    writeFileSync(groupSettingsPath(dir), `{"${GID}": {"alter": "yes", "voices": {"X": {"on": "yes"}, "Y": true}}, "other": 7}`, 'utf8')
    const shaped = GroupSettingsStore.at(dir)
    await shaped.load()
    expect(shaped.alterOn(GID)).toBe(false)
    expect(shaped.voiceOn(GID, 'X')).toBe(false)
    expect(shaped.voiceOn(GID, 'Y')).toBe(true) // shorthand `true` counts as on
    expect(shaped.get('other')).toEqual({})
  })
})
