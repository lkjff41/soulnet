/**
 * Pending drafts of the alter (P4): what `soulmirror_send_message` stores
 * instead of sending when the send gate says "draft" (the friend's `draft`
 * tier, an auto reply over the hourly cap, a loop-guarded or unattributed
 * turn, the alter answering friend A by writing to friend B). The owner
 * reviews them on the SoulMirror page — in the friend's read-only thread and
 * in the "My alter" chat — and approves (send as the alter), edits, rejects,
 * or asks the alter to revise.
 *
 *   - `<home>/a2a/dsh-pending.json` — `{ drafts: [ { id, fp, name, body,
 *     createdAt, reason, trigger? } ] }`, write-through, oldest first.
 *
 * Pure store + file I/O; the decisions (send / append a note to the alter
 * session) live in the sessions plugin. Unit-tested in test/drafts.test.ts.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DraftReason } from './policy.ts'

export const PENDING_FILE = 'dsh-pending.json'

export interface PendingDraft {
  readonly id: string
  /** Target of the draft: a friend fingerprint — or the gid for a GROUP draft (`gid` is then set too, so the store keys stay uniform). */
  readonly fp: string
  /** Set when the draft targets a group (wire spec §14.7); an approved group draft sends via `groups.send`. */
  readonly gid?: string
  /** Target's display name when the draft was stored (friend name, or the group name). */
  readonly name: string
  readonly body: string
  /** ISO timestamp. */
  readonly createdAt: string
  /** Why it became a draft (the friend or group send gate's reason). */
  readonly reason: DraftReason
  /** What woke the turn that produced it (for the card's "in reply to …" line). */
  readonly trigger?: { readonly kind: string; readonly fp?: string; readonly name?: string; readonly messageId?: string; readonly gid?: string }
  /** The alter session that produced it. */
  readonly sessionId?: string
  /** Seat agent that drafted it (../agent-registry.ts); absent = the default alter. An approved group draft posts with this provenance. */
  readonly agent?: string
}

interface PendingFile {
  drafts: PendingDraft[]
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function normalize(value: unknown): PendingDraft | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  const id = str(v['id'])
  const fp = str(v['fp'])
  if (id === '' || fp === '') return undefined
  const trigger = typeof v['trigger'] === 'object' && v['trigger'] !== null ? v['trigger'] as PendingDraft['trigger'] : undefined
  return {
    id,
    fp,
    ...(str(v['gid']) === '' ? {} : { gid: str(v['gid']) }),
    name: str(v['name']) || fp,
    body: str(v['body']),
    createdAt: str(v['createdAt']) || new Date(0).toISOString(),
    reason: (str(v['reason']) || 'unknown-trigger') as DraftReason,
    ...(trigger === undefined ? {} : { trigger }),
    ...(str(v['sessionId']) === '' ? {} : { sessionId: str(v['sessionId']) }),
    ...(str(v['agent']) === '' ? {} : { agent: str(v['agent']) }),
  }
}

/** In-memory copy of dsh-pending.json with write-through. */
export class DraftStore {
  private data: PendingFile = { drafts: [] }
  private loaded = false
  private writing: Promise<void> = Promise.resolve()

  constructor(readonly path: string) {}

  static at(a2aDir: string): DraftStore {
    return new DraftStore(join(a2aDir, PENDING_FILE))
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as Partial<PendingFile>
      this.data = { drafts: (Array.isArray(raw.drafts) ? raw.drafts : []).map(normalize).filter((d): d is PendingDraft => d !== undefined) }
    } catch {
      this.data = { drafts: [] }
    }
    this.loaded = true
  }

  get isLoaded(): boolean {
    return this.loaded
  }

  /** Pending drafts, oldest first; `fp` narrows to one friend. */
  list(fp?: string): readonly PendingDraft[] {
    return fp === undefined ? [...this.data.drafts] : this.data.drafts.filter(d => d.fp === fp)
  }

  get(id: string): PendingDraft | undefined {
    return this.data.drafts.find(d => d.id === id)
  }

  count(fp?: string): number {
    return this.list(fp).length
  }

  /** Pending count per friend fingerprint. */
  counts(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const d of this.data.drafts) out[d.fp] = (out[d.fp] ?? 0) + 1
    return out
  }

  /** Store a new draft (id generated when absent); answers the stored record. */
  async add(draft: Omit<PendingDraft, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Promise<PendingDraft> {
    const record: PendingDraft = {
      ...draft,
      id: draft.id ?? `draft-${crypto.randomUUID()}`,
      createdAt: draft.createdAt ?? new Date().toISOString(),
    }
    this.data = { drafts: [...this.data.drafts, record] }
    await this.flush()
    return record
  }

  /** Remove one draft; answers it (undefined when unknown). */
  async remove(id: string): Promise<PendingDraft | undefined> {
    const found = this.get(id)
    if (found === undefined) return undefined
    this.data = { drafts: this.data.drafts.filter(d => d.id !== id) }
    await this.flush()
    return found
  }

  /** Drop every draft of a friend (e.g. the friend was removed). */
  async removeAll(fp: string): Promise<number> {
    const before = this.data.drafts.length
    this.data = { drafts: this.data.drafts.filter(d => d.fp !== fp) }
    if (this.data.drafts.length !== before) await this.flush()
    return before - this.data.drafts.length
  }

  private flush(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2)
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      await writeFile(this.path, snapshot, 'utf8')
    }).catch(() => {})
    return this.writing
  }
}
