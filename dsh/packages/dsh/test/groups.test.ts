/**
 * Group pure logic: room key resolution and the speak gate (src/client/
 * group-room.ts), the group URI, and the application-badge fold
 * (src/client/inbox-state.ts `group_application` / `clearGroupApps`).
 */
import { describe, expect, it } from 'vitest'
import type { ApiGroupProfile } from '../src/client/api.ts'
import { canSpeakAs, DEFAULT_ROOM_KEY, encodeGroupUri, roleOf, roomKeyOf } from '../src/client/group-room.ts'
import { applyFrame, clearGroupApps, EMPTY_INBOX } from '../src/client/inbox-state.ts'

const profile = (patch: Partial<ApiGroupProfile> = {}): ApiGroupProfile => ({ speakHumans: true, speakAgents: true, ...patch })

describe('roomKeyOf', () => {
  it('resolves missing / empty room to the built-in chat', () => {
    expect(roomKeyOf(undefined)).toBe(DEFAULT_ROOM_KEY)
    expect(roomKeyOf(profile())).toBe('chat')
    expect(roomKeyOf(profile({ room: '' }))).toBe('chat')
    expect(roomKeyOf(profile({ room: 'kanban' }))).toBe('kanban')
  })
})

describe('canSpeakAs (mirrors Go AllowSpeak)', () => {
  it('a missing profile allows everything (legacy groups)', () => {
    expect(canSpeakAs(undefined, 'member', 'owner')).toBe(true)
    expect(canSpeakAs(undefined, 'member', 'alter')).toBe(true)
  })
  it('gates by provenance: speak_humans / speak_agents', () => {
    expect(canSpeakAs(profile({ speakHumans: false }), 'owner', 'owner')).toBe(false)
    expect(canSpeakAs(profile({ speakHumans: false }), 'owner', 'alter')).toBe(true)
    expect(canSpeakAs(profile({ speakAgents: false }), 'member', 'alter')).toBe(false)
    expect(canSpeakAs(profile({ speakAgents: false }), 'member', 'owner')).toBe(true)
  })
  it('gates by member scope: speak_who owner / admins ("" = all)', () => {
    const ownerOnly = profile({ speakWho: 'owner' })
    expect(canSpeakAs(ownerOnly, 'owner', 'owner')).toBe(true)
    expect(canSpeakAs(ownerOnly, 'admin', 'owner')).toBe(false)
    expect(canSpeakAs(ownerOnly, 'member', 'alter')).toBe(false)
    const admins = profile({ speakWho: 'admins' })
    expect(canSpeakAs(admins, 'owner', 'owner')).toBe(true)
    expect(canSpeakAs(admins, 'admin', 'alter')).toBe(true)
    expect(canSpeakAs(admins, 'member', 'owner')).toBe(false)
  })
})

describe('roleOf', () => {
  it('owner from the row, admin from the profile, member otherwise', () => {
    expect(roleOf({ mine: true }, 'fp-me')).toBe('owner')
    expect(roleOf({ mine: false, profile: profile({ admins: ['fp-me'] }) }, 'fp-me')).toBe('admin')
    expect(roleOf({ mine: false, profile: profile({ admins: ['fp-x'] }) }, 'fp-me')).toBe('member')
    expect(roleOf({ mine: false }, undefined)).toBe('member')
  })
})

describe('encodeGroupUri', () => {
  it('encodes gid / name / relay with keys in alphabetical order (Go url.Values.Encode)', () => {
    expect(encodeGroupUri('abc123', 'https://relay.example', 'My Group'))
      .toBe('soulmirror://group?gid=abc123&name=My+Group&relay=https%3A%2F%2Frelay.example')
    expect(encodeGroupUri('abc123', 'https://relay.example'))
      .toBe('soulmirror://group?gid=abc123&relay=https%3A%2F%2Frelay.example')
  })
})

describe('group_application badge fold', () => {
  it('counts frames per gid and clears on demand', () => {
    const req = { fp: 'fp-dave', name: 'Dave', note: 'hi' }
    let s = applyFrame(EMPTY_INBOX, { kind: 'group_application', gid: 'g1', request: req }).state
    s = applyFrame(s, { kind: 'group_application', gid: 'g1', request: req }).state
    s = applyFrame(s, { kind: 'group_application', gid: 'g2', request: req }).state
    expect(s.groupApps).toEqual({ g1: 2, g2: 1 })
    const cleared = clearGroupApps(s, 'g1')
    expect(cleared.groupApps).toEqual({ g2: 1 })
    // clearing an unknown gid is identity (no re-render churn)
    expect(clearGroupApps(cleared, 'g1')).toBe(cleared)
  })
})
