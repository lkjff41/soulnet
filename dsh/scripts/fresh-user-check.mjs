#!/usr/bin/env node
/**
 * Step 3 of the fresh-user install test (README "Install" -> "Verify a release
 * locally"): against a RUNNING dsh web (the freshly installed plugin, pointed
 * at a LOCAL relay) prove, through the plugin's HTTP API only, that
 *
 *   1. the backend is `ready` and the binary came from the platform package;
 *   2. onboarding works (`identity.create`);
 *   3. a second peer (the repo's `soulnet` binary, temp home, same local relay)
 *      can befriend it and one message goes each way.
 *
 *   node dsh/scripts/fresh-user-check.mjs --dsh http://127.0.0.1:3095 --relay http://127.0.0.1:9395 \
 *        --soulnet ./bin/soulnet.exe [--name Fresh] [--log dsh/spike-evidence/release-fresh-user.txt]
 *
 * Never point this at the public relay. Exit code 0 = every check passed.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : (args[i + 1] ?? fallback)
}
const dsh = flag('--dsh', 'http://127.0.0.1:3095').replace(/\/$/, '')
const relay = flag('--relay', 'http://127.0.0.1:9395')
const soulnetBin = flag('--soulnet', process.platform === 'win32' ? 'bin/soulnet.exe' : 'bin/soulnet')
const ownerName = flag('--name', 'Fresh')
const logFile = flag('--log', '')
if (/relay\.startupworld\.cn/.test(relay)) {
  console.error('refusing to run against the public relay')
  process.exit(2)
}

const t0 = Date.now()
const lines = []
function log(message) {
  const line = `${new Date().toISOString().slice(11, 23)} ${message}`
  lines.push(line)
  console.log(line)
  if (logFile !== '') appendFileSync(logFile, `${line}\n`)
}
if (logFile !== '') writeFileSync(logFile, `# fresh-user check -- dsh ${dsh}, relay ${relay}, second peer ${soulnetBin}\n`)
let failures = 0
function check(ok, what) {
  log(`${ok ? 'PASS' : 'FAIL'} ${what}`)
  if (!ok) failures += 1
}

async function api(route, body) {
  const res = await fetch(`${dsh}/soulmirror/api/${route}`, body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!res.ok) throw new Error(`${route}: ${res.status} ${JSON.stringify(json)}`)
  return json
}
async function until(what, fn, timeoutMs = 20_000, everyMs = 400) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await fn()
    if (value !== undefined && value !== false && value !== null) return value
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`)
    await new Promise(r => setTimeout(r, everyMs))
  }
}

/** Minimal line-delimited JSON-RPC client for a second soulnet peer. */
function startPeer(name, home) {
  const proc = spawn(soulnetBin, ['--home', home, '--relay', relay], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const pending = new Map()
  const notifications = []
  let nextId = 1
  createInterface({ input: proc.stdout }).on('line', (line) => {
    let msg
    try { msg = JSON.parse(line) } catch { return }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.code} ${msg.error.message}`))
      else resolve(msg.result)
    } else if (msg.method !== undefined) {
      notifications.push(msg)
      log(`[${name}] <- ${msg.method} ${JSON.stringify(msg.params).slice(0, 200)}`)
    }
  })
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk) => { for (const l of chunk.split(/\r?\n/)) if (l.trim()) log(`[${name} stderr] ${l.trim()}`) })
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`${method} timed out`)) } }, 30_000).unref()
  })
  const waitFor = (method, predicate = () => true, timeoutMs = 20_000) => until(`${name} notification ${method}`, () => notifications.find(n => n.method === method && predicate(n.params)), timeoutMs)
  return { proc, call, waitFor, notifications }
}

try {
  // 1. backend ready, binary from the platform package
  const state0 = await until('backend ready', async () => {
    const s = await api('state')
    return s.status?.state === 'ready' ? s : undefined
  }, 30_000)
  log(`state: ${JSON.stringify(state0.status)}`)
  check(state0.backend === 'soulnet', 'backend is soulnet')
  check(state0.status.state === 'ready', 'backend state ready')
  check(state0.status.binarySource === 'platform-package', `binary resolved from the platform package: ${state0.status.binary}`)
  check(/soulnet-peer-(windows|darwin|linux)-(x64|arm64)[\\/]bin[\\/]soulnet(\.exe)?$/.test(state0.status.binary ?? ''), 'binary path is <platform package>/bin/soulnet[.exe]')
  check(state0.status.relay === relay, `relay is the local one (${state0.status.relay})`)
  check(state0.status.version !== undefined, `peer version reported: ${state0.status.version}`)

  // 2. onboarding
  let identity = state0.identity
  if (identity === null) {
    const created = await api('identity.create', { name: ownerName })
    identity = created.identity
    log(`identity.create -> ${JSON.stringify(identity)}`)
  } else {
    log(`identity already exists: ${identity.fp}`)
  }
  check(typeof identity?.fp === 'string' && identity.fp.length > 10, `identity fingerprint ${identity?.fp}`)
  check(typeof identity?.cardUri === 'string' && identity.cardUri.startsWith('soulmirror://card?'), 'card URI issued')

  // 3. second peer befriends us, one message each way
  const bobHome = mkdtempSync(join(tmpdir(), 'dsh-fresh-bob-'))
  const bob = startPeer('Bob', bobHome)
  const init = await bob.call('initialize', { name: 'Bob' })
  log(`Bob initialize -> protocol ${init.protocol} version ${init.version} fp ${init.identity?.fingerprint}`)
  const bobCard = await bob.call('card.get', {})
  const bobFp = init.identity.fingerprint

  // Bob -> us: friend request arrives as a pending request on the dsh side
  await bob.call('friends.add', { card_uri: identity.cardUri, note: 'hello from Bob' })
  const pending = await until('pending request on dsh', async () => {
    const s = await api('state')
    return s.pending.find(p => p.fp === bobFp)
  })
  log(`dsh pending: ${JSON.stringify(pending)}`)
  check(pending.greeting === 'hello from Bob', 'friend request from the second peer reached dsh with its greeting')
  const accepted = await api('friends.accept', { id: pending.id, note: 'Bob' })
  log(`friends.accept -> ${JSON.stringify(accepted.friend)}`)
  await bob.waitFor('friend.accepted', p => p.peer === identity.fp)
  check(true, 'second peer saw friend.accepted')

  // Bob -> us
  const fromBob = `ping from Bob ${Date.now()}`
  const sent1 = await bob.call('message.send', { to: identity.fp, body: fromBob })
  log(`Bob message.send -> ${JSON.stringify(sent1)}`)
  const inbound = await until('message from Bob in the dsh archive', async () => {
    const c = await api(`conversation.get?fp=${encodeURIComponent(bobFp)}`)
    return c.entries.find(e => e.dir === 'in' && e.body === fromBob)
  })
  check(inbound !== undefined, `dsh received "${fromBob}" (seq ${inbound.seq})`)

  // us -> Bob (direct send through the plugin API; bypasses the alter on purpose)
  const toBob = `pong from ${ownerName} ${Date.now()}`
  const sent2 = await api('message.send', { fp: bobFp, body: toBob })
  log(`dsh message.send -> ${JSON.stringify(sent2.receipt)}`)
  const got = await bob.waitFor('message.received', p => p.message?.body === toBob)
  check(got !== undefined, `second peer received "${toBob}"`)

  const final = await api('state')
  const row = final.friends.find(f => f.fp === bobFp)
  log(`dsh friend row: ${JSON.stringify(row)}`)
  check(row !== undefined && row.count >= 2, 'dsh friend row counts both messages')

  await bob.call('shutdown', {}).catch(() => {})
  bob.proc.kill()
  log(`Bob home ${bobHome} (card ${bobCard.uri?.slice(0, 40)}...)`)
} catch (error) {
  check(false, `error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
}

log(`${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
process.exit(failures === 0 ? 0 : 1)
