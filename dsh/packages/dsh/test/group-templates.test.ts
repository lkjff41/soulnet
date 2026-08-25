/** Group templates (src/client/group-templates.ts): the five presets and the create-form merge. */
import { describe, expect, it } from 'vitest'
import type { ApiGroupProfile } from '../src/client/api.ts'
import { GROUP_TEMPLATES, templateById, templateProfile } from '../src/client/group-templates.ts'

describe('GROUP_TEMPLATES', () => {
  it('ships the five presets with the promised switches', () => {
    expect(GROUP_TEMPLATES.map(t => t.id)).toEqual(['standard', 'announcement', 'agents', 'tasks', 'casual'])
    const by = Object.fromEntries(GROUP_TEMPLATES.map(t => [t.id, t.profile]))
    // standard = DefaultGroupProfile
    expect(by['standard']).toMatchObject({
      room: 'chat', speakHumans: true, speakAgents: true, speakWho: 'all', join: 'invite',
      agentWake: 'mention', agentTier: 'draft', autoPerHour: 10, agentRounds: 3,
    })
    expect(by['announcement']).toMatchObject({ speakHumans: true, speakAgents: false, speakWho: 'owner', agentWake: 'never' })
    expect(by['agents']).toMatchObject({ speakHumans: false, speakAgents: true, agentWake: 'always', agentTier: 'auto' })
    expect(by['tasks']).toMatchObject({ agentWake: 'mention', tags: ['tasks'] })
    expect(by['casual']).toMatchObject({ agentWake: 'always', agentTier: 'auto', autoPerHour: 60, agentRounds: 10 })
  })

  it('stamps every preset with its own template id and keeps the governance invariant (someone can speak)', () => {
    for (const t of GROUP_TEMPLATES) {
      expect(t.profile.template).toBe(t.id)
      expect(t.profile.speakHumans || t.profile.speakAgents).toBe(true)
      expect(t.nameKey).toBe(`template.${t.id}`)
      expect(t.descKey).toBe(`template.${t.id}.desc`)
    }
  })

  it('templateById falls back to standard on unknown ids', () => {
    expect(templateById('agents').id).toBe('agents')
    expect(templateById('does-not-exist').id).toBe('standard')
    expect(templateById('').id).toBe('standard')
  })

  it('templateProfile merges defined overrides, ignores empty/undefined ones, stamps the id', () => {
    const p = templateProfile('announcement', { rules: 'be kind', speakWho: '', join: undefined } as unknown as Partial<ApiGroupProfile>)
    expect(p.template).toBe('announcement')
    expect(p.speakWho).toBe('owner') // '' does not override the preset
    expect(p.join).toBe('invite') // undefined does not override
    expect(p.rules).toBe('be kind')
    // an explicit false DOES override
    const q = templateProfile('standard', { speakHumans: false })
    expect(q.speakHumans).toBe(false)
    expect(q.speakAgents).toBe(true)
    // unknown template id resolves to standard and stamps 'standard'
    expect(templateProfile('nope').template).toBe('standard')
  })
})
