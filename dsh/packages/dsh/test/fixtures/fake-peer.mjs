// A stand-in for the `soulnet` binary used by test/soulnet-client.test.ts:
// speaks the same line-delimited JSON-RPC 2.0 on stdio, implements a handful
// of methods, and can be told (via env) to die after N requests so the
// restart-with-backoff path can be exercised without a real peer.
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const home = args[args.indexOf('--home') + 1]
const relay = args[args.indexOf('--relay') + 1]
const dieAfter = Number(process.env.FAKE_PEER_DIE_AFTER ?? '0')
let handled = 0
let identity = process.env.FAKE_PEER_IDENTITY === '1' ? { name: 'fake', fingerprint: 'fp-fake-0001', proxies: [relay] } : null

const write = (frame) => { process.stdout.write(`${JSON.stringify(frame)}\n`) }
process.stderr.write(`[fake-peer] started home=${home} relay=${relay} pid=${process.pid}\n`)

const methods = {
  initialize: (p) => {
    if (p?.name && identity === null) identity = { name: p.name, fingerprint: 'fp-fake-0001', proxies: [relay] }
    return { protocol: 'soulnet/1', version: 'fake', home, relay, identity, running: identity !== null, methods: Object.keys(methods), notifications: ['message.received', 'typing'] }
  },
  'identity.get': () => ({ identity }),
  'identity.create': (p) => {
    if (identity !== null) throw { code: -32003, message: 'identity already exists' }
    identity = { name: p.name, fingerprint: 'fp-fake-0001', proxies: [relay] }
    return { identity, running: true }
  },
  'card.get': () => ({ uri: 'soulmirror://card?v=1&pk=FAKE&name=fake', fingerprint: 'fp-fake-0001', card: { name: identity?.name ?? '' } }),
  'friends.list': () => ({
    friends: [{ fingerprint: 'fp-friend-0002', note: 'pal', card: { name: 'Pal' }, count: 2, unread: 1, last: { ts: '2026-08-22T01:02:03Z', body: 'yo' }, typing: false }],
    pending: [{ id: 'req-1', peer: 'fp-req-0003', incoming: { body: 'hello there', card: { name: 'Req' } } }],
  }),
  'message.send': (p) => {
    if (p.to !== 'fp-friend-0002') throw { code: -32002, message: 'not a friend (friends.add first)' }
    // Emit a typing notification and an echo "message.received" afterwards.
    setTimeout(() => { write({ jsonrpc: '2.0', method: 'typing', params: { kind: 'typing', peer: p.to, on: true, ts: new Date().toISOString() } }) }, 5)
    // An `auto` send is echoed back flagged auto (so the client test can see the flag travelled).
    setTimeout(() => { write({ jsonrpc: '2.0', method: 'message.received', params: { kind: 'message.received', peer: p.to, seq: 3, message: { id: 'm-echo', from: p.to, type: 'text', body: `echo${p.auto === true ? '(auto)' : ''}: ${p.body}`, ts: new Date().toISOString(), ...(p.auto === true ? { auto: true } : {}) } } }) }, 10)
    return { id: 'm-1', seq: 2, status: 'sent' }
  },
  'friends.set': (p) => {
    if (p.fp !== 'fp-friend-0002') throw { code: -32002, message: 'not a friend' }
    return { friend: { fingerprint: p.fp, note: p.note ?? 'pal', protocol: p.protocol ?? '', card: { name: 'Pal' }, count: 2, unread: 1 } }
  },
  'friends.card': (p) => {
    if (p.fp !== 'fp-friend-0002') throw { code: -32002, message: 'not a friend' }
    return { uri: 'soulmirror://card?v=1&pk=PAL&name=Pal', fingerprint: p.fp, card: { name: 'Pal' } }
  },
  shutdown: () => ({ ok: true }),
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (line.trim() === '') return
  let req
  try {
    req = JSON.parse(line)
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
    return
  }
  handled += 1
  if (dieAfter > 0 && handled > dieAfter) {
    process.stderr.write('[fake-peer] dying on purpose\n')
    process.exit(3)
  }
  const fn = methods[req.method]
  if (fn === undefined) {
    write({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `method not found: ${req.method}` } })
    return
  }
  try {
    const result = fn(req.params ?? {})
    if (req.id !== undefined && req.id !== null) write({ jsonrpc: '2.0', id: req.id, result })
    if (req.method === 'shutdown') setTimeout(() => process.exit(0), 5)
  } catch (error) {
    write({ jsonrpc: '2.0', id: req.id, error: { code: error.code ?? -32603, message: error.message ?? String(error) } })
  }
})
rl.on('close', () => { process.exit(0) })
