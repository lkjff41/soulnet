/**
 * The NetworkStore's SSE stream must not squat a browser connection slot from
 * a hidden tab: the browser pools six HTTP/1.1 connections per origin across
 * ALL tabs, and stale tabs each holding a stream starve a freshly opened page
 * (its every request queues until the 30 s abort). Hidden → the stream closes
 * after a grace; visible again → it reconnects and refreshes.
 *
 * Runs under the node environment: document / EventSource / fetch are stubbed
 * before the module (and its singleton store) is imported.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly url: string
  closed = false
  onerror: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(): void {}
  close(): void {
    this.closed = true
  }
}

class FakeDocument {
  hidden = false
  private readonly handlers: (() => void)[] = []
  addEventListener(type: string, handler: () => void): void {
    if (type === 'visibilitychange') this.handlers.push(handler)
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden
    for (const h of this.handlers) h()
  }
}

const okJson = (body: unknown): Promise<{ ok: boolean; status: number; text(): Promise<string> }> =>
  Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) })

const EMPTY_STATE = { friends: [], pending: [], groups: [], drafts: [] }

describe('NetworkStore visibility-gated SSE', () => {
  let doc: FakeDocument
  let store: { subscribe(listener: () => void): () => void }
  let unsubscribe: (() => void) | undefined

  const openSources = (): FakeEventSource[] => FakeEventSource.instances.filter(s => !s.closed)

  beforeEach(async () => {
    vi.useFakeTimers()
    FakeEventSource.instances = []
    doc = new FakeDocument()
    vi.stubGlobal('document', doc)
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.stubGlobal('fetch', vi.fn(() => okJson(EMPTY_STATE)))
    vi.resetModules()
    const mod = await import('../src/client/api.ts')
    store = mod.networkStore as unknown as typeof store
    unsubscribe = store.subscribe(() => {})
    expect(openSources()).toHaveLength(1)
  })

  afterEach(() => {
    unsubscribe?.()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('closes the stream after the tab stays hidden past the grace', () => {
    doc.setHidden(true)
    expect(openSources()).toHaveLength(1) // grace running, still connected
    vi.advanceTimersByTime(20_000)
    expect(openSources()).toHaveLength(0)
  })

  it('a quick flip away and back never drops the stream', () => {
    doc.setHidden(true)
    vi.advanceTimersByTime(5_000)
    doc.setHidden(false)
    vi.advanceTimersByTime(60_000)
    expect(openSources()).toHaveLength(1)
    expect(FakeEventSource.instances).toHaveLength(1) // the original, never replaced
  })

  it('reconnects and schedules a catch-up refresh when the tab is visible again', async () => {
    doc.setHidden(true)
    vi.advanceTimersByTime(20_000)
    expect(openSources()).toHaveLength(0)
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockClear()
    doc.setHidden(false)
    expect(openSources()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(300) // debounced refresh (250 ms)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('stays disconnected when nobody subscribes any more', () => {
    doc.setHidden(true)
    vi.advanceTimersByTime(20_000)
    unsubscribe?.()
    unsubscribe = undefined
    doc.setHidden(false)
    expect(openSources()).toHaveLength(0)
  })
})
