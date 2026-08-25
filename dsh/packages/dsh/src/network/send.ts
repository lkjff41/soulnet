/**
 * Send through the peer and read the archived entry back (shared by the
 * browser API's direct send and the alter's `soulmirror_send_message` tool):
 * the peer answers `seq` / `status`; the archive line carries the exact `ts`
 * and `auto` flag, which the SoulMirror page needs to reconcile its
 * optimistic bubble or to paint the alter's send. Falls back to a constructed
 * entry when the read-back misses.
 */
import type { Fingerprint } from '../events.ts'
import type { ConversationEntry, NetworkClient, SendOptions, SendReceipt } from './types.ts'

export interface SentEntry {
  readonly entry: ConversationEntry
  readonly receipt: { id: string; seq?: number; status: string }
}

export async function sendAndArchive(client: NetworkClient, fp: Fingerprint, body: string, options?: SendOptions): Promise<SentEntry> {
  const receipt: SendReceipt = await client.send(fp, body, options)
  let entry: ConversationEntry | undefined
  if (receipt.seq !== undefined && receipt.seq > 0) {
    try {
      const { entries } = await client.conversation(fp, { since: receipt.seq - 1, limit: 1 })
      entry = entries.find(e => e.seq === receipt.seq)
    } catch {
      // archive read-back is best effort
    }
  }
  entry ??= {
    seq: receipt.seq ?? 0,
    dir: 'out',
    id: receipt.id,
    body,
    ts: Date.now(),
    status: receipt.status,
    ...(options?.auto === true ? { auto: true as const } : {}),
  }
  return { entry, receipt: { id: receipt.id, status: receipt.status, ...(receipt.seq === undefined ? {} : { seq: receipt.seq }) } }
}
