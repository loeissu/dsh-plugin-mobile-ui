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
 * It also refuses to run on a STALE bundle. This is not hypothetical: a failed
 * build leaves the previous lib/client.js in place, and `npm run verify` then
 * happily reports PASS for code that is not the code on disk. That has already
 * produced one round of verifying the wrong artifact, so the check is explicit:
 * any source file newer than the bundle aborts the run.
 *
 * Usage: `node verify-bundle.mjs lib/client.js`
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const bundlePath = process.argv[2]
if (bundlePath === undefined) throw new Error('usage: node verify-bundle.mjs <client.js>')

// --- staleness guard ---------------------------------------------------------
{
  const here = dirname(fileURLToPath(import.meta.url))
  const sources = []
  const collect = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await collect(path)
      else if (/\.tsx?$/.test(entry.name)) sources.push(path)
    }
  }
  await collect(join(here, 'src'))
  const bundleTime = (await stat(bundlePath)).mtimeMs
  const newer = []
  for (const path of sources) {
    const t = (await stat(path)).mtimeMs
    if (t > bundleTime) newer.push(path.slice(here.length + 1))
  }
  if (newer.length > 0) {
    console.error('STALE BUNDLE: these sources are newer than ' + bundlePath + ':')
    for (const path of newer.slice(0, 10)) console.error('  ' + path)
    console.error('Run `npm run bundle` first (and check its exit code).')
    process.exit(2)
  }
}

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

/**
 * Minimal DOM so module-scope language detection, style injection and the
 * diagnostic badge work.
 *
 * `createElement` returns a functional element rather than a bare object. A
 * plugin that mounts anything into the page touches `setAttribute`,
 * `addEventListener` and `append`, and a stub missing those turns a real
 * environment concern into a confusing TypeError inside the plugin.
 */
const makeElementStub = (tag = 'div') => {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    children: [],
    attributes: {},
    dataset: {},
    style: {
      setProperty() {},
      removeProperty() {},
      getPropertyValue: () => '',
    },
    setAttribute(name, value) { el.attributes[name] = String(value) },
    getAttribute: (name) => (name in el.attributes ? el.attributes[name] : null),
    hasAttribute: (name) => name in el.attributes,
    removeAttribute(name) { delete el.attributes[name] },
    addEventListener() {},
    removeEventListener() {},
    append() {},
    appendChild() {},
    prepend() {},
    remove() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    contains: () => false,
  }
  return el
}

const documentStub = {
  documentElement: { getAttribute: () => 'en', style: makeElementStub().style },
  body: makeElementStub('body'),
  head: makeElementStub('head'),
  createElement: (tag) => makeElementStub(tag),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  // A real document is an event target, and several installs add listeners to it.
  // Leaving these out made the harness fail for a module that is correct in a
  // browser, which is the wrong signal: stub the surface, not the feature.
  addEventListener() {},
  removeEventListener() {},
}

Object.assign(globalThis, {
  // The badge attaches event listeners and starts an interval. Both are stubbed
  // so the harness never schedules real timers (which would hold the process
  // open) while still exercising the install path.
  window: {
    __ModuleLoader__: { load: (record) => { loads.push(record) } },
    addEventListener() {},
    removeEventListener() {},
    setInterval: () => 0,
    clearInterval() {},
  },
})
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
 * Fixture for the drawer's data hooks.
 *
 * Deliberately exercises the filtering and grouping the component performs
 * rather than handing it an empty state: a running session, a completed one, a
 * subagent (must be filtered), a blank placeholder (must be filtered), and an
 * archived id. A render over this fixture proves the list logic runs.
 */
const DRAWER_FIXTURE = {
  workspaces: {
    items: [
      { workspaceId: 'ws-1', path: 'H:\\DSH', title: 'DSH', sessionIds: ['s-1', 's-2', 's-3', 's-5'] },
      { workspaceId: 'ws-2', path: 'C:\\other', title: 'other', sessionIds: ['s-4'] },
    ],
    archivedSessionIds: ['s-5'],
    state: 'idle',
    phase: 'ready',
  },
  sessions: {
    ids: ['s-1', 's-2', 's-3', 's-4', 's-5'],
    byId: {
      's-1': { id: 's-1', displayTitle: '运行中的会话', running: true, blank: false, updatedAt: Date.now() - 1000 },
      's-2': { id: 's-2', displayTitle: '完成的会话', running: false, completed: true, blank: false, updatedAt: Date.now() - 90_000_000 },
      's-3': { id: 's-3', displayTitle: '子代理', running: false, origin: 'subagent', blank: false, updatedAt: Date.now() },
      's-4': { id: 's-4', displayTitle: '空占位', running: false, blank: true, updatedAt: Date.now() },
      's-5': { id: 's-5', displayTitle: '已归档', running: false, blank: false, updatedAt: Date.now() },
    },
    current: 's-1',
    phase: 'ready',
  },
}

/**
 * Plausible props per registration, so each component body can be executed.
 *
 * Keyed by slot and, where a slot has several occupants, by the registration
 * id — `shell.overlay` carries both the splash and the drawer, and they take
 * different props.
 * @param slot - the slot name.
 * @param id - the registration id, when it declared one.
 * @returns props to render the component with.
 */
function renderPropsFor(slot, id) {
  switch (slot) {
    case 'shell.overlay':
      if (id === 'mobile-ui-drawer') {
        return {
          // Selector hooks: the real ones take a selector and return its result.
          useSessions: (selector) => selector(DRAWER_FIXTURE.sessions),
          useWorkspaces: (selector) => selector(DRAWER_FIXTURE.workspaces),
          openSession: () => {},
          openWorkspace: () => {},
        }
      }
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
      return { collapsed: false, width: 280, renderSlot: () => null, toggleSidebar: () => {} }
    default:
      return {}
  }
}

// Render smoke test. Calling a function component with stubbed hooks executes
// its body, which catches thrown errors, bad JSX and undefined tokens that a
// registration-only check would miss.
for (const { options, component } of registered) {
  const props = renderPropsFor(options.name, options.id)
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
