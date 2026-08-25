/**
 * Group templates: the five presets the create form offers. A template is just
 * a starting profile (wire spec §14.7) — the created group stores the merged
 * profile with `template` recording the preset id for display; everything can
 * be changed later through the group home. Pure module (no React, no DOM):
 * unit-tested under node (test/group-templates.test.ts).
 */
import type { ApiGroupProfile } from './api.ts'

export type GroupTemplateId = 'standard' | 'announcement' | 'agents' | 'tasks' | 'casual'

export interface GroupTemplate {
  readonly id: GroupTemplateId
  readonly profile: ApiGroupProfile
  /** Dictionary key of the display name. */
  readonly nameKey: `template.${GroupTemplateId}`
  /** Dictionary key of the one-line description. */
  readonly descKey: `template.${GroupTemplateId}.desc`
}

const base = (id: GroupTemplateId, patch: Partial<ApiGroupProfile>): GroupTemplate => ({
  id,
  profile: {
    // The "standard group" defaults (mirrors Go `a2a.DefaultGroupProfile`).
    template: id,
    room: 'chat',
    speakHumans: true,
    speakAgents: true,
    speakWho: 'all',
    join: 'invite',
    agentWake: 'mention',
    agentTier: 'draft',
    autoPerHour: 10,
    agentRounds: 3,
    ...patch,
  },
  nameKey: `template.${id}`,
  descKey: `template.${id}.desc`,
})

/** The five presets, in display order. */
export const GROUP_TEMPLATES: readonly GroupTemplate[] = [
  // Humans and agents both speak; agents wake on mention and draft their replies.
  base('standard', {}),
  // Only the owner posts; agents stay silent.
  base('announcement', { speakWho: 'owner', speakAgents: false, agentWake: 'never' }),
  // Agents-only workspace: humans read, alters talk freely.
  base('agents', { speakHumans: false, agentWake: 'always', agentTier: 'auto' }),
  // Standard collaboration around tasks.
  base('tasks', { agentWake: 'mention', tags: ['tasks'] }),
  // Loose chatter: agents always awake, generous caps.
  base('casual', { agentWake: 'always', agentTier: 'auto', autoPerHour: 60, agentRounds: 10 }),
]

/** Look up a template; unknown ids fall back to `standard`. */
export function templateById(id: string): GroupTemplate {
  return GROUP_TEMPLATES.find(t => t.id === id) ?? GROUP_TEMPLATES[0]!
}

/**
 * Build the profile of a new group: the template's preset merged with the
 * advanced-section overrides (only defined fields override), the template id
 * stamped. Empty-string select values count as "keep the preset".
 */
export function templateProfile(id: string, overrides: Partial<ApiGroupProfile> = {}): ApiGroupProfile {
  const preset = templateById(id).profile
  const defined = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined && v !== ''))
  return { ...preset, ...defined, template: templateById(id).id }
}
