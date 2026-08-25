/**
 * Shared vocabulary of soulnet-dsh: branded ids and the
 * `user/message` source tag that marks an inbound A2A mail.
 *
 * There is deliberately NO custom SessionEventMap merge here any more. The P0
 * spike (dsh/SPIKE.md §1) showed that a custom durable event type makes the
 * session log unloadable (the persistence read path refuses unknown,
 * non-ignorable types), so every inbound mail is written as an ordinary
 * `user/message` whose `source` carries the fields below; the client half
 * recognises that source and renders the message as a chat bubble.
 *
 * P4: the same relay source also carries the plugin's own NOTES into the
 * alter session (the owner approved / rejected / edited a draft) — marked by
 * `a2a.note`, never woken as a turn, rendered as a system line.
 *
 * Keep this file free of runtime imports apart from constants: the client
 * bundle imports it as well.
 */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable A2A message id (the relay envelope id; replay-safe). */
export type A2AMessageId = Branded<'A2AMessageId'>
/** Fingerprint of a peer's signing key (the A2A identity). */
export type Fingerprint = Branded<'Fingerprint'>

/** `source.plugin` of the `user/message` carrying an inbound A2A mail. */
export const SOULMIRROR_PLUGIN = 'soulmirror'
/** `source.form` of that message: dsh's built-in "a message another agent addressed to this one". */
export const RELAY_FORM = 'relay'

/** Kinds of plugin notes written into the alter session (P4 draft decisions). */
export type A2ANoteKind = 'draft-approved' | 'draft-rejected' | 'draft-revise'

/** The extra `a2a` block the host attaches to the relay source (wire-extensible; the literal type is closed upstream). */
export interface A2ASourceMeta {
  readonly id: string
  readonly fp: string
  readonly ts: number
  readonly auto?: true
  /** A2A message type (`text`, `app_share`, …); absent means `text`. */
  readonly type?: string
  /** Group id when the mail is a group message (wire spec §14.7); the trigger becomes kind `group`. */
  readonly gid?: string
  /** Message provenance in a group: `owner` (human) or `alter`. */
  readonly by?: string
  /** Which of the sender's seat agents composed a by=alter group post (display provenance). */
  readonly agent?: string
  /** Set on the plugin's own notes (draft decisions): not mail, never a turn trigger. */
  readonly note?: A2ANoteKind
  /** Draft id the note refers to. */
  readonly draftId?: string
}

/** Shape the client renderer derives from such a `user/message` (one bubble). */
export interface A2AMessageData {
  readonly id: A2AMessageId
  /** `in`: friend → me; `out`: me → friend. */
  readonly dir: 'in' | 'out'
  /** Peer fingerprint (the friend this message belongs to). */
  readonly fp: Fingerprint
  /** Display name of the peer at send time. */
  readonly name: string
  readonly body: string
  /** Unix epoch ms at the sender. */
  readonly ts: number
  /** Outbound delivery state; absent on inbound. */
  readonly delivery?: 'queued' | 'sent' | 'failed'
  /** Set when the message was produced by a peer's auto-reply (loop guard). */
  readonly auto?: true
  /** Set when the row is a plugin note (draft decision), not mail. */
  readonly note?: A2ANoteKind
}
