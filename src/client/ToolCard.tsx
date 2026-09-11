/**
 * Tool call card, registered into the `keyed` slot `tool.call.toolview`.
 *
 * ## Replacement semantics — read this before widening {@link FEATURES}
 *
 * The slot's contract says: "A key the shipped composition already covers is
 * replaced, not shared; an unclaimed key falls back to the generic tool row."
 * So registering `key: 'bash'` does not add a card beside DSH's — it REPLACES
 * DSH's own terminal card for `bash`. Only the tool names listed in
 * `config.ts` → `FEATURES.toolCards` are taken over, and that list is empty by
 * default, so nothing is displaced until someone opts in.
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
import { useState } from 'react'
import { accentSoft, injectStyles, TOKEN, V } from './theme.ts'
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
  border-radius: 14px;
  background: ${V.surface};
  overflow: hidden;
}

.dsh-mobile-tool__head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 11px 14px;
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

.dsh-mobile-tool__label {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.4;
  color: ${V.textDim};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-mobile-tool__detail {
  font-family: ${V.mono};
  font-size: 12px;
  color: ${V.accent};
  background: ${accentSoft()};
  padding: 1.5px 6px;
  border-radius: 5px;
}

.dsh-mobile-tool__count {
  flex: none;
  font-size: 11px;
  line-height: 16px;
  color: ${V.textFaint};
  background: ${V.hover};
  border-radius: 9px;
  padding: 1px 7px;
  font-variant-numeric: tabular-nums;
}

.dsh-mobile-tool__error { color: ${V.text}; }

.dsh-mobile-tool__chev {
  flex: none;
  color: ${V.textFaint};
  transition: transform var(${TOKEN.duration}, 200ms) var(${TOKEN.ease}, ease);
}

.dsh-mobile-tool[data-open='true'] .dsh-mobile-tool__chev { transform: rotate(180deg); }

/* 0fr -> 1fr is the animatable grid-row idiom: it transitions to the content's
   natural height without measuring it in JS. */
.dsh-mobile-tool__body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 280ms ${'cubic-bezier(.4,0,.2,1)'};
  border-top: 0.5px solid transparent;
}

.dsh-mobile-tool[data-open='true'] .dsh-mobile-tool__body {
  grid-template-rows: 1fr;
  border-top-color: ${V.border};
}

.dsh-mobile-tool__body > div { overflow: hidden; }

.dsh-mobile-tool__pre {
  margin: 0;
  padding: 13px 15px;
  font-family: ${V.mono};
  font-size: 12px;
  line-height: 1.65;
  color: ${V.textDim};
  background: ${V.bg};
  white-space: pre;
  overflow-x: auto;
  max-height: 60vh;
  overflow-y: auto;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-mobile-tool__body { transition: none; }
  .dsh-mobile-tool__chev { transition: none; }
}
`

/** Argument fields that make a readable one-line summary, in priority order. */
const SUMMARY_FIELDS = ['command', 'cmd', 'file_path', 'path', 'pattern', 'query', 'url', 'prompt'] as const

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
function summarize(raw: string): string {
  if (raw === '') return ''
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return raw.length > 90 ? `${raw.slice(0, 90)}…` : raw
  }
  if (parsed === null || typeof parsed !== 'object') return ''
  const record = parsed as Record<string, unknown>
  for (const field of SUMMARY_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && value !== '') {
      return value.length > 90 ? `${value.slice(0, 90)}…` : value
    }
  }
  return ''
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
  return parts.join('\n')
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
  const raw = contentText(settled ? props.block.content : undefined)
  const truncated = raw.length > MAX_RENDERED_CHARS
  const body = truncated ? `${raw.slice(0, MAX_RENDERED_CHARS)}\n… (${t.toolTruncated})` : raw
  const subCalls = isSettled(props.block) ? props.block.subCalls : (props.block as RunningBlock).subCalls
  const subCount = Array.isArray(subCalls) ? subCalls.length : 0

  const detail = summarize(blockArgs(props.block))
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
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 5.5L7 8l-2.5 2.5M8.5 10.5h3" />
            <rect x="1.5" y="2" width="13" height="12" rx="2.5" />
          </svg>
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
