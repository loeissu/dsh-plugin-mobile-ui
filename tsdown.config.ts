/**
 * Out-of-tree DSH client plugin build.
 *
 * Replicates the two artifact contracts the DSH loader requires, without
 * depending on the DSH monorepo:
 *
 *  1. A Node half at lib/index.js (ESM) so the Loader has a host-side row.
 *  2. A browser half at lib/client.js emitted as a closure-factory CJS bundle
 *     wrapped in `window.__ModuleLoader__.load({ id, factory })`.
 *
 * Everything in PLATFORM_MODULES stays an external `require` answered by the
 * shell's frozen module table; everything else is inlined.
 */
import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

/** The plugin's own manifest, for the version stamped into the bundle. */
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

/** The shell-seeded module table (packages/client/web/src/platform.ts). */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const ID = 'dsh-plugin-mobile-ui'

/**
 * Whether a specifier must stay an external `require` answered by the shell's
 * frozen module table. Matching is exact, mirroring the loader's own keying;
 * subpath entries (`react/jsx-runtime`) are listed explicitly.
 */
const isShared = (specifier: string): boolean => PLATFORM_MODULES.includes(specifier)

export default defineConfig([
  {
    name: ID,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    clean: false,
    sourcemap: true,
    // Everything in the shell's module table stays a `require`; anything else is
    // inlined. A require() the table cannot answer is a guaranteed runtime throw,
    // so this list is the whole externalization contract.
    external: (specifier: string) => isShared(specifier),
    define: {
      // Version is stamped from package.json so the settings page cannot drift.
      PLUGIN_VERSION: JSON.stringify(pkg.version),
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
