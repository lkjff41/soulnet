/**
 * Integration: the REAL `soulnet` binary against a LOCAL `soulnet-relay`.
 *
 * Needs the two binaries built from the soulnet repo root:
 *   go build -o bin/soulnet ./cmd/soulnet
 *   go build -o bin/soulnet-relay ./cmd/soulnet-relay
 * (On Windows the files may be named *.exe; both spellings are looked up.)
 * Override with SOULNET_BIN / SOULNET_RELAY_BIN. The test is SKIPPED when a
 * binary is missing so the unit suite stays green on machines without Go;
 * set SOULNET_INTEGRATION=1 to make a missing binary a failure instead.
 *
 * Two identities (two homes) on one relay: A adds B (friend request) → B
 * sees `friend_request` → B accepts → A sees `friend_accept` → A sends a text
 * → B's NetworkClient emits `message` → B reads it back with conversation().
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSoulnetNetworkClient } from '../src/network/soulnet.ts'
import type { NetworkClient, NetworkEvent } from '../src/network/types.ts'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..')

function findBinary(envName: string, base: string): string | undefined {
  const fromEnv = process.env[envName]
  if (fromEnv !== undefined && fromEnv !== '' && existsSync(fromEnv)) return fromEnv
  const names = process.platform === 'win32' ? [`${base}.exe`, base] : [base, `${base}.exe`]
  for (const name of names) {
    const candidate = join(repoRoot, 'bin', name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const soulnetBin = findBinary('SOULNET_BIN', 'soulnet')
const relayBin = findBinary('SOULNET_RELAY_BIN', 'soulnet-relay') ?? findBinary('SOULMIRROR_RELAY_BIN', 'soulmirror-relay')
const strict = process.env['SOULNET_INTEGRATION'] === '1'
const available = soulnetBin !== undefined && relayBin !== undefined
if (!available && strict) throw new Error(`integration binaries missing: soulnet=${soulnetBin ?? 'none'} relay=${relayBin ?? 'none'}`)

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      srv.close(() => { resolvePort(port) })
    })
    srv.on('error', reject)
  })
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`${url} did not come up within ${timeoutMs} ms`)
}

function waitForEvent(client: NetworkClient, predicate: (event: NetworkEvent) => boolean, label: string, timeoutMs = 30_000): Promise<NetworkEvent> {
  return new Promise((resolveEvent, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error(`no ${label} within ${timeoutMs} ms`)) }, timeoutMs)
    const off = client.subscribe((event) => {
      if (!predicate(event)) return
      clearTimeout(timer)
      off()
      resolveEvent(event)
    })
  })
}

describe.skipIf(!available)('soulnet + local relay end to end', () => {
  let relay: ChildProcess | undefined
  let relayUrl = ''
  let alice: NetworkClient
  let bob: NetworkClient
  const logs: string[] = []

  beforeAll(async () => {
    const port = await freePort()
    relayUrl = `http://127.0.0.1:${port}`
    const data = mkdtempSync(join(tmpdir(), 'soulnet-relay-'))
    relay = spawn(relayBin!, ['--addr', `127.0.0.1:${port}`, '--data', data], { stdio: ['ignore', 'pipe', 'pipe'] })
    relay.on('error', (error) => { logs.push(`[relay] spawn error: ${error.message}`) })
    relay.stderr?.setEncoding('utf8')
    relay.stderr?.on('data', (chunk: string) => { logs.push(`[relay] ${chunk.trimEnd()}`) })
    relay.stdout?.setEncoding('utf8')
    relay.stdout?.on('data', (chunk: string) => { logs.push(`[relay] ${chunk.trimEnd()}`) })
    await waitForHttp(`${relayUrl}/`, 20_000)
    const logger = (who: string) => (level: string, message: string): void => { logs.push(`[${who} ${level}] ${message}`) }
    alice = createSoulnetNetworkClient({ home: mkdtempSync(join(tmpdir(), 'soulnet-alice-')), relay: relayUrl, peerBinary: soulnetBin!, displayName: 'Alice', logger: logger('alice') })
    bob = createSoulnetNetworkClient({ home: mkdtempSync(join(tmpdir(), 'soulnet-bob-')), relay: relayUrl, peerBinary: soulnetBin!, displayName: 'Bob', logger: logger('bob') })
  })

  afterAll(async () => {
    await Promise.all([alice?.dispose(), bob?.dispose()])
    relay?.kill()
    if (process.env['SOULNET_INTEGRATION_VERBOSE'] === '1') console.log(logs.join('\n'))
  })

  it('creates two identities, exchanges a friend request/accept and one message', async () => {
    const [idA, idB] = await Promise.all([alice.identity(), bob.identity()])
    expect(idA?.name).toBe('Alice')
    expect(idB?.name).toBe('Bob')
    expect(idA?.cardUri.startsWith('soulmirror://card')).toBe(true)
    expect(alice.status()).toMatchObject({ state: 'ready', protocol: 'soulnet/1' })

    // A → B friend request.
    const bobSeesRequest = waitForEvent(bob, e => e.kind === 'friend_request', 'friend_request at Bob')
    const parsed = await alice.parseCard(idB!.cardUri)
    expect(parsed.fp).toBe(idB!.fp)
    const pendingFriend = await alice.friends.add(idB!.cardUri, 'Bob from the test')
    expect(pendingFriend.fp).toBe(idB!.fp)
    const request = await bobSeesRequest
    if (request.kind !== 'friend_request') throw new Error('unreachable')
    expect(request.request.fp).toBe(idA!.fp)
    expect(request.request.greeting).toBe('Bob from the test')
    expect((await bob.friends.pending()).some(p => p.id === request.request.id)).toBe(true)

    // B accepts → A sees friend_accept.
    const aliceSeesAccept = waitForEvent(alice, e => e.kind === 'friend_accept', 'friend_accept at Alice')
    const accepted = await bob.friends.accept(request.request.id, 'Alice')
    expect(accepted.fp).toBe(idA!.fp)
    const accept = await aliceSeesAccept
    if (accept.kind !== 'friend_accept') throw new Error('unreachable')
    expect(accept.friend.fp).toBe(idB!.fp)
    expect((await alice.friends.list()).map(f => f.fp)).toContain(idB!.fp)
    expect((await bob.friends.list()).map(f => f.fp)).toContain(idA!.fp)

    // A → B one text message; B's client emits `message`.
    const bobSeesMessage = waitForEvent(bob, e => e.kind === 'message', 'message.received at Bob')
    const receipt = await alice.send(idB!.fp, 'hello Bob, this is Alice')
    expect(receipt.status).toBe('sent')
    const message = await bobSeesMessage
    if (message.kind !== 'message') throw new Error('unreachable')
    expect(message.message.from).toBe(idA!.fp)
    expect(message.message.body).toBe('hello Bob, this is Alice')
    expect(message.message.name).toBe('Alice')

    // Archived on both sides; unread count and read cursor.
    const bobConv = await bob.conversation(idA!.fp)
    expect(bobConv.entries.some(e => e.dir === 'in' && e.body === 'hello Bob, this is Alice')).toBe(true)
    const aliceConv = await alice.conversation(idB!.fp)
    expect(aliceConv.entries.some(e => e.dir === 'out' && e.body === 'hello Bob, this is Alice')).toBe(true)
    const bobFriend = (await bob.friends.list()).find(f => f.fp === idA!.fp)
    expect(bobFriend?.unread).toBeGreaterThanOrEqual(1)
    await bob.markRead(idA!.fp, 0)
    expect((await bob.friends.list()).find(f => f.fp === idA!.fp)?.unread).toBe(0)

    // Presence through the relay (both long-polling).
    const presence = await alice.presence([idB!.fp])
    expect(typeof presence[idB!.fp]).toBe('boolean')

    // Non-friend send is refused with the documented code.
    await expect(alice.send('0000000000000000000000000000000000000000' as never, 'x')).rejects.toMatchObject({ code: -32002 })
  }, 90_000)
})
