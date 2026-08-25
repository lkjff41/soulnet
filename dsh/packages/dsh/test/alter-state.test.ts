/**
 * Alter state (src/alter-state.ts): what woke the current turn (`triggerOf`,
 * now carrying the friend), the fold of the alter session log into the
 * owner's view (`latestFromEvents`: instruction, note, send outcome, turn),
 * and the transcript fold the page renders (`chatFromEvents`).
 */
import { describe, expect, it } from 'vitest'
import { chatFromEvents, classifyUserMessage, latestFromEvents, relayMetaOf, textOf, triggerOf, type EventLike } from '../src/alter-state.ts'
import { noteMessageFor, ownerMessageFor, userMessageFor } from '../src/sessions/index.ts'

let seq = 0
let clock = 1_700_000_000_000
const ev = (type: string, data: unknown): EventLike => ({ type, seq: seq++, time: clock++, data })
const owner = (text: string): EventLike => ev('user/message', ownerMessageFor(text))
const inbound = (body: string, auto?: true, fp = 'fp-bob', name = 'Bob'): EventLike => ev('user/message', userMessageFor({
  id: `m-${seq}` as never, from: fp as never, name, body, ts: clock, ...(auto ? { auto } : {}),
}, name))
const note = (kind: 'draft-approved' | 'draft-rejected' | 'draft-revise', text: string): EventLike => ev('user/message', noteMessageFor(kind, { id: 'draft-1', fp: 'fp-bob', name: 'Bob', body: 'x', createdAt: new Date().toISOString(), reason: 'draft-tier' }, text))
const assistant = (text: string, turn = 1): EventLike => ev('assistant/message', { turn, step: 1, message: { id: 'a', role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'p', model: 'm' } } })
const toolCall = (callId: string, args: unknown, turn = 1): EventLike => ev('tool/call', { turn, step: 1, callId, name: 'soulmirror_send_message', arguments: JSON.stringify(args) })
const toolResult = (callId: string, result: unknown, error?: { name: string; code: string }): EventLike => ev('tool/result', {
  turn: 1, step: 1,
  message: { id: 'r', role: 'user', content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: JSON.stringify(result) }] }], source: { kind: 'tool', callId } },
  ...(error === undefined ? {} : { error }),
})

describe('classifyUserMessage / relayMetaOf / textOf', () => {
  it('tells the owner from the friend, auto mail and plugin notes', () => {
    expect(classifyUserMessage(ownerMessageFor('hi'))).toBe('owner')
    expect(classifyUserMessage(inbound('yo').data)).toBe('inbound')
    expect(classifyUserMessage(inbound('yo', true).data)).toBe('inbound-auto')
    expect(classifyUserMessage(note('draft-approved', 'sent').data)).toBe('note')
    expect(classifyUserMessage({ source: { kind: 'plugin', plugin: 'other' } })).toBe('other')
    expect(classifyUserMessage({ source: { kind: 'tool', callId: 'c' } })).toBe('other')
  })
  it('reads the relay meta (friend fp / name / note / draft id)', () => {
    expect(relayMetaOf(inbound('yo').data)).toMatchObject({ fp: 'fp-bob', name: 'Bob', auto: false })
    expect(relayMetaOf(note('draft-rejected', 'no').data)).toMatchObject({ fp: 'fp-bob', note: 'draft-rejected', draftId: 'draft-1' })
    expect(relayMetaOf(ownerMessageFor('x'))).toBeUndefined()
  })
  it('joins text blocks only', () => {
    expect(textOf([{ type: 'text', text: 'a' }, { type: 'reasoning', text: 'x' }, { type: 'text', text: 'b' }])).toBe('a\nb')
    expect(textOf('nope')).toBe('')
  })
})

describe('triggerOf', () => {
  it('is unknown without a turn', () => {
    expect(triggerOf([])).toEqual({ kind: 'unknown' })
    expect(triggerOf([inbound('appended outside any turn')])).toEqual({ kind: 'unknown' })
  })

  it('owner instruction claimed by the latest turn → owner (no friend, even when it names one)', () => {
    const log = [inbound('mail appended earlier (notify tier)'), ev('turn/start', { turn: 1 }), owner('tell Bob ok')]
    expect(triggerOf(log)).toEqual({ kind: 'owner' })
  })

  it('relay mail claimed by the latest turn → inbound WITH the friend; auto-flagged → inbound-auto; earlier turns do not count', () => {
    const log = [ev('turn/start', { turn: 1 }), owner('x'), ev('turn/end', { turn: 1, reason: { kind: 'completed' } }), ev('turn/start', { turn: 2 }), inbound('are you there?', undefined, 'fp-carol', 'Carol')]
    expect(triggerOf(log)).toMatchObject({ kind: 'inbound', fp: 'fp-carol', name: 'Carol' })
    const auto = [ev('turn/start', { turn: 3 }), inbound('(auto) got it', true)]
    expect(triggerOf(auto)).toMatchObject({ kind: 'inbound-auto', fp: 'fp-bob' })
  })

  it('skips tool results, plugin notes and other producers inside the turn', () => {
    const log = [ev('turn/start', { turn: 1 }), ev('user/message', { role: 'user', content: [], source: { kind: 'tool', callId: 'c' } }), note('draft-approved', 'sent'), owner('now')]
    expect(triggerOf(log)).toEqual({ kind: 'owner' })
    const only = [ev('turn/start', { turn: 1 }), ev('user/message', { role: 'user', content: [], source: { kind: 'plugin', plugin: 'skills' } })]
    expect(triggerOf(only)).toEqual({ kind: 'unknown' })
  })
})

describe('latestFromEvents', () => {
  it('is empty for an empty log', () => {
    expect(latestFromEvents([])).toEqual({ trigger: { kind: 'unknown' }, seq: 0 })
  })

  it('folds instruction → send → note of one owner-initiated turn', () => {
    const log = [
      ev('turn/start', { turn: 1 }),
      owner('tell Bob I am in'),
      toolCall('c1', { fingerprint: 'fp-bob', body: 'I am in!' }),
      toolResult('c1', { ok: true, outcome: 'sent', gate: 'owner-initiated', auto: false }),
      assistant('已替你发出：I am in!'),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    const latest = latestFromEvents(log)
    expect(latest.trigger).toEqual({ kind: 'owner' })
    expect(latest.instruction?.text).toBe('tell Bob I am in')
    expect(latest.sent).toMatchObject({ body: 'I am in!', fingerprint: 'fp-bob', outcome: 'sent', gate: 'owner-initiated' })
    expect(latest.note?.text).toBe('已替你发出：I am in!')
    expect(latest.turn).toMatchObject({ turn: 1, reason: 'completed', failed: false, open: false })
    expect(latest.seq).toBe(log[log.length - 1]!.seq + 1)
  })

  it('a draft-queued send keeps the draft id; a refused send keeps the detail', () => {
    const queued = [
      ev('turn/start', { turn: 2 }),
      inbound('can you lend me 500?'),
      toolCall('c2', { fingerprint: 'fp-bob', body: 'Sure' }),
      toolResult('c2', { ok: true, outcome: 'draft-queued', gate: 'draft-tier', draftId: 'draft-7', auto: false }),
      assistant('A draft is waiting for you.'),
      ev('turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ]
    const latest = latestFromEvents(queued)
    expect(latest.trigger).toMatchObject({ kind: 'inbound', fp: 'fp-bob' })
    expect(latest.sent).toMatchObject({ body: 'Sure', outcome: 'draft-queued', gate: 'draft-tier', draftId: 'draft-7' })
    const refused = latestFromEvents([ev('turn/start', { turn: 3 }), inbound('q'), toolCall('c3', { fingerprint: 'fp-bob', body: 'x' }), toolResult('c3', { ok: false, outcome: 'rejected', gate: 'unknown-trigger', message: 'The user rejected it' })])
    expect(refused.sent).toMatchObject({ outcome: 'refused', detail: 'The user rejected it' })
  })

  it('a failed turn is reported with its reason / message; a tool error marks the send failed', () => {
    const log = [
      ev('turn/start', { turn: 1 }),
      owner('hi'),
      toolCall('c3', { fingerprint: 'fp-bob', body: 'x' }),
      toolResult('c3', { error: 'boom' }, { name: 'NetworkError', code: '-32006' }),
      ev('turn/end', { turn: 1, reason: { kind: 'failed', message: 'MISSING_CREDENTIAL: no key' } }),
    ]
    const latest = latestFromEvents(log)
    expect(latest.turn).toMatchObject({ reason: 'failed', failed: true, message: 'MISSING_CREDENTIAL: no key', open: false })
    expect(latest.sent?.outcome).toBe('failed')
    expect(latest.note).toBeUndefined()
    const aborted = latestFromEvents([ev('turn/start', { turn: 1 }), owner('hi'), ev('turn/end', { turn: 1, reason: { kind: 'aborted', reason: 'user-stop' } })])
    expect(aborted.turn).toMatchObject({ reason: 'aborted', failed: true, message: 'user-stop' })
  })
})

describe('chatFromEvents (the "My alter" transcript)', () => {
  it('folds owner / alter / inbound / send / note / failed-turn items in log order, attaching the send outcome to its call', () => {
    const log = [
      ev('turn/start', { turn: 1 }),
      owner('tell Bob I am in'),
      toolCall('c1', { fingerprint: 'fp-bob', body: 'I am in!' }),
      toolResult('c1', { ok: true, outcome: 'sent', gate: 'owner-initiated', auto: false }),
      assistant('Sent to Bob: I am in!'),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
      ev('turn/start', { turn: 2 }),
      inbound('great, see you', undefined, 'fp-bob', 'Bob'),
      toolCall('c2', { fingerprint: 'fp-bob', body: 'See you!' }),
      toolResult('c2', { ok: true, outcome: 'draft-queued', gate: 'draft-tier', draftId: 'draft-1', auto: false }),
      assistant('Drafted a reply; waiting for you.', 2),
      ev('turn/end', { turn: 2, reason: { kind: 'completed' } }),
      note('draft-approved', 'The owner approved your draft draft-1 to Bob.'),
      ev('turn/start', { turn: 3 }),
      owner('ask Carol about the venue'),
      ev('turn/end', { turn: 3, reason: { kind: 'failed', message: 'no provider' } }),
    ]
    const chat = chatFromEvents(log)
    expect(chat.running).toBe(false)
    expect(chat.items.map(i => i.kind)).toEqual(['owner', 'send', 'alter', 'inbound', 'send', 'alter', 'note', 'owner', 'turn-failed'])
    expect(chat.items[1]).toMatchObject({ kind: 'send', fp: 'fp-bob', body: 'I am in!', outcome: 'sent', gate: 'owner-initiated', auto: false })
    expect(chat.items[3]).toMatchObject({ kind: 'inbound', fp: 'fp-bob', name: 'Bob', body: 'great, see you', auto: false })
    expect(chat.items[4]).toMatchObject({ kind: 'send', outcome: 'draft-queued', draftId: 'draft-1' })
    expect(chat.items[6]).toMatchObject({ kind: 'note', note: 'draft-approved', fp: 'fp-bob', draftId: 'draft-1', text: 'The owner approved your draft draft-1 to Bob.' })
    expect(chat.items[8]).toMatchObject({ kind: 'turn-failed', turn: 3, reason: 'failed', message: 'no provider' })
    expect(chat.seq).toBe(log[log.length - 1]!.seq + 1)
  })

  it('reports an open turn as running and a pending send without outcome', () => {
    const chat = chatFromEvents([ev('turn/start', { turn: 1 }), owner('go'), toolCall('c9', { fingerprint: 'fp-bob', body: 'hi' })])
    expect(chat.running).toBe(true)
    expect(chat.items.at(-1)).toMatchObject({ kind: 'send', body: 'hi' })
    expect((chat.items.at(-1) as { outcome?: string }).outcome).toBeUndefined()
  })
})
