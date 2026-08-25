import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { JsonRpcEndpoint, JsonRpcError, JSONRPC_CLOSED, JSONRPC_TIMEOUT } from '../src/network/jsonrpc.ts'

/** A fake peer: reads request lines from `toPeer`, answers on `fromPeer`. */
function fakePeer() {
  const toPeer = new PassThrough()
  const fromPeer = new PassThrough()
  const received: { id: number; method: string; params: unknown }[] = []
  let buffer = ''
  toPeer.setEncoding('utf8')
  toPeer.on('data', (chunk: string) => {
    buffer += chunk
    let nl = buffer.indexOf('\n')
    while (nl !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (line.trim() !== '') received.push(JSON.parse(line) as { id: number; method: string; params: unknown })
      nl = buffer.indexOf('\n')
    }
  })
  const reply = (frame: object): void => { fromPeer.write(`${JSON.stringify(frame)}\n`) }
  const waitFor = async (method: string): Promise<{ id: number; method: string; params: unknown }> => {
    for (let i = 0; i < 200; i++) {
      const hit = received.find(r => r.method === method)
      if (hit !== undefined) return hit
      await new Promise(r => setTimeout(r, 5))
    }
    throw new Error(`peer never received ${method}`)
  }
  return { toPeer, fromPeer, received, reply, waitFor }
}

describe('JsonRpcEndpoint', () => {
  it('correlates responses by id, in any order', async () => {
    const peer = fakePeer()
    const ep = new JsonRpcEndpoint(peer.fromPeer, peer.toPeer)
    const a = ep.request('card.get')
    const b = ep.request('friends.list', { x: 1 })
    const reqA = await peer.waitFor('card.get')
    const reqB = await peer.waitFor('friends.list')
    expect(reqB.params).toEqual({ x: 1 })
    peer.reply({ jsonrpc: '2.0', id: reqB.id, result: { friends: [] } })
    peer.reply({ jsonrpc: '2.0', id: reqA.id, result: { uri: 'soulmirror://card?x' } })
    await expect(b).resolves.toEqual({ friends: [] })
    await expect(a).resolves.toEqual({ uri: 'soulmirror://card?x' })
    ep.close()
  })

  it('surfaces JSON-RPC errors with their code', async () => {
    const peer = fakePeer()
    const ep = new JsonRpcEndpoint(peer.fromPeer, peer.toPeer)
    const p = ep.request('message.send', { to: 'nobody', body: 'hi' })
    const req = await peer.waitFor('message.send')
    peer.reply({ jsonrpc: '2.0', id: req.id, error: { code: -32002, message: 'not a friend (friends.add first)' } })
    const error = await p.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(JsonRpcError)
    expect((error as JsonRpcError).code).toBe(-32002)
    expect((error as JsonRpcError).message).toContain('not a friend')
    ep.close()
  })

  it('delivers notifications (frames without id) to the listener', async () => {
    const peer = fakePeer()
    const seen: { method: string; params: unknown }[] = []
    const ep = new JsonRpcEndpoint(peer.fromPeer, peer.toPeer, { onNotification: n => { seen.push(n) } })
    peer.reply({ jsonrpc: '2.0', method: 'typing', params: { peer: 'fp-a', on: true } })
    peer.reply({ jsonrpc: '2.0', method: 'message.received', params: { peer: 'fp-a', seq: 3, message: { id: 'm1', body: 'hello' } } })
    await new Promise(r => setTimeout(r, 20))
    expect(seen.map(s => s.method)).toEqual(['typing', 'message.received'])
    expect((seen[1]!.params as { seq: number }).seq).toBe(3)
    ep.close()
  })

  it('rejects pending requests when the read side closes', async () => {
    const peer = fakePeer()
    const closed: (Error | undefined)[] = []
    const ep = new JsonRpcEndpoint(peer.fromPeer, peer.toPeer, { onClose: e => { closed.push(e) } })
    const p = ep.request('identity.get')
    await peer.waitFor('identity.get')
    peer.fromPeer.end()
    const error = await p.catch((e: unknown) => e)
    expect((error as JsonRpcError).code).toBe(JSONRPC_CLOSED)
    expect(ep.isClosed).toBe(true)
    expect(closed.length).toBe(1)
    await expect(ep.request('identity.get')).rejects.toMatchObject({ code: JSONRPC_CLOSED })
  })

  it('times out a request that gets no answer', async () => {
    const peer = fakePeer()
    const ep = new JsonRpcEndpoint(peer.fromPeer, peer.toPeer, { timeoutMs: 30 })
    const error = await ep.request('presence').catch((e: unknown) => e)
    expect((error as JsonRpcError).code).toBe(JSONRPC_TIMEOUT)
    ep.close()
  })

  it('ignores garbage lines and unknown ids without dying', async () => {
    const peer = fakePeer()
    const protocolErrors: string[] = []
    const ep = new JsonRpcEndpoint(peer.fromPeer, peer.toPeer, { onProtocolError: (e) => { protocolErrors.push(e.message) } })
    peer.fromPeer.write('this is not json\n')
    peer.reply({ jsonrpc: '2.0', id: 999, result: {} })
    const p = ep.request('card.get')
    const req = await peer.waitFor('card.get')
    peer.reply({ jsonrpc: '2.0', id: req.id, result: { uri: 'ok' } })
    await expect(p).resolves.toEqual({ uri: 'ok' })
    expect(protocolErrors.length).toBe(2)
    ep.close()
  })
})
