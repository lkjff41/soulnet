/**
 * Named seat agents: the registry store (src/agent-registry.ts) and the pure
 * routing policy behind them (src/policy.ts `mentionsAgent` /
 * `wakeAgentForGroup` / the group send gate's own-post shortcut).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentRegistryStore, agentNameError, agentRegistryPath } from '../src/agent-registry.ts'
import { effectiveAgentTier, groupSendGate, mentionsAgent, wakeAgentForGroup, type AgentWakeInput } from '../src/policy.ts'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const a2aDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'soulnet-dsh-agents-'))
  dirs.push(d)
  return d
}

describe('agentNameError', () => {
  it('accepts plain names (ASCII and CJK), refuses the mention-breaking ones', () => {
    expect(agentNameError('DevBot')).toBeUndefined()
    expect(agentNameError('评审员')).toBeUndefined()
    expect(agentNameError('dev_bot-2')).toBeUndefined()
    expect(agentNameError('')).toBeDefined()
    expect(agentNameError(' DevBot')).toBeDefined()
    expect(agentNameError('Dev Bot')).toBeDefined()
    expect(agentNameError('@DevBot')).toBeDefined()
    expect(agentNameError('a·b')).toBeDefined()
    expect(agentNameError('x'.repeat(33))).toBeDefined()
    for (const reserved of ['all', 'ALL', 'alter', 'owner', 'everyone']) expect(agentNameError(reserved)).toBeDefined()
  })
})

describe('AgentRegistryStore', () => {
  it('persists upserts, matches names case-insensitively, and removes', async () => {
    const dir = a2aDir()
    const store = AgentRegistryStore.at(dir)
    expect(store.path).toBe(agentRegistryPath(dir))
    await store.load()
    expect(store.list()).toEqual([])
    await store.set({ name: 'DevBot', cwd: 'D:/repo' })
    await store.set({ name: 'Reviewer' })
    expect(store.list().map(a => a.name)).toEqual(['DevBot', 'Reviewer'])
    expect(store.get('devbot')?.cwd).toBe('D:/repo')
    // upsert by case-insensitive name replaces, never duplicates
    await store.set({ name: 'devbot', preset: 'minimal' })
    expect(store.list()).toHaveLength(2)
    expect(store.get('DevBot')?.preset).toBe('minimal')
    const again = AgentRegistryStore.at(dir)
    await again.load()
    expect(again.list()).toHaveLength(2)
    expect(await again.remove('REVIEWER')).toBe(true)
    expect(await again.remove('REVIEWER')).toBe(false)
    expect(again.list().map(a => a.name)).toEqual(['devbot'])
  })

  it('refuses invalid names and survives a malformed file', async () => {
    const dir = a2aDir()
    const store = AgentRegistryStore.at(dir)
    await store.load()
    await expect(store.set({ name: 'all' })).rejects.toThrow(/reserved/)
    await expect(store.set({ name: 'a b' })).rejects.toThrow()
    writeFileSync(agentRegistryPath(dir), 'not json', 'utf8')
    const broken = AgentRegistryStore.at(dir)
    await broken.load()
    expect(broken.list()).toEqual([])
    // legacy per-agent commanders (moved to the per-group settings) are dropped silently
    writeFileSync(agentRegistryPath(dir), JSON.stringify({ agents: [{ name: 'Ok', commanders: ['x'] }, { name: 'ok' }, { name: '@bad' }, 7] }), 'utf8')
    const shaped = AgentRegistryStore.at(dir)
    await shaped.load()
    expect(shaped.list()).toEqual([{ name: 'Ok' }]) // dupe + invalid + junk dropped
  })
})

describe('mentionsAgent', () => {
  it('matches @<name> with word boundaries, without the @all shortcut', () => {
    expect(mentionsAgent('@DevBot fix the login page', 'DevBot')).toBe(true)
    expect(mentionsAgent('please @devbot, thanks', 'DevBot')).toBe(true)
    expect(mentionsAgent('@DevBots is someone else', 'DevBot')).toBe(false)
    expect(mentionsAgent('@all standup in 5', 'DevBot')).toBe(false)
    expect(mentionsAgent('no mention here', 'DevBot')).toBe(false)
    expect(mentionsAgent('@评审员 看下这个 PR', '评审员')).toBe(true)
    expect(mentionsAgent('anything', '')).toBe(false)
  })
})

describe('wakeAgentForGroup', () => {
  const base: AgentWakeInput = {
    speakAgents: true,
    enabled: true,
    fromSelf: false,
    wake: 'mention',
    duty: false,
    mentioned: true,
    commander: true,
  }
  it('wakes only a mentioned, enabled, commander-approved agent', () => {
    expect(wakeAgentForGroup(base)).toEqual({ wake: true })
    expect(wakeAgentForGroup({ ...base, fromSelf: true })).toEqual({ wake: false, reason: 'self' })
    expect(wakeAgentForGroup({ ...base, speakAgents: false })).toEqual({ wake: false, reason: 'agents-muted' })
    expect(wakeAgentForGroup({ ...base, enabled: false })).toEqual({ wake: false, reason: 'voice-disabled' })
    expect(wakeAgentForGroup({ ...base, commander: false })).toEqual({ wake: false, reason: 'not-commander' })
    expect(wakeAgentForGroup({ ...base, mentioned: false })).toEqual({ wake: false, reason: 'not-mentioned' })
    expect(wakeAgentForGroup({ ...base, wake: 'never' })).toEqual({ wake: false, reason: 'wake-never' })
  })
  it('the duty slot answers unmentioned traffic only up to the group ceiling', () => {
    // duty in an always-group: wakes without a mention
    expect(wakeAgentForGroup({ ...base, wake: 'always', duty: true, mentioned: false })).toEqual({ wake: true })
    // no duty in an always-group: still mention-only (my ceiling is stricter)
    expect(wakeAgentForGroup({ ...base, wake: 'always', duty: false, mentioned: false })).toEqual({ wake: false, reason: 'not-mentioned' })
    // duty cannot exceed a mention-only group
    expect(wakeAgentForGroup({ ...base, wake: 'mention', duty: true, mentioned: false })).toEqual({ wake: false, reason: 'not-mentioned' })
    // the commander whitelist gates duty traffic too
    expect(wakeAgentForGroup({ ...base, wake: 'always', duty: true, mentioned: false, commander: false })).toEqual({ wake: false, reason: 'not-commander' })
  })
})

describe('effectiveAgentTier', () => {
  it('lifts draft to auto without the approval switch; notify and auto pass through; approval keeps draft', () => {
    expect(effectiveAgentTier('draft', false)).toBe('auto')
    expect(effectiveAgentTier('draft', true)).toBe('draft')
    expect(effectiveAgentTier('notify', false)).toBe('notify') // the group's observe-only is not the seat's to lift
    expect(effectiveAgentTier('auto', false)).toBe('auto')
    expect(effectiveAgentTier('auto', true)).toBe('auto') // approval never tightens what the group already allows
  })
  it('the registry persists the approval switch', async () => {
    const dir = a2aDir()
    const store = AgentRegistryStore.at(dir)
    await store.load()
    await store.set({ name: 'A', approval: true, prompt: '  keep replies short  ' })
    await store.set({ name: 'B' })
    const again = AgentRegistryStore.at(dir)
    await again.load()
    expect(again.get('A')?.approval).toBe(true)
    expect(again.get('A')?.prompt).toBe('keep replies short') // trimmed, persisted
    expect(again.get('B')?.approval).toBeUndefined()
    expect(again.get('B')?.prompt).toBeUndefined()
  })
})

describe('groupSendGate own-post shortcut', () => {
  const gid = 'g'.repeat(32)
  const base = {
    trigger: { kind: 'group' as const, fp: 'fp-owner', gid },
    gid,
    speakAgents: true,
    tier: 'draft' as const,
    autoSentInWindow: 0,
    autoPerHour: 10,
    roundsExceeded: false,
    mentioned: true,
  }
  it('a turn woken by the owner\'s own post sends directly even in a draft-tier group', () => {
    expect(groupSendGate({ ...base, fromOwner: true })).toEqual({ kind: 'allow', auto: false, reason: 'owner-initiated' })
    // without the shortcut the draft tier drafts as before
    expect(groupSendGate(base)).toEqual({ kind: 'draft', reason: 'draft-tier' })
    // the shortcut never crosses groups
    expect(groupSendGate({ ...base, fromOwner: true, trigger: { kind: 'group', fp: 'fp-owner', gid: 'other' } })).toEqual({ kind: 'draft', reason: 'other-group' })
    // and never overrides a muted group
    expect(groupSendGate({ ...base, fromOwner: true, speakAgents: false })).toEqual({ kind: 'refuse', reason: 'agents-muted' })
  })
})
