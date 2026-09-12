/**
 * Reject a backtick inside a CSS template string, before the bundler sees it.
 *
 * The trap: a stylesheet is a template literal, so a backtick in a CSS *comment*
 * ends the string early and the rest of the CSS is parsed as JavaScript. The
 * bundler then fails with "Expected a semicolon", which points at the CSS line and
 * not at the real mistake — and a failed build leaves the previous lib/client.js in
 * place, so anything that runs afterwards (including verify) is looking at stale
 * output. That has cost this repo six debugging rounds, so it is now a gate.
 *
 * Usage: `node check-css-backticks.mjs` (wired as npm `prebundle`).
 * Exits 1 with file:line for every offending line.
 */
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const offenders = []

/** Walk src/ for the client sources. */
const files = []
const collect = async (dir) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await collect(path)
    else if (/\.tsx?$/.test(entry.name)) files.push(path)
  }
}
await collect(join(root, 'src'))

for (const file of files) {
  const lines = (await readFile(file, 'utf8')).split('\n')
  let inTemplate = false
  let templateName = ''
  lines.forEach((line, index) => {
    const opener = /(?:const|let)\s+(\w+)\s*=\s*`\s*$/.exec(line)
    if (!inTemplate && opener !== null) {
      inTemplate = true
      templateName = opener[1]
      return
    }
    if (!inTemplate) return
    if (line.trim() === '`') { inTemplate = false; return }
    // An ESCAPED backtick (\`) is legal inside a template literal and several
    // existing comments use it to quote CSS. Only a bare one ends the string.
    const bare = /(^|[^\\])`/.test(line)
    if (bare) {
      offenders.push({ file: relative(root, file), line: index + 1, templateName, text: line.trim().slice(0, 90) })
    }
  })
}

if (offenders.length > 0) {
  console.error('BACKTICK INSIDE A CSS TEMPLATE — the string ends early and the bundler will fail:')
  for (const o of offenders) console.error(`  ${o.file}:${o.line}  (in ${o.templateName})  ${o.text}`)
  console.error('Use quotes instead of backticks in CSS comments.')
  process.exit(1)
}
console.log(`css template check: ${files.length} sources clean`)
