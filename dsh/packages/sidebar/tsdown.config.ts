/**
 * Build config for soulnet-dsh-sidebar — the same out-of-repo replica of dsh's
 * client-bundle preset as ../dsh/tsdown.config.ts (see the notes there):
 *  1. Node half: `lib/index.js`, ESM, an empty host plugin (Loader needs a host
 *     row; the package contributes browser presentation only).
 *  2. Browser half: ONE file `lib/client.js`, CJS wrapped as a lazy factory for
 *     the dsh module loader; react / react/jsx-runtime / cordis / slots /
 *     primitives / the preloaded client runtime stay external, everything else
 *     (this package's own files) is inlined. Any other `@deepseek-ai/*` VALUE
 *     import is a build error (bundle purity).
 */
import { readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import type { UserConfig } from 'tsdown'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  name: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  dsh?: { client?: { external?: string[] } }
}
const id = pkg.name

const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]
const PRELOADED_CLIENT_EXTERNALS = ['@deepseek-ai/dsh-client-runtime/client']
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

const clientExternals = new Set([
  ...PLATFORM_MODULES,
  ...PRELOADED_CLIENT_EXTERNALS,
  ...(pkg.dsh?.client?.external ?? []),
])
const productionDeps = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
])
const isProductionDep = (spec: string): boolean =>
  [...productionDeps].some(name => spec === name || spec.startsWith(`${name}/`))

const node: UserConfig = {
  name: id,
  entry: { index: 'src/index.ts' },
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
      if (VENDORED_LIBRARY.test(source)) return null
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
