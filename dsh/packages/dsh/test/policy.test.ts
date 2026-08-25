/**
 * Reply policy (src/policy.ts): inbound routing per tier + loop guard, the
 * send gate (owner-initiated sends now; auto tier under the hourly cap sends
 * now flagged auto; everything else becomes a pending draft — P4), the
 * sliding hourly window.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_REPLY_TIER, HourlyWindow, isReplyTier, normalizeTier, routeInbound, sendGate, UNKNOWN_TRIGGER, type TurnTrigger } from '../src/policy.ts'

const owner: TurnTrigger = { kind: 'owner' }
const inboundBob: TurnTrigger = { kind: 'inbound', fp: 'fp-bob', name: 'Bob', messageId: 'm1' }
const inboundAutoBob: TurnTrigger = { kind: 'inbound-auto', fp: 'fp-bob', name: 'Bob', messageId: 'm2' }

describe('tiers', () => {
  it('validates and normalizes', () => {
    expect(isReplyTier('auto')).toBe(true)
    expect(isReplyTier('loud')).toBe(false)
    expect(normalizeTier('notify')).toBe('notify')
    expect(normalizeTier(undefined)).toBe(DEFAULT_REPLY_TIER)
    expect(normalizeTier('x', 'auto')).toBe('auto')
    expect(DEFAULT_REPLY_TIER).toBe('draft')
  })
})

describe('routeInbound (tier routing + loop guard)', () => {
  it('notify appends only; draft and auto wake the alter', () => {
    expect(routeInbound({ tier: 'notify', auto: false, isFriend: true })).toEqual({ action: 'append', reason: 'tier-notify' })
    expect(routeInbound({ tier: 'draft', auto: false, isFriend: true })).toEqual({ action: 'wake' })
    expect(routeInbound({ tier: 'auto', auto: false, isFriend: true })).toEqual({ action: 'wake' })
  })

  it('never wakes for auto-flagged mail (loop guard), whatever the tier', () => {
    for (const tier of ['notify', 'draft', 'auto'] as const) {
      expect(routeInbound({ tier, auto: true, isFriend: true })).toEqual({ action: 'append', reason: 'loop-guard-auto' })
    }
  })

  it('never wakes for a non-friend', () => {
    expect(routeInbound({ tier: 'auto', auto: false, isFriend: false })).toEqual({ action: 'append', reason: 'not-a-friend' })
  })
})

describe('sendGate (send now vs pending draft)', () => {
  it('owner-initiated turns send now, not flagged auto, to any friend in every tier', () => {
    for (const tier of ['notify', 'draft', 'auto'] as const) {
      expect(sendGate({ trigger: owner, target: 'fp-bob', tier, autoSentInWindow: 99, limit: 20 })).toEqual({ kind: 'allow', auto: false, reason: 'owner-initiated' })
      expect(sendGate({ trigger: owner, target: 'fp-carol', tier, autoSentInWindow: 0, limit: 20 })).toEqual({ kind: 'allow', auto: false, reason: 'owner-initiated' })
    }
  })

  it('a turn woken by the target friend in the auto tier sends flagged auto while under the cap, else drafts', () => {
    expect(sendGate({ trigger: inboundBob, target: 'fp-bob', tier: 'auto', autoSentInWindow: 0, limit: 20 })).toEqual({ kind: 'allow', auto: true, reason: 'auto-tier' })
    expect(sendGate({ trigger: inboundBob, target: 'fp-bob', tier: 'auto', autoSentInWindow: 19, limit: 20 })).toEqual({ kind: 'allow', auto: true, reason: 'auto-tier' })
    expect(sendGate({ trigger: inboundBob, target: 'fp-bob', tier: 'auto', autoSentInWindow: 20, limit: 20 })).toEqual({ kind: 'draft', reason: 'rate-limited' })
    expect(sendGate({ trigger: inboundBob, target: 'fp-bob', tier: 'auto', autoSentInWindow: 0, limit: 0 })).toEqual({ kind: 'draft', reason: 'rate-limited' })
  })

  it('inbound-triggered turns in draft / notify tiers become drafts', () => {
    expect(sendGate({ trigger: inboundBob, target: 'fp-bob', tier: 'draft', autoSentInWindow: 0, limit: 20 })).toEqual({ kind: 'draft', reason: 'draft-tier' })
    expect(sendGate({ trigger: inboundBob, target: 'fp-bob', tier: 'notify', autoSentInWindow: 0, limit: 20 })).toEqual({ kind: 'draft', reason: 'notify-tier' })
  })

  it('answering friend A by writing to friend B is a draft, even in the auto tier', () => {
    expect(sendGate({ trigger: inboundBob, target: 'fp-carol', tier: 'auto', autoSentInWindow: 0, limit: 20 })).toEqual({ kind: 'draft', reason: 'other-friend' })
  })

  it('a turn woken by an auto-flagged mail never sends freely (loop guard, belt and braces)', () => {
    expect(sendGate({ trigger: inboundAutoBob, target: 'fp-bob', tier: 'auto', autoSentInWindow: 0, limit: 20 })).toEqual({ kind: 'draft', reason: 'loop-guard-auto' })
  })

  it('unknown triggers draft', () => {
    expect(sendGate({ trigger: UNKNOWN_TRIGGER, target: 'fp-bob', tier: 'auto', autoSentInWindow: 0, limit: 20 })).toEqual({ kind: 'draft', reason: 'unknown-trigger' })
  })
})

describe('HourlyWindow (rate limit)', () => {
  it('counts hits inside the window per key and forgets them after an hour', () => {
    const w = new HourlyWindow()
    const t0 = 1_000_000
    expect(w.count('a', t0)).toBe(0)
    expect(w.record('a', t0)).toBe(1)
    expect(w.record('a', t0 + 1_000)).toBe(2)
    expect(w.record('b', t0)).toBe(1)
    expect(w.count('a', t0 + 1_000)).toBe(2)
    expect(w.retryAfter('a', t0 + 1_000)).toBe(3_600_000 - 1_000)
    // one hour after the first hit: only the second remains
    expect(w.count('a', t0 + 3_600_000)).toBe(1)
    expect(w.count('a', t0 + 3_601_000)).toBe(0)
    expect(w.retryAfter('a', t0 + 3_601_000)).toBe(0)
    expect(w.count('b', t0 + 10)).toBe(1)
  })

  it('honours a custom window', () => {
    const w = new HourlyWindow(100)
    w.record('k', 0)
    expect(w.count('k', 50)).toBe(1)
    expect(w.count('k', 100)).toBe(0)
  })
})
