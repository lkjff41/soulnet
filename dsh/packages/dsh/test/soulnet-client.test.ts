import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createSoulnetNetworkClient, friendFromWire, locateSoulnetBinary, pendingFromWire, platformPackageName, resolveSoulnetBinary } from '../src/network/soulnet.ts'
import { NetworkErrorCode, type NetworkClient, type NetworkEvent } from '../src/network/types.ts'

const fakePeer = fileURLToPath(new URL('./fixtures/fake-peer.mjs', import.meta.url))

function spawnFake(env: Record<string, string> = {}) {
  return ({ args }: { binary: string; args: readonly string[] }) =>
    spawn(process.execPath, [fakePeer, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } })
}

const clients: NetworkClient[] = []
afterEach(async () => {
  await Promise.all(clients.splice(0).map(c => c.dispose()))
})

function waitForEvent(client: NetworkClient, kind: NetworkEvent['kind'], timeoutMs = 5_000): Promise<NetworkEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error(`no ${kind} event within ${timeoutMs} ms`)) }, timeoutMs)
    const off = client.subscribe((event) => {
      if (event.kind !== kind) return
      clearTimeout(timer)
      off()
      resolve(event)
    })
  })
}

describe('soulnet NetworkClient — P3 wire additions (auto flag, friends.set protocol, friends.card)', () => {
  it('passes `auto` on message.send, maps the friend protocol override, answers a friend card', async () => {
    const home = mkdtempSync(join(tmpdir(), 'soulnet-dsh-'))
    const client = createSoulnetNetworkClient({ home, relay: 'http://relay.test', peerBinary: 'ignored', spawn: spawnFake({ FAKE_PEER_IDENTITY: '1' }) })
    clients.push(client)
    await client.friends.list()
    // auto → the fake echoes the flag back on the inbound it emits (and marks the body)
    const echo = waitForEvent(client, 'message')
    const receipt = await client.send('fp-friend-0002' as never, 'automatic reply', { auto: true })
    expect(receipt.status).toBe('sent')
    const m = await echo
    expect(m.kind === 'message' && m.message.body).toBe('echo(auto): automatic reply')
    expect(m.kind === 'message' && m.message.auto).toBe(true)
    // friends.set with a protocol override → Friend.protocol
    const friend = await client.friends.set('fp-friend-0002' as never, { protocol: 'always answer in English' })
    expect(friend.protocol).toBe('always answer in English')
    const cleared = await client.friends.set('fp-friend-0002' as never, { protocol: '' })
    expect(cleared.protocol).toBeUndefined()
    expect(friendFromWire({ fingerprint: 'fp-x', protocol: 'p' }).protocol).toBe('p')
    // friends.card → the friend's card URI; non-friend → -32002
    const card = await client.friends.card('fp-friend-0002' as never)
    expect(card).toMatchObject({ fp: 'fp-friend-0002', name: 'Pal' })
    expect(card.uri).toContain('soulmirror://card')
    await expect(client.friends.card('fp-nobody' as never)).rejects.toMatchObject({ code: NetworkErrorCode.notFriend })
  })
})

describe('soulnet NetworkClient (against the fake peer script)', () => {
  it('initializes, maps identity/card/friends/pending and forwards notifications', async () => {
    const home = mkdtempSync(join(tmpdir(), 'soulnet-dsh-'))
    const client = createSoulnetNetworkClient({ home, relay: 'http://relay.test', peerBinary: 'ignored', spawn: spawnFake({ FAKE_PEER_IDENTITY: '1' }) })
    clients.push(client)
    const identity = await client.identity()
    expect(identity?.fp).toBe('fp-fake-0001')
    expect(identity?.cardUri).toContain('soulmirror://card')
    expect(client.status().state).toBe('ready')
    expect(client.status().protocol).toBe('soulnet/1')

    const friends = await client.friends.list()
    expect(friends).toHaveLength(1)
    expect(friends[0]).toMatchObject({ fp: 'fp-friend-0002', name: 'pal', remark: 'pal', cardName: 'Pal', unread: 1, count: 2, lastBody: 'yo' })
    const pending = await client.friends.pending().catch(() => [])
    // friends.pending is not implemented by the fake peer (method not found) → empty; friends.list carries it instead.
    expect(Array.isArray(pending)).toBe(true)

    const typing = waitForEvent(client, 'typing')
    const message = waitForEvent(client, 'message')
    const receipt = await client.send('fp-friend-0002' as never, 'hello')
    expect(receipt).toMatchObject({ id: 'm-1', seq: 2, status: 'sent' })
    expect(await typing).toMatchObject({ kind: 'typing', fp: 'fp-friend-0002', on: true })
    const m = await message
    expect(m.kind === 'message' && m.message.body).toBe('echo: hello')
    expect(m.kind === 'message' && m.message.name).toBe('pal') // name learned from friends.list
    expect(m.kind === 'message' && m.message.seq).toBe(3)
  })

  it('creates the identity through initialize when a display name is configured', async () => {
    const home = mkdtempSync(join(tmpdir(), 'soulnet-dsh-'))
    const client = createSoulnetNetworkClient({ home, displayName: 'Zed', peerBinary: 'ignored', spawn: spawnFake() })
    clients.push(client)
    const identity = await client.identity()
    expect(identity?.name).toBe('Zed')
  })

  it('maps soulnet error codes (not a friend → -32002) and identity.create conflicts', async () => {
    const home = mkdtempSync(join(tmpdir(), 'soulnet-dsh-'))
    const client = createSoulnetNetworkClient({ home, peerBinary: 'ignored', spawn: spawnFake({ FAKE_PEER_IDENTITY: '1' }) })
    clients.push(client)
    await expect(client.send('fp-stranger' as never, 'x')).rejects.toMatchObject({ code: NetworkErrorCode.notFriend })
    await expect(client.createIdentity('again')).rejects.toMatchObject({ code: NetworkErrorCode.identityExists })
  })

  it('restarts the peer with backoff when it dies and serves calls again', async () => {
    const home = mkdtempSync(join(tmpdir(), 'soulnet-dsh-'))
    const statuses: string[] = []
    // The fake dies on the 4th request (initialize + identity.get + card.get succeed, the next one kills it).
    const client = createSoulnetNetworkClient({
      home,
      peerBinary: 'ignored',
      spawn: spawnFake({ FAKE_PEER_IDENTITY: '1', FAKE_PEER_DIE_AFTER: '3' }),
      backoff: { initialMs: 50, maxMs: 200 },
      requestTimeoutMs: 5_000,
    })
    clients.push(client)
    client.subscribe((e) => { if (e.kind === 'status') statuses.push(e.status.state) })
    expect((await client.identity())?.fp).toBe('fp-fake-0001')
    // This call kills the first process; the endpoint closes → NetworkError(peerUnavailable).
    await expect(client.friends.list()).rejects.toMatchObject({ code: NetworkErrorCode.peerUnavailable })
    // The next call waits for the restarted process and succeeds.
    const friends = await client.friends.list()
    expect(friends).toHaveLength(1)
    expect(client.status().restarts).toBeGreaterThanOrEqual(1)
    expect(statuses).toContain('restarting')
    expect(client.status().state).toBe('ready')
  })

  it('dispose() shuts the peer down cleanly and refuses further calls', async () => {
    const home = mkdtempSync(join(tmpdir(), 'soulnet-dsh-'))
    const client = createSoulnetNetworkClient({ home, peerBinary: 'ignored', spawn: spawnFake({ FAKE_PEER_IDENTITY: '1' }) })
    await client.identity()
    await client.dispose()
    expect(client.status().state).toBe('stopped')
    await expect(client.identity()).rejects.toMatchObject({ code: NetworkErrorCode.peerUnavailable })
  })

  it('surfaces peerUnavailable when a configured binary cannot be spawned', async () => {
    const home = mkdtempSync(join(tmpdir(), 'soulnet-dsh-'))
    const bogus = join(home, 'no-such-soulnet-binary')
    const client = createSoulnetNetworkClient({ home, peerBinary: bogus, requestTimeoutMs: 400, backoff: { initialMs: 50, maxMs: 100 } })
    clients.push(client)
    // spawn(bogus) emits 'error' (ENOENT) → restart loop; the call waits then reports peerUnavailable.
    await expect(client.identity()).rejects.toMatchObject({ code: NetworkErrorCode.peerUnavailable })
    expect(client.status().restarts).toBeGreaterThanOrEqual(1)
  })
})

describe('resolveSoulnetBinary', () => {
  // No platform package in these cases: the workspace may link one next to src/.
  const noPackage = { resolvePackageDir: () => undefined }
  it('returns undefined when PATH is empty and no bin/ candidate exists (POSIX)', () => {
    // Force the filesystem-less branches: an empty PATH and a platform whose
    // name list is looked up on PATH only (the bin/ fallback needs a real file).
    expect(resolveSoulnetBinary(undefined, { PATH: '' }, 'linux', noPackage)).toBeUndefined()
  })
  it('returns an explicit path candidate verbatim', () => {
    expect(resolveSoulnetBinary('/opt/soulnet/bin/soulnet', { PATH: '' }, 'linux', noPackage)).toBe('/opt/soulnet/bin/soulnet')
    expect(locateSoulnetBinary('/opt/soulnet/bin/soulnet', { PATH: '' }, 'linux', noPackage)?.source).toBe('setting')
  })
  it('returns a bare explicit name when it is not found on PATH', () => {
    expect(resolveSoulnetBinary('soulnet', { PATH: '' }, 'linux', noPackage)).toBe('soulnet')
  })
  it('names the platform package only for the five published targets', () => {
    expect(platformPackageName('win32', 'x64')).toBe('soulnet-peer-windows-x64')
    expect(platformPackageName('darwin', 'arm64')).toBe('soulnet-peer-darwin-arm64')
    expect(platformPackageName('linux', 'arm64')).toBe('soulnet-peer-linux-arm64')
    expect(platformPackageName('freebsd', 'x64')).toBeUndefined()
    expect(platformPackageName('win32', 'ia32')).toBeUndefined()
  })
  it('prefers the platform package over PATH and reports the source', () => {
    const pkgDir = mkdtempSync(join(tmpdir(), 'soulnet-pkg-'))
    mkdirSync(join(pkgDir, 'bin'))
    writeFileSync(join(pkgDir, 'bin', 'soulnet'), '#!/bin/sh\n')
    if (process.platform !== 'win32') chmodSync(join(pkgDir, 'bin', 'soulnet'), 0o644)
    const pathDir = mkdtempSync(join(tmpdir(), 'soulnet-path-'))
    writeFileSync(join(pathDir, 'soulnet'), '#!/bin/sh\n')
    const seen: string[] = []
    const found = locateSoulnetBinary(undefined, { PATH: pathDir }, 'linux', {
      arch: 'x64',
      resolvePackageDir: (name) => { seen.push(name); return pkgDir },
    })
    expect(seen).toEqual(['soulnet-peer-linux-x64'])
    expect(found).toEqual({ path: join(pkgDir, 'bin', 'soulnet'), source: 'platform-package' })
    // the tarball may have been packed on Windows without the mode bit: it is repaired on the way out
    if (process.platform !== 'win32') expect(statSync(join(pkgDir, 'bin', 'soulnet')).mode & 0o111).not.toBe(0)
  })
  it('falls back to PATH when the platform package is installed but has no binary, and picks soulnet.exe on win32', () => {
    const pkgDir = mkdtempSync(join(tmpdir(), 'soulnet-pkg-empty-'))
    const pathDir = mkdtempSync(join(tmpdir(), 'soulnet-path-'))
    writeFileSync(join(pathDir, 'soulnet.exe'), '')
    const found = locateSoulnetBinary(undefined, { PATH: pathDir }, 'win32', { arch: 'x64', resolvePackageDir: () => pkgDir })
    expect(found).toEqual({ path: join(pathDir, 'soulnet.exe'), source: 'path' })
  })
  it('does not ask for a platform package on an unsupported platform', () => {
    const asked: string[] = []
    expect(locateSoulnetBinary(undefined, { PATH: '' }, 'linux', { arch: 'mips', resolvePackageDir: (name) => { asked.push(name); return undefined } })).toBeUndefined()
    expect(asked).toEqual([])
  })
})

describe('wire mapping helpers', () => {
  it('friendFromWire prefers the note, then the card name, then a short fingerprint', () => {
    expect(friendFromWire({ fingerprint: 'abcdefghijklmnopqrstuvwxyz', note: 'n', card: { name: 'C' } }).name).toBe('n')
    expect(friendFromWire({ fingerprint: 'abcdefghijklmnopqrstuvwxyz', card: { name: 'C' } }).name).toBe('C')
    expect(friendFromWire({ fingerprint: 'abcdefghijklmnopqrstuvwxyz' }).name).toBe('abcdefghijkl…')
  })
  it('pendingFromWire carries id, peer, greeting and card name', () => {
    expect(pendingFromWire({ id: 'r1', peer: 'fp-x', incoming: { body: 'hey', card: { name: 'Xan' } } })).toMatchObject({ id: 'r1', fp: 'fp-x', name: 'Xan', greeting: 'hey' })
  })
})
