/**
 * Verify the built client bundle against the DSH loader contract, without a
 * browser.
 *
 * The real host seeds `window.__ModuleLoader__` and a frozen module table
 * (packages/client/web/src/platform.ts), then evaluates each plugin bundle.
 * This harness reproduces that handoff: it counts loader loads, answers
 * `require` from a stub table only, and drives `apply()` against a stub slot
 * registry so the registration set can be asserted in CI.
 *
 * Three failure classes it catches, all of which produce a silent no-op in a
 * real host rather than an error:
 *
 *  1. React bundled instead of externalized — the shell already seeds the one
 *     React instance; a second copy breaks hooks. Detected via the requested
 *     specifier set (and an inflated bundle size).
 *  2. A missing `__ModuleLoader__.load` closure wrapper — the loader never sees
 *     the factory at all.
 *  3. Missing `apply` / `inject` exports, or an `apply` that registers into a
 *     different slot set than expected.
 *
 * Usage: `node verify-bundle.mjs lib/client.js`
 */
import { readFile } from 'node:fs/promises'

const bundlePath = process.argv[2]
if (bundlePath === undefined) throw new Error('usage: node verify-bundle.mjs <client.js>')

/** Specifiers the shell's frozen table can answer. Mirrors platform.ts. */
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

/**
 * Slots `apply()` must register into, given the default feature flags in
 * `src/client/config.ts`. `tool.call.toolview` and `sidebar` are absent because
 * both REPLACE shipped surfaces and are opt-in.
 */
const EXPECTED_SLOTS = ['settings.section', 'shell.overlay']

const requested = new Set()
const loads = []
const registered = []
const injected = []

/** React surface touched at module scope and by `apply`. */
const reactStub = {
  createElement: (...args) => ({ __el: args }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
  Fragment: Symbol('react.fragment'),
}

const jsxStub = {
  jsx: (type, props, key) => ({ __jsx: true, type, props, key }),
  jsxs: (type, props, key) => ({ __jsx: true, type, props, key }),
}

const table = {
  'react': reactStub,
  'react/jsx-runtime': jsxStub,
  // `createPortal` hosts the splash on <body> so the fixed layer resolves
  // against the viewport rather than the slot's positioned ancestor.
  'react-dom': { createPortal: (node) => node },
  'react-dom/client': {},
  '@deepseek-ai/cordis': {},
  '@deepseek-ai/dsh-client-store': {},
  '@deepseek-ai/dsh-client-ui-slots': {},
  '@deepseek-ai/dsh-client-ui-primitives': {},
  '@deepseek-ai/dsh-client-ui-dockkit': {},
}

const require = (specifier) => {
  requested.add(specifier)
  if (!(specifier in table)) {
    throw new Error(`module table cannot answer require(${JSON.stringify(specifier)})`)
  }
  return table[specifier]
}

/** Minimal DOM so module-scope language detection and style injection work. */
const documentStub = {
  documentElement: { getAttribute: () => 'en' },
  body: { hasAttribute: () => false },
  head: { append: () => {} },
  createElement: () => ({ dataset: {}, style: {} }),
  querySelector: () => null,
  getElementById: () => null,
}

globalThis.window = { __ModuleLoader__: { load: (record) => { loads.push(record) } } }
globalThis.document = documentStub
// Node 24 exposes `navigator` as a getter-only global, so it must be redefined
// rather than assigned. The bundle reads `navigator.language` for copy choice.
Object.defineProperty(globalThis, 'navigator', {
  value: { language: 'en' },
  configurable: true,
  writable: true,
})
globalThis.MutationObserver = class { observe() {} disconnect() {} }

const source = await readFile(bundlePath, 'utf8')

// The loader evaluates the bundle as a classic script with a real DOM present.
new Function('window', 'document', 'navigator', source)(
  globalThis.window,
  documentStub,
  globalThis.navigator,
)

console.log(`loader calls: ${loads.length}`)
if (loads.length !== 1) {
  throw new Error(`expected exactly one __ModuleLoader__.load call, saw ${loads.length}`)
}

const record = loads[0]
console.log(`id: ${record.id}`)
console.log(`factory: ${typeof record.factory}`)
if (record.id !== 'dsh-plugin-mobile-ui') {
  throw new Error(`loader id mismatch: ${record.id}`)
}
if (typeof record.factory !== 'function') throw new Error('factory is not a function')

const exports = record.factory(require)

console.log(`externals requested: ${[...requested].sort().join(', ') || '(none)'}`)
const unexpected = [...requested].filter((s) => !PLATFORM_MODULES.includes(s))
if (unexpected.length > 0) {
  throw new Error(
    `bundle requested specifiers outside the platform table: ${unexpected.join(', ')} — `
    + 'the shell cannot answer these and the factory will throw at boot',
  )
}
if (requested.size === 0) {
  throw new Error(
    'bundle requested no externals at all — React was probably bundled instead of externalized',
  )
}

console.log(`exports: ${Object.keys(exports).sort().join(', ') || '(none)'}`)
for (const name of ['apply', 'inject']) {
  if (!(name in exports)) throw new Error(`missing required export: ${name}`)
}
if (typeof exports.apply !== 'function') throw new Error('apply must be a function')
if (!Array.isArray(exports.inject)) throw new Error('inject must be an array')
console.log(`inject: ${JSON.stringify(exports.inject)}`)
if (!exports.inject.includes('slots')) {
  throw new Error('apply must inject the "slots" service')
}

/** Stub registry: records inject() keys and register() options. */
const ctx = {
  slots: {
    inject: (key, callback) => {
      injected.push(key)
      callback()
      return () => {}
    },
    register: (options, component) => {
      registered.push({ options, component })
      return () => {}
    },
  },
  effect: (fn) => { fn(); return () => {} },
}

exports.apply(ctx)

const injectedSlots = [...injected].sort()
console.log(`slots injected: ${JSON.stringify(injectedSlots)}`)

const missing = EXPECTED_SLOTS.filter((slot) => !injectedSlots.includes(slot))
if (missing.length > 0) {
  throw new Error(`apply did not register into: ${missing.join(', ')}`)
}

/**
 * Shipped occupants this plugin deliberately shadows. Each is a `single` cell
 * owned by a payload package, so a registration at the same priority is a hard
 * error rather than a replacement.
 */
const SHADOWED_SINGLE_SLOTS = new Set(['sidebar'])

for (const { options, component } of registered) {
  const { name, id, key, order, priority } = options
  console.log(
    `registered -> name=${name} id=${id ?? '-'} key=${key ?? '-'}`
    + ` order=${order ?? '-'} priority=${priority ?? '-'}`,
  )
  if (name === undefined) throw new Error('a registration is missing its slot name')
  if (typeof component !== 'function') {
    throw new Error(`component for ${name} is not a function`)
  }
  // One entry per priority, for both cardinalities that can shadow. A `keyed`
  // cell rejects a second entry for the same key, and a `single` cell rejects a
  // second entry outright — the slot prose ("replaced, not shared") describes
  // intent, not enforcement. Both were observed as thrown errors on a live
  // instance, and the `single` case fails the whole plugin activation, so the
  // contract check enforces the priority for both.
  const shadowsSingle = SHADOWED_SINGLE_SLOTS.has(name)
  if ((key !== undefined || shadowsSingle) && !(typeof priority === 'number' && priority < 0)) {
    const what = key !== undefined ? `keyed registration for "${key}"` : `takeover of single slot "${name}"`
    throw new Error(
      `${what} must declare a negative priority: this cell rejects a second entry `
      + 'at the same priority rather than shadowing it, and for a single slot that '
      + 'collision fails the entire plugin activation',
    )
  }
}

/**
 * Plausible owner props per slot, so each component body can be executed.
 * Values mirror the published owner shares.
 */
function renderPropsFor(slot) {
  switch (slot) {
    case 'shell.overlay':
      return {}
    case 'settings.section':
      return { close: () => {} }
    case 'tool.call.toolview':
      return {
        callId: 'call-1',
        toolName: 'bash',
        block: { name: 'bash', argsRaw: '{"command":"ls src/"}', subCalls: [] },
      }
    case 'sidebar':
      return { collapsed: false, width: 280, renderSlot: () => null }
    default:
      return {}
  }
}

// Render smoke test. Calling a function component with stubbed hooks executes
// its body, which catches thrown errors, bad JSX and undefined tokens that a
// registration-only check would miss.
for (const { options, component } of registered) {
  const props = renderPropsFor(options.name)
  let tree
  try {
    tree = component(props)
  } catch (error) {
    throw new Error(`component for ${options.name} threw while rendering: ${String(error)}`)
  }
  if (tree === undefined) {
    throw new Error(`component for ${options.name} returned undefined (expected a node or null)`)
  }
  console.log(`rendered -> ${options.name} ok`)
}

console.log('\nRESULT: bundle satisfies the loader contract')
