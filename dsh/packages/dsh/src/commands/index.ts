/**
 * soulmirror-commands — host slash commands (`ctx.commands.register`):
 *
 *   /card                show this user's card URI
 *   /friends             list friends (presence, unread); the client half
 *                        decorates the bare invocation with a popup that opens
 *                        a friend's session
 *   /add <card_uri> [note]
 *                        send a friend request (the human typing the command
 *                        IS the approval; commands run outside a model turn, so
 *                        ctx.approval cannot be used here)
 *   /soulmirror          open the SoulMirror page ("My alter" + friends); the
 *                        client half decorates the bare invocation with a
 *                        popup (the page / one friend) — the host handler only
 *                        prints the hint, since a host command cannot drive
 *                        the browser UI
 *
 * Results are rendered by the composer and never enter model history.
 * No @deepseek-ai value imports (see ../index.ts header).
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
// Type-only: the ctx.commands Context merge.
import type {} from '@deepseek-ai/dsh-commands'
import { NetworkError } from '../network/types.ts'
import type {} from '../index.ts'

export const name = 'soulmirror-commands'
export const inject = ['commands', 'soulmirror']

const fail = (text: string): CommandResult => ({ kind: 'error', text })
const ok = (text: string): CommandResult => ({ kind: 'success', text })

function describeError(error: unknown): string {
  if (error instanceof NetworkError) return `${error.message} (code ${error.code})`
  return error instanceof Error ? error.message : String(error)
}

export function apply(ctx: Context): void {
  const net = ctx.soulmirror

  ctx.commands.register({
    name: 'card',
    description: 'Show my SoulMirror card URI (paste it to others so they can add me).',
    async handler() {
      try {
        const identity = await net.identity()
        if (identity === undefined) return fail('No SoulMirror identity yet. Create one in Settings → SoulMirror network.')
        return ok(`SoulMirror card of ${identity.name} (${identity.fp}):\n${identity.cardUri}`)
      } catch (error: unknown) {
        return fail(`Could not read the card: ${describeError(error)}`)
      }
    },
  })

  ctx.commands.register({
    name: 'friends',
    description: 'List SoulMirror friends (presence, unread) and pending friend requests.',
    async handler() {
      try {
        const [friends, pending] = await Promise.all([net.friends.list(), net.friends.pending()])
        let online: Record<string, boolean> = {}
        try {
          online = await net.presence(friends.map(f => f.fp))
        } catch {
          // best effort
        }
        const lines = friends.map((f) => {
          const on = online[f.fp] ?? f.online
          return `${on === true ? '●' : '○'} ${f.name}  ${f.fp}${f.unread > 0 ? `  (${f.unread} unread)` : ''}${f.typing === true ? '  typing…' : ''}`
        })
        if (lines.length === 0) lines.push('(no friends yet — /add <card_uri> to send a request)')
        if (pending.length > 0) {
          lines.push('', `Pending requests (${pending.length}; accept/reject on the SoulMirror page):`)
          for (const p of pending) lines.push(`  ${p.name}  ${p.fp}${p.greeting === '' ? '' : `  "${p.greeting}"`}`)
        }
        return ok(lines.join('\n'))
      } catch (error: unknown) {
        return fail(`Could not list friends: ${describeError(error)}`)
      }
    },
  })

  ctx.commands.register({
    name: 'add',
    description: 'Send a SoulMirror friend request: /add <card_uri> [note]',
    input: { hint: '<card_uri> [note]' },
    async handler(invocation) {
      const raw = invocation.rawInput.trim()
      if (raw === '') return fail('Usage: /add <card_uri> [note]')
      const space = raw.search(/\s/)
      const cardUri = space === -1 ? raw : raw.slice(0, space)
      const note = space === -1 ? undefined : raw.slice(space).trim()
      try {
        const parsed = await net.parseCard(cardUri)
        const friend = await net.friends.add(cardUri, note === '' ? undefined : note)
        return ok(`Friend request sent to ${parsed.name !== '' ? parsed.name : friend.name} (${friend.fp}). Messages can be exchanged once they accept.`)
      } catch (error: unknown) {
        return fail(`Could not send the friend request: ${describeError(error)}`)
      }
    },
  })

  ctx.commands.register({
    name: 'soulmirror',
    description: 'Open the SoulMirror page: talk to your alter, watch its conversations with your friends, review its drafts.',
    async handler() {
      try {
        const [friends, pending] = await Promise.all([net.friends.list(), net.friends.pending()])
        const unread = friends.reduce((sum, f) => sum + (f.unread > 0 ? f.unread : 0), 0)
        const drafts = (ctx as unknown as { get(name: string): unknown }).get('soulmirrorSessions') as { drafts: { count(): number } } | undefined
        const pendingDrafts = drafts?.drafts.count() ?? 0
        return ok(`SoulMirror page: ${friends.length} friend(s), ${unread} unread, ${pending.length} pending request(s), ${pendingDrafts} draft(s) of your alter waiting for review. Open it from the "SoulMirror" entry at the sidebar foot (or pick "My alter" / a friend from the /soulmirror popup).`)
      } catch (error: unknown) {
        return fail(`Could not read the network state: ${describeError(error)}`)
      }
    },
  })

  ctx.logger.info('soulmirror-commands: registered /card, /friends, /add, /soulmirror')
}
