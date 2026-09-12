/**
 * Tool call card, registered into the `keyed` slot `tool.call.toolview`.
 *
 * ## Shadowing semantics — read this before widening `FEATURES.toolCards`
 *
 * The slot's documented contract says "a key the shipped composition already
 * covers is replaced, not shared", but the RUNTIME is stricter than that
 * sentence suggests: a keyed cell admits only one entry per priority, and a
 * second registration at the same priority is a hard error, not a shadow:
 *
 *   keyed slot "tool.call.toolview" already has an entry for key "read" at
 *   priority 0 (registered by ...) — register at a different priority to
 *   shadow it (lowest renders)
 *
 * This was observed on a live instance, not inferred. Because lower priority
 * renders, taking over a shipped key means registering BELOW it — see
 * `SHADOW_PRIORITY` in `index.tsx`.
 *
 * Note what "taking over" costs: the shipped card is never rendered, so its
 * affordances go with it. `FEATURES.toolCards` ships with five entries
 * (pwsh/read/grep/edit/write), of which read/grep/edit/write replace the host's own
 * card for that tool and therefore lose its "在轨迹中查看" and file-open controls.
 * Set the list to `[]` to keep every shipped card; `pwsh` alone is additive, since
 * the host leaves that key to its generic card.
 *
 * ## Why the prop type is declared here
 *
 * DSH's guidance is to derive component props from the published shares
 * (`PropsRuntime<'tool.call.toolview'>`) rather than hand-write members. An
 * out-of-tree plugin cannot do that without adding the owning type package as
 * a build dependency, which would couple this package to a DSH minor version.
 * The interface below mirrors the published owner share
 * (`dsh-client-ui-tool/lib/types/client/contract/slots.d.ts`) and is
 * deliberately narrower than the real one: it uses only structurally stable
 * fields. See README.md for the upgrade path.
 *
 * ## Defensive rendering
 *
 * `ToolCallBlock` is a discriminated union whose settled arm carries
 * `call: { name, argsRaw } | null` — explicitly null when window truncation
 * left the call outside the loaded window. Every field this component reads is
 * therefore treated as possibly absent, and an unrecognised block shape renders
 * a minimal row rather than throwing. DSH's own convention is the same:
 * "Unknown or malformed tool data falls back to the generic form."
 */
import { useEffect, useMemo, useState } from 'react'
import { accentSoft, injectStyles, MOTION, R, SPACE, TOKEN, TYPE, TYPE_LH, V } from './theme.ts'
import { t } from './config.ts'

/** A settled tool result, as much of it as this card reads. */
interface SettledBlock {
  readonly kind: 'tool-result'
  readonly isError?: boolean
  readonly content?: readonly unknown[]
  readonly call?: { readonly name?: string; readonly argsRaw?: string } | null
  readonly error?: { readonly name?: string; readonly code?: string }
  readonly subCalls?: readonly unknown[]
}

/** An in-flight tool call; the arm with no `kind` discriminator. */
interface RunningBlock {
  readonly name?: string
  readonly argsRaw?: string
  readonly subCalls?: readonly unknown[]
}

/** The owner share this card consumes. */
export interface ToolCardProps {
  /** Tool call identity, stable across running and settled forms. */
  readonly callId: string
  /** Wire tool name; also the keyed dispatch value. */
  readonly toolName: string
  /** Frozen running call or settled result node. */
  readonly block: SettledBlock | RunningBlock
  /** Session workspace root, for relative path display. */
  readonly cwd?: string
  /** Host account home; POSIX home-rooted paths display as `~`. */
  readonly home?: string
  /** Open a tool argument path in the host's editor surface. */
  readonly openFile?: (path: string, options?: unknown) => void
}

const STYLE_ID = 'tool-card'

const CSS = `
.dsh-mobile-tool {
  border: 0.5px solid ${V.border};
  border-radius: ${R.lg};
  background: ${V.surface};
  overflow: hidden;
}

.dsh-mobile-tool__head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  /* rowY (11px) is what turns a 21px line into a 44px target. */
  padding: ${SPACE.rowY} 14px;
  cursor: pointer;
  user-select: none;
  background: transparent;
  border: 0;
  width: 100%;
  font: inherit;
  color: inherit;
  text-align: left;
}

.dsh-mobile-tool__head:active { background: ${V.active}; }
@media (hover: hover) {
  .dsh-mobile-tool__head:hover { background: ${V.hover}; }
}

.dsh-mobile-tool__ico {
  flex: none;
  display: grid;
  place-items: center;
  color: ${V.textFaint};
}
.dsh-mobile-tool__head:has(.dsh-mobile-tool__error) .dsh-mobile-tool__ico {
  color: ${V.accent};
}

.dsh-mobile-tool__label {
  flex: 1;
  min-width: 0;
  font-size: ${TYPE.bodySm};
  line-height: ${TYPE_LH.bodySm};
  color: ${V.textDim};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-mobile-tool__detail {
  font-family: ${V.mono};
  font-size: ${TYPE.caption};
  line-height: ${TYPE_LH.caption};
  /* Mixing the accent towards the theme's primary label darkens it in light mode
     and lightens it in dark mode, so contrast rises in BOTH palettes. Measured
     before: the plain accent is 4.23:1 on the light card at 12px (below AA),
     4.66:1 in dark. */
  color: color-mix(in srgb, ${V.accent} 80%, ${V.text});
  background: ${accentSoft()};
  padding: 1.5px 6px;
  border-radius: ${R.xs};
}

.dsh-mobile-tool__count {
  flex: none;
  font-size: ${TYPE.micro};
  line-height: ${TYPE_LH.micro};
  color: ${V.textFaint};
  background: ${V.hover};
  border-radius: ${R.sm};
  padding: 1px 7px;
  font-variant-numeric: tabular-nums;
}

.dsh-mobile-tool__error { color: ${V.text}; }

.dsh-mobile-tool__chev {
  flex: none;
  color: ${V.textFaint};
  transition: transform ${MOTION.base} var(${TOKEN.ease}, ease);
}

.dsh-mobile-tool[data-open='true'] .dsh-mobile-tool__chev { transform: rotate(180deg); }

/* 0fr -> 1fr is the animatable grid-row idiom: it transitions to the content's
   natural height without measuring it in JS. It IS a layout animation, so the
   body carries contain: layout paint to keep the relayout inside the card. */
.dsh-mobile-tool__body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows ${MOTION.expand} ${MOTION.ease};
  border-top: 0.5px solid transparent;
}

.dsh-mobile-tool[data-open='true'] .dsh-mobile-tool__body {
  grid-template-rows: 1fr;
  border-top-color: ${V.border};
}

.dsh-mobile-tool__body > div {
  overflow: hidden;
  contain: layout paint;
}

.dsh-mobile-tool__pre {
  margin: 0;
  padding: 13px 15px;
  font-family: ${V.mono};
  font-size: ${TYPE.caption};
  line-height: ${TYPE_LH.code};
  /* Tool output is read as code: ligature substitution can fuse characters
     that the user needs to copy verbatim. */
  font-variant-ligatures: none;
  color: ${V.textDim};
  /* Host code fences use their own fill: bg-base and bg-layer-1 are BOTH #fff in
     light mode, so V.bg left the block flush with the card. */
  background: ${V.codeBlock};
  white-space: pre;
  overflow-x: auto;
  /* 60vh is the static viewport height and ignores the keyboard that
     viewport.ts shrinks the frame for; dvh follows it. The vh line stays as the
     fallback for engines without dvh. */
  max-height: 60vh;
  max-height: min(60dvh, 420px);
  overflow-y: auto;
  /* Without this, reaching the end of the output chains the scroll to the
     conversation behind it. */
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-mobile-tool__body { transition: none; }
  .dsh-mobile-tool__chev { transition: none; }
}
`

/**
 * Argument fields that make a readable one-line summary, in priority order.
 * Path-bearing fields are shortened against the session cwd before display.
 */
const SUMMARY_FIELDS = ['command', 'cmd', 'file_path', 'path', 'pattern', 'query', 'url', 'prompt'] as const

/**
 * Shorten a path so it survives a ~200px summary row.
 *
 * The summary element is roughly 200px wide on a 412px phone at a 13px face, so
 * only about 22 characters fit. Absolute paths in tool arguments routinely
 * exceed 120 characters: unshortened they overflow about 3x, and the ellipsis
 * leaves only a useless `C:\Users\...` prefix.
 *
 * Relativising against the session cwd (supplied in the owner props) is the
 * first cut; because even a relative repository path overflows, the displayed
 * form is then reduced to at most two trailing segments — the directory that
 * disambiguates plus the filename, which is what a reader scans for.
 * @param value - the raw argument value.
 * @param cwd - session workspace root, when the owner supplied one.
 * @param home - host home directory, when the owner supplied one.
 * @returns the display form.
 */
function shortenPath(value: string, cwd?: string, home?: string): string {
  let out = value
  if (cwd !== undefined && cwd !== '' && out.startsWith(cwd)) {
    const rest = out.slice(cwd.length).replace(/^[\\/]+/, '')
    if (rest !== '') out = rest
  } else if (home !== undefined && home !== '' && out.startsWith(home)) {
    out = `~${out.slice(home.length)}`
  }
  const parts = out.split(/[\\/]/).filter((p) => p !== '')
  if (parts.length <= 2) return parts.join('/')
  return `…/${parts.slice(-2).join('/')}`
}

/**
 * Whether a block is the settled arm.
 * @param block - the tool call block.
 * @returns true for a settled result node.
 */
function isSettled(block: SettledBlock | RunningBlock): block is SettledBlock {
  return (block as SettledBlock).kind === 'tool-result'
}

/**
 * Pull the tool's display name off whichever arm is present.
 * @param block - the tool call block.
 * @param fallback - owner-supplied tool name.
 * @returns the tool name.
 */
function blockName(block: SettledBlock | RunningBlock, fallback: string): string {
  if (isSettled(block)) {
    const name = block.call?.name
    return typeof name === 'string' && name !== '' ? name : fallback
  }
  const name = (block as RunningBlock).name
  return typeof name === 'string' && name !== '' ? name : fallback
}

/**
 * Raw argument text off whichever arm is present.
 * @param block - the tool call block.
 * @returns the raw args string, or an empty string.
 */
function blockArgs(block: SettledBlock | RunningBlock): string {
  const raw = isSettled(block) ? block.call?.argsRaw : (block as RunningBlock).argsRaw
  return typeof raw === 'string' ? raw : ''
}

/**
 * Build a one-line summary from the raw arguments.
 *
 * `argsRaw` is a JSON string in the normal case, but is treated as opaque text
 * when it does not parse, because window truncation and unknown tools can both
 * produce other shapes.
 * @param raw - raw argument text.
 * @returns the salient detail, or an empty string when none is recognisable.
 */
/**
 * Build a one-line summary from the raw arguments.
 *
 * `argsRaw` is a JSON string in the normal case, but is treated as opaque text
 * when it does not parse, because window truncation and unknown tools can both
 * produce other shapes.
 * @param raw - raw argument text.
 * @param cwd - session workspace root, for path shortening.
 * @param home - host home directory, for path shortening.
 * @returns the salient detail, or an empty string when none is recognisable.
 */
function summarize(raw: string, cwd?: string, home?: string): string {
  if (raw === '') return ''
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const oneLine = shortenPath(raw, cwd, home).replace(/\s*\n\s*/g, ' ⏎ ')
    return oneLine.length > 90 ? `${oneLine.slice(0, 90)}…` : oneLine
  }
  if (parsed === null || typeof parsed !== 'object') return ''
  const record = parsed as Record<string, unknown>
  for (const field of SUMMARY_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && value !== '') {
      const isPath = field === 'file_path' || field === 'path'
      const shown = isPath ? shortenPath(value, cwd, home) : value
      // Commands are frequently multi-line; the row is single-line by contract.
      const oneLine = shown.replace(/\s*\n\s*/g, ' ⏎ ').trim()
      return oneLine.length > 90 ? `${oneLine.slice(0, 90)}…` : oneLine
    }
  }
  return ''
}

/**
 * Strip the envelope several tools wrap their result in.
 *
 * `read`/`write` return `<path>…</path> <type>file</type> <content> … </content>`
 * style text. Rendering the tags and line numbers verbatim is noise on a phone:
 * the path is already the card's summary, and the type is implied by the tool.
 * Only a leading envelope is removed, and only when it is well-formed, so an
 * arbitrary result that merely contains a `<content>` tag is left alone.
 * @param text - the flattened result text.
 * @returns the text with a leading envelope removed.
 */
function stripEnvelope(text: string): string {
  const match = /^\s*<path>[^]*?<\/path>\s*<type>[^]*?<\/type>\s*<content>\s*([^]*?)\s*<\/content>\s*$/.exec(text)
  if (match !== null && typeof match[1] === 'string') return match[1]
  return text
}

/**
 * Flatten a settled result's content blocks to displayable text.
 * @param content - the result's content blocks, shape treated as unknown.
 * @returns newline-joined text.
 */
function contentText(content: readonly unknown[] | undefined): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') { parts.push(block); continue }
    if (block === null || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    for (const field of ['text', 'content', 'data', 'output'] as const) {
      const value = record[field]
      if (typeof value === 'string' && value !== '') { parts.push(value); break }
    }
  }
  return stripEnvelope(parts.join('\n'))
}

/** Cap on rendered output, so a huge result cannot lock up the phone. */
const MAX_RENDERED_CHARS = 20000

/**
 * One tool call card.
 * @param props - the slot's owner share.
 * @returns the card.
 */
export function ToolCard(props: ToolCardProps) {
  injectStyles(STYLE_ID, CSS)

  const [open, setOpen] = useState(false)

  const name = blockName(props.block, props.toolName)
  const settled = isSettled(props.block)
  const failed = settled && props.block.isError === true
  // Memoised on the block: the parent turn re-renders on every streaming chunk, and
  // this walks up to MAX_RENDERED_CHARS of text through stripEnvelope each time.
  const raw = useMemo(
    () => contentText(settled ? props.block.content : undefined),
    [settled, props.block],
  )
  const truncated = raw.length > MAX_RENDERED_CHARS
  const body = truncated ? `${raw.slice(0, MAX_RENDERED_CHARS)}\n… (${t.toolTruncated})` : raw
  const subCalls = isSettled(props.block) ? props.block.subCalls : (props.block as RunningBlock).subCalls
  const subCount = Array.isArray(subCalls) ? subCalls.length : 0

  // Failures open by default: on a phone the reader needs the error body
  // without a second tap. A later collapse is respected until the block
  // becomes non-failed (or a new failure arrives).
  useEffect(() => {
    if (failed) setOpen(true)
  }, [failed])

  const detail = summarize(blockArgs(props.block), props.cwd, props.home)
  const verb = settled ? (failed ? t.toolFailed : t.toolRan) : t.toolRunning

  return (
    <div className="dsh-mobile-tool" data-open={open ? 'true' : 'false'} data-dsh-mobile-ui="tool-card">
      <button
        type="button"
        className="dsh-mobile-tool__head"
        aria-expanded={open}
        onClick={() => { setOpen((value) => !value) }}
      >
        <span className="dsh-mobile-tool__ico" aria-hidden="true">
          {failed ? (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2.5 1.8 13.5h12.4L8 2.5Z" />
              <path d="M8 6.5v3.2M8 11.8v.2" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 5.5L7 8l-2.5 2.5M8.5 10.5h3" />
              <rect x="1.5" y="2" width="13" height="12" rx="2.5" />
            </svg>
          )}
        </span>

        <span className={'dsh-mobile-tool__label' + (failed ? ' dsh-mobile-tool__error' : '')}>
          {verb} <span className="dsh-mobile-tool__detail">{name}</span>
          {detail !== '' ? ` ${detail}` : ''}
        </span>

        {subCount > 0 ? <span className="dsh-mobile-tool__count">+{subCount}</span> : null}

        <span className="dsh-mobile-tool__chev" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 5.5L7 9l3.5-3.5" />
          </svg>
        </span>
      </button>

      <div className="dsh-mobile-tool__body">
        <div>
          <pre className="dsh-mobile-tool__pre">{body !== '' ? body : t.toolNoOutput}</pre>
        </div>
      </div>
    </div>
  )
}
