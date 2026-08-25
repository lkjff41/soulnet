/**
 * Minimal line-delimited JSON-RPC 2.0 endpoint over a pair of Node streams.
 *
 * Used by the `soulnet` backend (stdin/stdout of the peer process) and by the
 * unit tests (PassThrough streams standing in for a peer). One JSON object per
 * line; requests carry an incrementing numeric id; frames without an id are
 * notifications and are handed to `onNotification`.
 */
import { createInterface, type Interface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

export interface JsonRpcErrorShape {
  readonly code: number
  readonly message: string
  readonly data?: unknown
}

/** A JSON-RPC error response, or a transport failure (code -32099 family). */
export class JsonRpcError extends Error {
  override readonly name = 'JsonRpcError'
  constructor(message: string, readonly code: number, readonly data?: unknown) {
    super(message)
  }
}

/** Transport-level code: the endpoint closed before the response arrived. */
export const JSONRPC_CLOSED = -32099
/** Transport-level code: no response within the request timeout. */
export const JSONRPC_TIMEOUT = -32098

export interface JsonRpcNotification {
  readonly method: string
  readonly params: unknown
}

export interface JsonRpcEndpointOptions {
  /** Default per-request timeout in ms (0 = none). */
  readonly timeoutMs?: number
  readonly onNotification?: (notification: JsonRpcNotification) => void
  /** Unparseable or malformed inbound lines (never thrown). */
  readonly onProtocolError?: (error: Error, line: string) => void
  /** The read side ended (EOF/error); every pending request is rejected first. */
  readonly onClose?: (error?: Error) => void
}

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout | undefined
  readonly method: string
}

export class JsonRpcEndpoint {
  private readonly pending = new Map<number, Pending>()
  private readonly reader: Interface
  private nextId = 1
  private closed = false

  constructor(private readonly input: Readable, private readonly output: Writable, private readonly options: JsonRpcEndpointOptions = {}) {
    this.reader = createInterface({ input, crlfDelay: Infinity })
    this.reader.on('line', line => { this.handleLine(line) })
    this.reader.on('close', () => { this.close() })
    input.on('error', (error: Error) => { this.close(error) })
    output.on('error', (error: Error) => { this.close(error) })
  }

  get isClosed(): boolean {
    return this.closed
  }

  /** Send a request and await its result; rejects with {@link JsonRpcError}. */
  request(method: string, params?: unknown, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<unknown> {
    if (this.closed) return Promise.reject(new JsonRpcError(`${method}: endpoint is closed`, JSONRPC_CLOSED))
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? this.options.timeoutMs ?? 0
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(id)
            reject(new JsonRpcError(`${method}: no response within ${timeoutMs} ms`, JSONRPC_TIMEOUT))
          }, timeoutMs)
        : undefined
      timer?.unref?.()
      const settle = (fn: () => void): void => {
        if (timer !== undefined) clearTimeout(timer)
        this.pending.delete(id)
        fn()
      }
      this.pending.set(id, {
        method,
        timer,
        resolve: value => { settle(() => { resolve(value) }) },
        reject: error => { settle(() => { reject(error) }) },
      })
      if (options.signal !== undefined) {
        const onAbort = (): void => {
          const entry = this.pending.get(id)
          entry?.reject(new JsonRpcError(`${method}: aborted`, JSONRPC_CLOSED))
        }
        if (options.signal.aborted) onAbort()
        else options.signal.addEventListener('abort', onAbort, { once: true })
      }
      if (!this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })) {
        this.pending.get(id)?.reject(new JsonRpcError(`${method}: endpoint is closed`, JSONRPC_CLOSED))
      }
    })
  }

  /** Fire-and-forget request without an id (no response expected). */
  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })
  }

  /** Reject every pending request and stop reading. Idempotent. */
  close(error?: Error): void {
    if (this.closed) return
    this.closed = true
    this.reader.close()
    const reason = new JsonRpcError(error === undefined ? 'endpoint closed' : `endpoint closed: ${error.message}`, JSONRPC_CLOSED)
    for (const entry of [...this.pending.values()]) entry.reject(reason)
    this.pending.clear()
    this.options.onClose?.(error)
  }

  private write(frame: object): boolean {
    if (this.closed) return false
    try {
      this.output.write(`${JSON.stringify(frame)}\n`)
      return true
    } catch (error: unknown) {
      this.close(error instanceof Error ? error : new Error(String(error)))
      return false
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (trimmed === '') return
    let frame: unknown
    try {
      frame = JSON.parse(trimmed)
    } catch (error: unknown) {
      this.options.onProtocolError?.(error instanceof Error ? error : new Error(String(error)), line)
      return
    }
    if (typeof frame !== 'object' || frame === null) {
      this.options.onProtocolError?.(new Error('frame is not an object'), line)
      return
    }
    const f = frame as { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: unknown }
    if (typeof f.method === 'string' && (f.id === undefined || f.id === null)) {
      this.options.onNotification?.({ method: f.method, params: f.params })
      return
    }
    if (typeof f.id !== 'number') {
      this.options.onProtocolError?.(new Error('response without a numeric id'), line)
      return
    }
    const entry = this.pending.get(f.id)
    if (entry === undefined) {
      this.options.onProtocolError?.(new Error(`response for unknown request id ${f.id}`), line)
      return
    }
    if (f.error !== undefined && f.error !== null) {
      const e = f.error as Partial<JsonRpcErrorShape>
      entry.reject(new JsonRpcError(
        typeof e.message === 'string' ? e.message : `${entry.method} failed`,
        typeof e.code === 'number' ? e.code : -32603,
        e.data,
      ))
      return
    }
    entry.resolve(f.result)
  }
}
