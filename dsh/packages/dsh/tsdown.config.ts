/**
 * Build config for soulnet-dsh — an OUT-OF-REPO replica of dsh's shared
 * `packages/client/tsdown.client.ts` preset (which is not published):
 *
 *  1. Node half: ESM, platform node. Everything that is not a Node builtin and
 *     not a real production dependency is inlined. This package keeps ZERO
 *     @deepseek-ai value imports on the host side (types only), so nothing from
 *     the harness is duplicated into the bundle.
 *  2. Browser half: ONE file `lib/client.js`, CJS wrapped as a lazy factory
 *     for the dsh module loader:
 *        window.__ModuleLoader__.load({ id: '<pkg>', factory: (require) => { ...; return module.exports; } })
 *     Externals (answered by the loader module table) are exactly the dsh
 *     baseline: react, react/jsx-runtime, react-dom, react-dom/client,
 *     @deepseek-ai/cordis, @deepseek-ai/dsh-client-ui-slots,
 *     @deepseek-ai/dsh-client-ui-primitives, plus the preloaded
 *     @deepseek-ai/dsh-client-runtime/client — plus whatever `dsh.client.external`
 *     in package.json requests. Every other specifier is inlined. Any other
 *     `@deepseek-ai/*` VALUE import is a build error (the bundle purity gate):
 *     cross-plugin collaboration goes through cordis services; type-only imports
 *     are erased and never reach the gate.
 */
import { readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import type { UserConfig } from 'tsdown'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  name: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dsh?: { client?: { external?: string[] } }
}
const id = pkg.name

const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]
const PRELOADED_CLIENT_EXTERNALS = ['@deepseek-ai/dsh-client-runtime/client']
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|file-reference|session|llm|tools|brand)(\/|$)/
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

const clientExternals = new Set([
  ...PLATFORM_MODULES,
  ...PRELOADED_CLIENT_EXTERNALS,
  ...(pkg.dsh?.client?.external ?? []),
])
const productionDeps = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
])
const isProductionDep = (spec: string): boolean =>
  [...productionDeps].some(name => spec === name || spec.startsWith(`${name}/`))

const node: UserConfig = {
  name: id,
  entry: {
    index: 'src/index.ts',
    sessions: 'src/sessions/index.ts',
    commands: 'src/commands/index.ts',
    tools: 'src/tools/index.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    neverBundle: isProductionDep,
    alwaysBundle: (spec: string) => !isBuiltin(spec) && !isProductionDep(spec),
  },
}

const client: UserConfig = {
  name: `${id}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    neverBundle: (spec: string) => clientExternals.has(spec),
    alwaysBundle: (spec: string) => !clientExternals.has(spec),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [{
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (clientExternals.has(source)) return null
      if (VENDORED_LIBRARY.test(source) || INLINE_SAFE.test(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is neither a dsh baseline external nor listed in ${id}'s dsh.client.external `
        + '— cross-plugin value imports are forbidden (type-only imports are erased and never reach this gate)',
      )
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [node, client]
