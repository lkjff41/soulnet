/**
 * Conversation Node Definition for SoulMirror relayed rows in the NATIVE dsh
 * view of the alter session.
 *
 * The host writes each inbound A2A message as a `user/message` whose source is
 * `{ kind:'plugin', plugin:'soulmirror', form:'relay', senderSessionId, a2a:{…} }`
 * (see ../sessions/index.ts and SPIKE.md §1) — and, since P4, its own NOTES
 * (the owner decided a draft) with the same source plus `a2a.note`. This
 * definition folds exactly those events into `a2a-message` chat nodes that
 * ./A2ANode.tsx paints as a bubble (mail) or a system line (note).
 * ui-conversation's own `input-message` definition also renders the same
 * event as a collapsed "Context injection · soulmirror" row; shadowing that
 * row (keyed `context` renderer at priority -1) is still open.
 */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { A2AMessageData, A2ASourceMeta } from '../events.ts'
import { RELAY_FORM, SOULMIRROR_PLUGIN } from '../events.ts'

/** Renderer payload: the message plus the seq of the event that produced the node. */
export interface A2AChatData extends A2AMessageData {
  readonly seq: number
  readonly type?: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'a2a-message': A2AChatData
  }
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationStepDataMap {
    'a2a-message': A2AChatData
  }
}

interface RelaySource {
  kind?: unknown
  plugin?: unknown
  form?: unknown
  senderSessionId?: unknown
  a2a?: Partial<A2ASourceMeta>
}

/** Whether a `user/message` source is a SoulMirror relayed row (mail or note). */
export function isSoulmirrorRelaySource(source: unknown): source is RelaySource & { a2a?: Partial<A2ASourceMeta> } {
  const s = source as RelaySource | undefined
  return s?.kind === 'plugin' && s.plugin === SOULMIRROR_PLUGIN && s.form === RELAY_FORM
}

/** Strip the host's model-facing preamble (first line) so the bubble shows the mail body only. */
export function bodyOfRelayText(text: string): string {
  return text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : text
}

export const a2aRelayDefinition: ConversationNodeDefinition<A2AChatData> = {
  kind: 'a2a-message',
  target: 'chat',
  match: (event) => {
    if (event.type !== 'user/message') return null
    const source = (event.data as { source?: unknown }).source
    if (!isSoulmirrorRelaySource(source)) return null
    const id = typeof source.a2a?.id === 'string' ? source.a2a.id : String((event.data as { id: unknown }).id)
    return { id: `relay:${id}`, role: 'start' }
  },
  start: (_context, match) => {
    const data = match.event.data as { content: { type: string; text?: string }[]; source: RelaySource }
    const text = data.content.map(block => block.type === 'text' ? block.text ?? '' : '').join('')
    const a2a = data.source.a2a
    const note = typeof a2a?.note === 'string' ? a2a.note : undefined
    return {
      id: String(a2a?.id ?? match.event.seq) as A2AChatData['id'],
      dir: 'in',
      fp: String(a2a?.fp ?? '') as A2AChatData['fp'],
      name: typeof data.source.senderSessionId === 'string' ? data.source.senderSessionId : 'friend',
      // Notes keep their one-line text (the "[SoulMirror note] " prefix is stripped by the renderer).
      body: note === undefined ? bodyOfRelayText(text) : text.replace(/^\[SoulMirror note\]\s*/, ''),
      ts: typeof a2a?.ts === 'number' ? a2a.ts : match.event.time,
      ...(a2a?.auto === true ? { auto: true as const } : {}),
      ...(typeof a2a?.type === 'string' ? { type: a2a.type } : {}),
      ...(note === undefined ? {} : { note }),
      seq: match.event.seq,
    }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'a2a-message',
      id: context.id,
      target: 'chat',
      anchorSeq: context.state.seq,
      location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' as const },
      visibility: 'visible' as const,
      data: context.state,
    }
  },
}
