/**
 * What the owner needs to know about their alter, folded from the alter
 * session's durable event log (P3, reshaped in P4 for ONE alter session) —
 * pure, unit-tested in test/alter-state.test.ts:
 *
 *   - `triggerOf(events)`: what woke the CURRENT turn — the owner (a
 *     `user/message` with `source.kind === 'user'`), mail from a friend (the
 *     relay `user/message` the sessions plugin delivers; the trigger carries
 *     that friend's fingerprint / name), an auto-flagged mail, or unknown.
 *     `soulmirror_send_message` reads this to decide send-now vs draft
 *     (src/policy.ts `sendGate`); the persona variables resolve the per-turn
 *     friend context from it.
 *   - `latestFromEvents(events)`: the alter's latest state — its latest words
 *     to the owner (last assistant text), the last owner instruction, the
 *     last `soulmirror_send_message` call and its outcome (sent / draft
 *     queued / refused), and how the last turn ended.
 *   - `chatFromEvents(events)`: the transcript the SoulMirror page renders
 *     for "My alter": owner messages, the alter's replies, inbound mail from
 *     friends (with the friend context), what the alter sent / queued, the
 *     plugin's notes (draft decisions) and failed turns.
 *
 * The fold reads plain event envelopes (`{ type, seq, time, data }`) so it
 * needs no dsh value import; `Session.events` satisfies the shape.
 */
import type { TurnTrigger } from './policy.ts'
import { UNKNOWN_TRIGGER } from './policy.ts'
import { RELAY_FORM, SOULMIRROR_PLUGIN, type A2ANoteKind } from './events.ts'

export interface EventLike {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

export interface AlterNote {
  readonly text: string
  readonly ts: number
  readonly seq: number
  readonly turn: number
}

export interface AlterInstruction {
  readonly text: string
  readonly ts: number
  readonly seq: number
}

/** Outcome of a `soulmirror_send_message` call as the tool reported it. */
export type SendOutcome = 'sent' | 'draft-queued' | 'refused' | 'failed'

export interface AlterSend {
  readonly body: string
  readonly fingerprint?: string
  readonly ts: number
  /** Undefined while the tool result is pending. */
  readonly outcome?: SendOutcome
  /** The gate reason the tool reported (`owner-initiated`, `draft-tier`, …). */
  readonly gate?: string
  /** Draft id when the outcome is `draft-queued`. */
  readonly draftId?: string
  /** Error / refusal text when not sent. */
  readonly detail?: string
}

export interface AlterTurn {
  readonly turn: number
  readonly reason: string
  readonly failed: boolean
  readonly ts: number
  readonly message?: string
  /** The turn is still open (no `turn/end` yet). */
  readonly open: boolean
}

export interface AlterLatest {
  /** The last owner instruction in the log. */
  readonly instruction?: AlterInstruction
  /** The alter's latest words to the owner (last assistant text). */
  readonly note?: AlterNote
  /** The last `soulmirror_send_message` call. */
  readonly sent?: AlterSend
  /** The latest turn (open or closed). */
  readonly turn?: AlterTurn
  /** What woke the latest turn. */
  readonly trigger: TurnTrigger
  /** Number of events folded (the page uses it as a change marker). */
  readonly seq: number
}

export const EMPTY_LATEST: AlterLatest = { trigger: UNKNOWN_TRIGGER, seq: 0 }

type Rec = Record<string, unknown>
const rec = (value: unknown): Rec => (typeof value === 'object' && value !== null ? value as Rec : {})
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

/** Concatenate the text blocks of a message's content. */
export function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      const b = rec(block)
      return b['type'] === 'text' ? str(b['text']) : ''
    })
    .filter(t => t !== '')
    .join('\n')
    .trim()
}

/** The relay `a2a` block of a user/message, when the source is ours. */
export function relayMetaOf(data: unknown): { fp: string; id: string; ts: number; name: string; auto: boolean; type?: string; gid?: string; by?: string; agent?: string; note?: A2ANoteKind; draftId?: string } | undefined {
  const source = rec(rec(data)['source'])
  if (source['kind'] !== 'plugin' || source['plugin'] !== SOULMIRROR_PLUGIN || source['form'] !== RELAY_FORM) return undefined
  const a2a = rec(source['a2a'])
  const note = a2a['note']
  const type = a2a['type']
  const gid = a2a['gid']
  const by = a2a['by']
  const agent = a2a['agent']
  const draftId = a2a['draftId']
  return {
    fp: str(a2a['fp']),
    id: str(a2a['id']),
    ts: num(a2a['ts']),
    name: str(source['senderSessionId']),
    auto: a2a['auto'] === true,
    ...(typeof type === 'string' ? { type } : {}),
    ...(typeof gid === 'string' && gid !== '' ? { gid } : {}),
    ...(typeof by === 'string' && by !== '' ? { by } : {}),
    ...(typeof agent === 'string' && agent !== '' ? { agent } : {}),
    ...(typeof note === 'string' ? { note: note as A2ANoteKind } : {}),
    ...(typeof draftId === 'string' ? { draftId } : {}),
  }
}

/** Classify one `user/message` by its source: owner / inbound / inbound-auto / group / note (ours, not mail) / other. */
export function classifyUserMessage(data: unknown): 'owner' | 'inbound' | 'inbound-auto' | 'group' | 'note' | 'other' {
  const source = rec(rec(data)['source'])
  if (source['kind'] === 'user') return 'owner'
  const relay = relayMetaOf(data)
  if (relay === undefined) return 'other'
  if (relay.note !== undefined) return 'note'
  if (relay.gid !== undefined) return 'group'
  return relay.auto ? 'inbound-auto' : 'inbound'
}

/**
 * What woke the current (latest) turn: the first attributable `user/message`
 * after the last `turn/start`. No turn, or only tool results / injected
 * context / plugin notes in it → `unknown`.
 */
export function triggerOf(events: readonly EventLike[]): TurnTrigger {
  let start = -1
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]!.type === 'turn/start') {
      start = i
      break
    }
  }
  if (start < 0) return UNKNOWN_TRIGGER
  for (let i = start + 1; i < events.length; i += 1) {
    const event = events[i]!
    if (event.type !== 'user/message') continue
    const kind = classifyUserMessage(event.data)
    if (kind === 'other' || kind === 'note') continue
    if (kind === 'owner') return { kind: 'owner' }
    const relay = relayMetaOf(event.data)!
    if (kind === 'group') return { kind: 'group', fp: relay.fp, name: relay.name, messageId: relay.id, gid: relay.gid! }
    return { kind, fp: relay.fp, name: relay.name, messageId: relay.id }
  }
  return UNKNOWN_TRIGGER
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Read a `soulmirror_send_message` tool result back into an outcome. */
function outcomeOf(data: Rec): { outcome: SendOutcome; gate?: string; draftId?: string; detail?: string } {
  const message = rec(data['message'])
  const blocks = Array.isArray(message['content']) ? message['content'] : []
  const first = rec(blocks[0])
  const resultText = textOf(first['content'])
  const parsed = rec(parseJson(resultText))
  const errored = data['error'] !== undefined || first['isError'] === true
  const gate = str(parsed['gate'])
  const draftId = str(parsed['draftId'])
  if (errored) {
    const err = rec(data['error'])
    const detail = str(err['message']) || str(parsed['message']) || resultText.slice(0, 200)
    return { outcome: 'failed', ...(gate === '' ? {} : { gate }), ...(detail === '' ? {} : { detail }) }
  }
  const reported = str(parsed['outcome'])
  if (parsed['ok'] === true && reported === 'draft-queued') return { outcome: 'draft-queued', ...(gate === '' ? {} : { gate }), ...(draftId === '' ? {} : { draftId }) }
  if (parsed['ok'] === true) return { outcome: 'sent', ...(gate === '' ? {} : { gate }) }
  const detail = str(parsed['message']) || reported
  return { outcome: 'refused', ...(gate === '' ? {} : { gate }), ...(detail === '' ? {} : { detail }) }
}

/** Fold the whole log (or a suffix of it) into the latest alter state. */
export function latestFromEvents(events: readonly EventLike[]): AlterLatest {
  let instruction: AlterInstruction | undefined
  let note: AlterNote | undefined
  let sent: AlterSend | undefined
  let sendCallId: string | undefined
  let turn: AlterTurn | undefined
  for (const event of events) {
    const data = rec(event.data)
    switch (event.type) {
      case 'turn/start':
        turn = { turn: num(data['turn']), reason: 'open', failed: false, ts: event.time, open: true }
        break
      case 'turn/end': {
        const reason = rec(data['reason'])
        const kind = str(reason['kind']) || 'unknown'
        const message = turnEndMessage(reason)
        turn = {
          turn: num(data['turn'], turn?.turn ?? 0),
          reason: kind,
          failed: kind !== 'completed',
          ts: event.time,
          open: false,
          ...(message === undefined ? {} : { message }),
        }
        break
      }
      case 'user/message': {
        if (classifyUserMessage(event.data) !== 'owner') break
        const text = textOf(data['content'])
        if (text !== '') instruction = { text, ts: event.time, seq: event.seq }
        break
      }
      case 'assistant/message': {
        const message = rec(data['message'])
        const text = textOf(message['content'])
        if (text !== '') note = { text, ts: event.time, seq: event.seq, turn: num(data['turn'], turn?.turn ?? 0) }
        break
      }
      case 'tool/call': {
        if (data['name'] !== 'soulmirror_send_message') break
        const args = rec(parseJson(str(data['arguments'])))
        const body = str(args['body'])
        const fingerprint = str(args['fingerprint'])
        sendCallId = str(data['callId'])
        sent = { body, ts: event.time, ...(fingerprint === '' ? {} : { fingerprint }) }
        break
      }
      case 'tool/result': {
        if (sent === undefined || sendCallId === undefined) break
        const message = rec(data['message'])
        const source = rec(message['source'])
        if (str(source['callId']) !== sendCallId) break
        sent = { ...sent, ...outcomeOf(data) }
        break
      }
      default:
        break
    }
  }
  return {
    ...(instruction === undefined ? {} : { instruction }),
    ...(note === undefined ? {} : { note }),
    ...(sent === undefined ? {} : { sent }),
    ...(turn === undefined ? {} : { turn }),
    trigger: triggerOf(events),
    seq: events.length === 0 ? 0 : events[events.length - 1]!.seq + 1,
  }
}

function turnEndMessage(reason: Rec): string | undefined {
  const cause = reason['reason']
  if (typeof cause === 'string') return cause
  if (typeof reason['message'] === 'string') return reason['message']
  if (typeof rec(cause)['message'] === 'string') return str(rec(cause)['message'])
  if (typeof rec(reason['error'])['message'] === 'string') return str(rec(reason['error'])['message'])
  return undefined
}

// ——— the "My alter" transcript ———

export type AlterChatItem =
  /** The owner spoke (page composer or dsh's input bar); `revise` when it was the page's "let the alter revise" feedback on a draft. */
  | { readonly kind: 'owner'; readonly key: string; readonly ts: number; readonly text: string; readonly revise?: { readonly name: string; readonly fp: string } }
  /** The alter answered the owner (assistant text). */
  | { readonly kind: 'alter'; readonly key: string; readonly ts: number; readonly text: string; readonly turn: number }
  /** Mail from a friend — or a group message (`gid` set) — reached the alter (relayed into the session). */
  | { readonly kind: 'inbound'; readonly key: string; readonly ts: number; readonly fp: string; readonly name: string; readonly id: string; readonly body: string; readonly auto: boolean; readonly type?: string; readonly gid?: string }
  /** The alter called `soulmirror_send_message`. */
  | { readonly kind: 'send'; readonly key: string; readonly ts: number; readonly fp: string; readonly body: string; readonly outcome?: SendOutcome; readonly gate?: string; readonly draftId?: string; readonly detail?: string; readonly auto: boolean }
  /** The plugin's own note (the owner decided a draft). */
  | { readonly kind: 'note'; readonly key: string; readonly ts: number; readonly note: A2ANoteKind; readonly fp: string; readonly text: string; readonly draftId?: string }
  /** A turn ended without completing (no model, provider error, cancelled …). */
  | { readonly kind: 'turn-failed'; readonly key: string; readonly ts: number; readonly turn: number; readonly reason: string; readonly message?: string }
  /** PROCESS (agent panes; `chatFromEvents` opts.process): the model's visible reasoning before it acted. `streaming` while the deltas are still arriving. */
  | { readonly kind: 'thinking'; readonly key: string; readonly ts: number; readonly text: string; readonly streaming?: boolean }
  /** PROCESS (agent panes): a tool call other than the SoulMirror sends. */
  | { readonly kind: 'tool'; readonly key: string; readonly ts: number; readonly name: string; readonly args: string }

export interface AlterChat {
  readonly items: readonly AlterChatItem[]
  /** A turn is open (its `turn/end` has not been logged). */
  readonly running: boolean
  /** Change marker (last seq + 1). */
  readonly seq: number
}

export const EMPTY_CHAT: AlterChat = { items: [], running: false, seq: 0 }

/** The owner instruction the sessions plugin writes for "let the alter revise" (name, fp, feedback). */
export const REVISE_INSTRUCTION = /^Revise your draft to (.+?) \(fingerprint ([A-Za-z0-9_-]+)\)\.[\s\S]*?My feedback: ([\s\S]*?)\nSend the revised message/u

/** Strip the host's model-facing preamble (first line) so the bubble shows the mail body only. */
export function bodyOfRelayText(text: string): string {
  return text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : text
}

/** Concatenate the reasoning blocks of a message's content (the model's visible thinking). */
export function reasoningOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      const b = rec(block)
      return b['type'] === 'reasoning' ? str(b['text']) : ''
    })
    .filter(t => t !== '')
    .join('\n')
    .trim()
}

/** Fold the alter session log into the transcript the page renders. `process` adds the working trace (thinking + other tool calls) for agent panes. */
export function chatFromEvents(events: readonly EventLike[], opts: { process?: boolean } = {}): AlterChat {
  const items: AlterChatItem[] = []
  const sendIndexByCall = new Map<string, number>()
  // One streaming thinking item per (turn, step) phase, appended in place and
  // finalized by the block end / the assistant message / the turn end.
  const thinkingIndexByPhase = new Map<string, number>()
  const finalizeThinking = (phase: string, full: string): void => {
    const index = thinkingIndexByPhase.get(phase)
    if (index === undefined) return
    const prev = items[index]!
    if (prev.kind === 'thinking') items[index] = { ...prev, ...(full === '' ? {} : { text: full }), streaming: false }
  }
  const appendThinking = (phase: string, delta: string, ts: number): void => {
    const index = thinkingIndexByPhase.get(phase)
    if (index === undefined) {
      items.push({ kind: 'thinking', key: `think:${phase}`, ts, text: delta, streaming: true })
      thinkingIndexByPhase.set(phase, items.length - 1)
      return
    }
    const prev = items[index]!
    if (prev.kind === 'thinking') items[index] = { ...prev, text: prev.text + delta }
  }
  let running = false
  let turn = 0
  for (const event of events) {
    const data = rec(event.data)
    switch (event.type) {
      case 'turn/start':
        running = true
        turn = num(data['turn'], turn)
        break
      case 'turn/end': {
        running = false
        for (const index of thinkingIndexByPhase.values()) {
          const prev = items[index]!
          if (prev.kind === 'thinking' && prev.streaming === true) items[index] = { ...prev, streaming: false }
        }
        const reason = rec(data['reason'])
        const kind = str(reason['kind']) || 'unknown'
        if (kind !== 'completed') {
          const message = turnEndMessage(reason)
          items.push({ kind: 'turn-failed', key: `turn:${event.seq}`, ts: event.time, turn: num(data['turn'], turn), reason: kind, ...(message === undefined ? {} : { message }) })
        }
        break
      }
      case 'user/message': {
        const cls = classifyUserMessage(event.data)
        if (cls === 'owner') {
          const text = textOf(data['content'])
          if (text === '') break
          const revise = REVISE_INSTRUCTION.exec(text)
          items.push(revise === null
            ? { kind: 'owner', key: `owner:${event.seq}`, ts: event.time, text }
            : { kind: 'owner', key: `owner:${event.seq}`, ts: event.time, text: revise[3]!.trim(), revise: { name: revise[1]!, fp: revise[2]! } })
          break
        }
        if (cls === 'other') break
        const relay = relayMetaOf(event.data)!
        const text = textOf(data['content'])
        if (cls === 'note') {
          items.push({ kind: 'note', key: `note:${event.seq}`, ts: event.time, note: relay.note!, fp: relay.fp, text: text.replace(/^\[SoulMirror note\]\s*/, ''), ...(relay.draftId === undefined ? {} : { draftId: relay.draftId }) })
          break
        }
        items.push({
          kind: 'inbound', key: `in:${event.seq}`, ts: relay.ts > 0 ? relay.ts : event.time, fp: relay.fp, name: relay.name, id: relay.id,
          body: bodyOfRelayText(text), auto: relay.auto, ...(relay.type === undefined ? {} : { type: relay.type }), ...(relay.gid === undefined ? {} : { gid: relay.gid }),
        })
        break
      }
      case 'assistant/message': {
        const message = rec(data['message'])
        if (opts.process === true) {
          const thinking = reasoningOf(message['content'])
          const phase = `${num(data['turn'], turn)}:${num(data['step'], 0)}`
          if (thinkingIndexByPhase.has(phase)) finalizeThinking(phase, thinking)
          else if (thinking !== '') items.push({ kind: 'thinking', key: `think:${event.seq}`, ts: event.time, text: thinking })
        }
        const text = textOf(message['content'])
        if (text !== '') items.push({ kind: 'alter', key: `alter:${event.seq}`, ts: event.time, text, turn: num(data['turn'], turn) })
        break
      }
      case 'assistant/chunk': {
        // Live reasoning deltas (streaming) + the authoritative block end.
        if (opts.process !== true) break
        const chunk = rec(data['chunk'])
        const phase = `${num(data['turn'], turn)}:${num(data['step'], 0)}`
        const ctype = str(chunk['type'])
        if (ctype === 'block-end' && str(rec(chunk['block'])['type']) === 'reasoning') {
          const full = str(rec(chunk['block'])['text'])
          if (thinkingIndexByPhase.has(phase)) finalizeThinking(phase, full)
          else if (full !== '') items.push({ kind: 'thinking', key: `think:${phase}:${event.seq}`, ts: event.time, text: full })
          break
        }
        const delta = ctype === 'reasoning-delta' ? (str(chunk['text']) || str(chunk['textDelta']) || str(chunk['delta'])) : ''
        if (delta !== '') appendThinking(phase, delta, event.time)
        break
      }
      case 'reasoning-chunks': {
        // The persisted aggregate of the reasoning deltas (replayed logs).
        if (opts.process !== true) break
        const texts = Array.isArray(data['texts']) ? (data['texts'] as unknown[]).filter((x): x is string => typeof x === 'string') : []
        if (texts.length === 0) break
        appendThinking(`${num(data['turn'], turn)}:${num(data['step'], 0)}`, texts.join(''), event.time)
        break
      }
      case 'tool/call': {
        const toolName = str(data['name'])
        if (toolName !== 'soulmirror_send_message' && toolName !== 'soulmirror_send_group_message') {
          if (opts.process === true) items.push({ kind: 'tool', key: `tool:${event.seq}`, ts: event.time, name: toolName, args: str(data['arguments']).slice(0, 200) })
          break
        }
        const args = rec(parseJson(str(data['arguments'])))
        const callId = str(data['callId'])
        items.push({ kind: 'send', key: `send:${event.seq}`, ts: event.time, fp: str(args['fingerprint']) || str(args['gid']), body: str(args['body']), auto: false })
        if (callId !== '') sendIndexByCall.set(callId, items.length - 1)
        break
      }
      case 'tool/result': {
        const message = rec(data['message'])
        const callId = str(rec(message['source'])['callId'])
        const index = sendIndexByCall.get(callId)
        if (index === undefined) break
        const previous = items[index]!
        if (previous.kind !== 'send') break
        const outcome = outcomeOf(data)
        const blocks = Array.isArray(message['content']) ? message['content'] : []
        const parsed = rec(parseJson(textOf(rec(blocks[0])['content'])))
        items[index] = { ...previous, ...outcome, auto: parsed['auto'] === true }
        break
      }
      default:
        break
    }
  }
  return { items, running, seq: events.length === 0 ? 0 : events[events.length - 1]!.seq + 1 }
}

/** Event types that change what the folds answer (the sessions plugin broadcasts on these). */
export const ALTER_EVENT_TYPES: ReadonlySet<string> = new Set([
  'turn/start', 'turn/end', 'user/message', 'assistant/message', 'tool/call', 'tool/result',
])
