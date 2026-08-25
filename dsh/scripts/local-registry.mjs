#!/usr/bin/env node
/**
 * A throw-away npm registry for the fresh-user install test: serves the
 * tarballs in dsh/dist/ (made by `pnpm run pack:all`) as if they were
 * published, and proxies every other request to the real registry so pnpm can
 * still resolve peers and the rest of the world. Nothing is written anywhere.
 *
 *   node dsh/scripts/local-registry.mjs [--dir dsh/dist] [--port 4873] [--upstream https://registry.npmjs.org]
 *
 * Then, in another shell:
 *   set npm_config_registry=http://127.0.0.1:4873          (PowerShell: $env:npm_config_registry = '...')
 *   npx -y @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add soulnet-dsh
 *
 * pnpm then installs the plugin AND the matching soulnet-peer-<os>-<arch>
 * optional dependency from these tarballs -- the same resolution a real
 * `npm publish` would give, minus the network.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : (args[i + 1] ?? fallback)
}
const dir = resolve(process.cwd(), flag('--dir', join(here, '..', 'dist')))
const port = Number(flag('--port', '4873'))
const upstream = flag('--upstream', 'https://registry.npmjs.org').replace(/\/$/, '')

/** Read `package/package.json` out of an npm tarball (ustar, no external deps). */
function manifestOf(tgz) {
  const tar = gunzipSync(tgz)
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(b => b === 0)) break
    let name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
    if (prefix !== '') name = `${prefix}/${name}`
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim(), 8) || 0
    const type = String.fromCharCode(header[156])
    const body = tar.subarray(offset + 512, offset + 512 + size)
    if ((type === '0' || type === '\0') && name === 'package/package.json') return JSON.parse(body.toString('utf8'))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  throw new Error('package/package.json not found in tarball')
}

// name -> { versions: { version -> { manifest, file, integrity, shasum } } }
const packages = new Map()
for (const file of readdirSync(dir).filter(n => n.endsWith('.tgz')).sort()) {
  const buf = readFileSync(join(dir, file))
  const manifest = manifestOf(buf)
  const entry = packages.get(manifest.name) ?? { versions: new Map() }
  entry.versions.set(manifest.version, {
    manifest,
    file: join(dir, file),
    integrity: `sha512-${createHash('sha512').update(buf).digest('base64')}`,
    shasum: createHash('sha1').update(buf).digest('hex'),
  })
  packages.set(manifest.name, entry)
}
if (packages.size === 0) {
  console.error(`no .tgz in ${dir} -- run \`pnpm run pack:all\` first`)
  process.exit(1)
}

const tarballPath = (name, version) => `/${name}/-/${name.split('/').pop()}-${version}.tgz`

function packument(name, base) {
  const entry = packages.get(name)
  const versions = {}
  let latest = ''
  for (const [version, v] of entry.versions) {
    versions[version] = { ...v.manifest, dist: { tarball: `${base}${tarballPath(name, version)}`, integrity: v.integrity, shasum: v.shasum } }
    latest = version
  }
  const now = new Date().toISOString()
  const time = { created: now, modified: now }
  for (const version of Object.keys(versions)) time[version] = now
  return { name, 'dist-tags': { latest }, versions, time, modified: now }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
  const path = decodeURIComponent(url.pathname)
  const base = `http://127.0.0.1:${port}`
  // packument: /@scope/name or /name
  const pkgName = path.replace(/^\//, '')
  if (packages.has(pkgName)) {
    console.log(`local   ${req.method} ${path}`)
    const body = JSON.stringify(packument(pkgName, base))
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    res.end(body)
    return
  }
  // tarball: /@scope/name/-/name-version.tgz
  for (const [name, entry] of packages) {
    for (const [version, v] of entry.versions) {
      if (path === tarballPath(name, version)) {
        console.log(`local   ${req.method} ${path}`)
        const buf = readFileSync(v.file)
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': buf.length })
        res.end(buf)
        return
      }
    }
  }
  // everything else: proxy upstream (GET/HEAD only; this is a read-only mirror)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end('read-only registry')
    return
  }
  try {
    const headers = {}
    for (const h of ['accept', 'accept-encoding', 'user-agent', 'npm-command', 'pnpm-command']) {
      const value = req.headers[h]
      if (typeof value === 'string') headers[h] = value
    }
    const up = await fetch(`${upstream}${req.url}`, { method: req.method, headers, redirect: 'follow' })
    console.log(`proxy   ${req.method} ${path} -> ${up.status}`)
    const outHeaders = {}
    for (const h of ['content-type', 'etag', 'last-modified', 'cache-control']) {
      const value = up.headers.get(h)
      if (value !== null) outHeaders[h] = value
    }
    res.writeHead(up.status, outHeaders)
    if (req.method === 'HEAD' || up.body === null) {
      res.end()
      return
    }
    const reader = up.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
    res.end()
  } catch (error) {
    console.log(`proxy   ${req.method} ${path} -> error ${String(error)}`)
    res.writeHead(502)
    res.end(String(error))
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`local registry on http://127.0.0.1:${port} (upstream ${upstream})`)
  for (const [name, entry] of packages) console.log(`  ${name}@${[...entry.versions.keys()].join(', ')}`)
})
