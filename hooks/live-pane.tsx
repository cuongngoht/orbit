import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { PaneHeader, PaneModel, PaneOrbit, PaneRow, PaneSegment, PaneView } from '../types'

// Orbit LIVE, docked beside the Claude Code session (Orbit 1.8.5; 1.8.6 Live Pane 2.0): the AI CLI keeps the left, the
// prompt and the keyboard; this pane is a viewer on the right. It draws what the Orbit engine answers -- the header
// line (0.0.1: the orbit, turning on this pane's own clock while -- and only while -- the engine says the task moves),
// the work as a TASK EXECUTION checklist (the steps it actually took, the checks nested under them), what it is
// doing NOW, the views a person switches between (events, tests, changes, notices, plan, timeline), task and test
// progress, and a status bar ending in the LIVE indicator -- from
// `node <engine>/cli/live.mjs pane --host=claude`, asked every two seconds while the pane is drawn. It adds no word of
// its own and decides nothing: the engine reads the task's journals; the pane draws. It never takes the keyboard, and
// it asks for the share of the terminal's width a person set (`live settings`: pane.widthPercent, 36 by default); a
// width the person dragged wins.
//
// WHEN: /orbit or /orbit-help opens it -- typed, or either skill run by the model -- before the skill's text reaches the
// model, so the pane already is this session's viewer when the skill runs `live ensure`, and no Terminal window opens
// beside it. `/orbit-live` shows or hides it. A close is the person's: the engine is told (`--left=person`), the task
// goes on untouched, and the next /orbit or /orbit-help opens it again. Docked on the right in Claude Code's fullscreen layout
// from 110 columns; elsewhere above the prompt, saying so.
//
// WHICH ENGINE: the one it ships in. The pane is part of the Orbit plugin, so `live pane` is always this plugin's own,
// at its root, and of the same release.

const PANE = 'orbit-live'
const TITLE = 'Orbit Live'
const EVERY_MS = 2000
const ASK_MS = 5000
const INLINE_ROWS = 18
// The skills that open it: `orbit` (a goal) and `orbit-help` -- by name, so no other orbit-* skill does.
const ENTRY = /(^|:)orbit(-help)?$/
// How often the orbit turns while it moves: its frames are the engine's, at most ten a second.
const SPIN_MS = 100
const SHARE = 36
// A terminal draws a row of Buttons as written, with nothing between them: the view tabs keep two cells apart.
const TAB_GAP = 2

const BRAND: PaneSegment = { text: ' ORBIT LIVE ', tone: 'chip' }

const saying = (text: string, tone = 'warning'): PaneModel => ({ version: 1, lease: null, held: false, task: null, header: [BRAND, { text: `  ${text}`, tone }], overview: [], now: [], tier: null, titles: { checklist: '', current: '' }, checklist: [], current: [], statusBar: null, views: [], progress: [], look: { widthPercent: SHARE, focusCli: true }, hints: { inline: null } })

const model = atom({ plugin: 'orbit', key: 'model' } as const, saying('reading this session’s task…', 'subtle'))
const lease = atom({ plugin: 'orbit', key: 'lease' } as const, '')
const view = atom({ plugin: 'orbit', key: 'view' } as const, 'events')
// The orbit's frame this pane drew last, '' while the engine's own header stands (the orbit parked).
const spin = atom({ plugin: 'orbit', key: 'spin' } as const, '')

type Run = { timer: Timer | null; spin: Timer | null; busy: boolean; columns: number; rows: number; terminal: number | null; asked: number | null }

// The module's own, started over on every reload: the timer while the pane is open, the room it was last drawn in,
// the terminal's width as last seen and the dock width last asked for. What must outlive a
// reload -- the picture, the lease token, the view picked -- is in $.state.
const run: Run = { timer: null, spin: null, busy: false, columns: 60, rows: 30, terminal: null, asked: null }

// ---- which engine ---------------------------------------------------------------------------------------------

const engineOf = ($: EngineInterface): string => $.plugin.root

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

// ---- the engine's answer, read strictly: what is not the shape asked for is left out --------------------------

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null)

const segmentsOf = (value: unknown): PaneSegment[] => (Array.isArray(value) ? value.filter(isRecord).map((s) => ({ text: text(s.text) ?? '', tone: text(s.tone) })) : [])

const linesOf = (value: unknown): PaneSegment[][] => (Array.isArray(value) ? value.map(segmentsOf) : [])

const rowOf = (value: unknown): PaneRow | null => (isRecord(value) ? { left: segmentsOf(value.left), right: segmentsOf(value.right), depth: typeof value.depth === 'number' ? value.depth : 0, status: text(value.status), label: text(value.label), box: text(value.box) } : null)

const rowsOf = (value: unknown): PaneRow[] => (Array.isArray(value) ? value.map(rowOf).filter((r): r is PaneRow => r !== null) : [])

const viewOf = (value: unknown): PaneView | null => (isRecord(value) && typeof value.id === 'string' ? { id: value.id, label: text(value.label) ?? value.id, rows: rowsOf(value.rows), hint: text(value.hint) } : null)

// 0.0.2: the header in its parts, or null for an answer without them (the flat header is drawn then).
const headerPartsOf = (value: unknown): PaneHeader | null => (isRecord(value) ? { left: segmentsOf(value.left), badge: segmentsOf(value.badge), right: segmentsOf(value.right) } : null)

const viewsOf = (value: unknown): PaneView[] => (Array.isArray(value) ? value.map(viewOf).filter((v): v is PaneView => v !== null) : [])

const titlesOf = (value: unknown) => ({ checklist: (isRecord(value) && text(value.checklist)) || '', current: (isRecord(value) && text(value.current)) || '' })

const lookOfAnswer = (value: unknown) => ({ widthPercent: isRecord(value) && typeof value.widthPercent === 'number' ? value.widthPercent : SHARE, focusCli: !isRecord(value) || value.focusCli !== false })

const hintsOf = (value: unknown) => ({ inline: isRecord(value) ? text(value.inline) : null })

// The versions of `live pane` this pane draws: 1 (1.8.5) and 2 (1.8.6, additive -- the progress lines, the Plan and
// Timeline views, the LIVE indicator in the status bar). What a version adds that this pane does not know is left out.
const VERSION = 2

const progressOf = (value: unknown): PaneRow[] => (isRecord(value) ? rowsOf(value.rows) : [])

const numberOf = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

// 0.0.1: what turning the header's orbit takes (src/live/orbit.mjs `orbitTrackOf`), or null for an answer without one.
const orbitOf = (value: unknown): PaneOrbit | null =>
  isRecord(value) && Array.isArray(value.frames) && value.frames.length > 0 && typeof value.parked === 'string'
    ? { moving: value.moving === true, tone: text(value.tone), frames: value.frames.map((f) => String(f)), parked: value.parked, lastAt: text(value.lastAt), kickMs: numberOf(value.kickMs, 3000), fps: { kick: numberOf(isRecord(value.fps) ? value.fps.kick : null, 10), cruise: numberOf(isRecord(value.fps) ? value.fps.cruise : null, 4) } }
    : null

export function modelOf(stdout: string): PaneModel | null {
  const doc = parsed(stdout)
  if (!isRecord(doc) || typeof doc.version !== 'number' || doc.version !== VERSION) return null
  return { version: doc.version, lease: text(doc.lease), held: doc.held === true, task: text(doc.task), header: segmentsOf(doc.header), headerParts: headerPartsOf(doc.headerParts), overview: linesOf(doc.overview), now: linesOf(doc.now), tier: text(doc.tier), titles: titlesOf(doc.titles), checklist: rowsOf(doc.checklist), current: rowsOf(doc.current), statusBar: rowOf(doc.statusBar), views: viewsOf(doc.views), progress: progressOf(doc.progress), look: lookOfAnswer(doc.look), hints: hintsOf(doc.hints), orbit: orbitOf(doc.orbit) }
}

// `node <engine>/cli/live.mjs pane --host=claude …` once, with this session's id and directory on stdin, as the
// status line hands them: its stdout, or null when it could not be asked. The directory is the session's PROJECT ROOT,
// never the shell's: a host that runs `cd` into Orbit's store for a command does not move the checkout this pane
// follows (1.8.6; `$.session.root()` moves only on /cd, a host's directory change or a worktree move).
async function engineSaid($: EngineInterface, root: string, extra: readonly string[]): Promise<string | null> {
  const token = await read($, lease)
  const argv = ['node', `${root}/cli/live.mjs`, 'pane', '--host=claude', `--columns=${run.columns}`, `--rows=${run.rows}`, ...(token ? [`--lease=${token}`] : []), ...extra]
  const stdin = JSON.stringify({ session_id: await $.session.id(), cwd: await $.session.root() })
  const got = await $.process.run(argv, { stdin, timeoutMs: ASK_MS }).catch(() => null)
  return got?.stdout ?? null
}

const asked = async ($: EngineInterface, root: string, extra: readonly string[]): Promise<PaneModel | null> => modelOf((await engineSaid($, root, extra)) ?? '')

// Whether /orbit or /orbit-help opens the pane by itself here: the person's word in Orbit Control (live.open, Live display), which
// `pane --auto` reads and answers without writing anything. Anything but a plain yes -- no repository,
// Live switched off, an answer that did not parse -- opens nothing; /orbit-live still does.
async function opensHere($: EngineInterface): Promise<boolean> {
  const doc = parsed((await engineSaid($, engineOf($), ['--auto'])) ?? '')
  return isRecord(doc) && doc.opens === true
}

// A picture the same as the one drawn is not written again: a write redraws every reader, and a pane asked every two
// seconds about a quiet task would redraw for nothing. Only what the pane DRAWS is compared (the overview and NOW's
// lines are not drawn while a status bar is). The engine leaves the wall clock and "how long ago" out of its answer,
// so a quiet task costs no redraw; a running action's elapsed time, and the LIVE glyph when evidence arrives, do redraw.
const drawnOf = (m: PaneModel): string => JSON.stringify([m.header, m.headerParts ?? null, m.tier, m.titles, m.checklist, m.current, m.views, m.progress ?? [], m.statusBar, m.statusBar ? null : (m.now[0] ?? null), m.look, m.hints, m.orbit ?? null])

const same = (a: PaneModel, b: PaneModel): boolean => drawnOf(a) === drawnOf(b)

async function answered($: EngineInterface, extra: readonly string[]): Promise<void> {
  const got = (await asked($, engineOf($), extra)) ?? saying('the Orbit engine did not answer; asking again')
  if (!same(await read($, model), got)) await update($, model, () => got)
  await update($, lease, () => got.lease ?? '')
}

// One ask at a time: a tick that comes while the last ask still runs is skipped, never queued.
async function refreshed($: EngineInterface, extra: readonly string[] = []): Promise<void> {
  if (run.busy) return
  run.busy = true
  try {
    await answered($, extra)
    await sized($)
    await spun($)
  } finally {
    run.busy = false
  }
}

// ---- the orbit: turned here, on this pane's clock, only while the engine says the task moves ------------------

// Where the satellite is now: the engine's frames and numbers (src/live/orbit.mjs `phaseOf`) on this pane's clock --
// launched by the newest evidence, fast for kickMs, then cruising.
export function orbitFrameAt(o: PaneOrbit, nowMs: number): string {
  const at = Date.parse(o.lastAt ?? '')
  const since = Number.isFinite(at) ? Math.max(0, nowMs - at) : nowMs
  const phase = Math.floor((o.fps.kick * Math.min(since, o.kickMs) + o.fps.cruise * Math.max(0, since - o.kickMs)) / 1000)
  return o.frames[phase % o.frames.length] ?? o.parked
}

async function turned($: EngineInterface): Promise<void> {
  const o = (await read($, model)).orbit
  const frame = o?.moving ? orbitFrameAt(o, await $.clock.now()) : ''
  if (frame !== (await read($, spin))) await update($, spin, () => frame)
}

// A timer of its own while the orbit moves and the pane follows; gone the moment either stops.
async function spun($: EngineInterface): Promise<void> {
  if ((await read($, model)).orbit?.moving && run.timer) {
    run.spin ??= $.clock.every(SPIN_MS, () => void turned($))
    return
  }
  run.spin?.cancel()
  run.spin = null
  if ((await read($, spin)) !== '') await update($, spin, () => '')
}

// The header with the orbit turned: only over the engine's own parked frame, so a header without one is drawn as said --
// every one of them (0.0.2): the one the header opens with and the one in the badge turn together.
export const withOrbit = (header: PaneSegment[], o: PaneOrbit | null | undefined, frame: string): PaneSegment[] =>
  frame && o ? header.map((s) => (s.text === o.parked ? { ...s, text: frame } : s)) : header

// ---- the width a person set: asked of the dock once the terminal's width is known, again only when it moved ----

export const shareOf = (terminal: number, percent: number): number => Math.max(32, Math.round((terminal * percent) / 100))

async function sized($: EngineInterface): Promise<void> {
  const m = await read($, model)
  const columns = run.terminal === null ? null : shareOf(run.terminal, m.look.widthPercent)
  if (columns === null || columns === run.asked) return
  run.asked = columns
  await $.ui.open({ id: PANE, title: TITLE, columns })
}

// ---- opening, following, closing -----------------------------------------------------------------------------

const paneNow = async ($: EngineInterface) => (await $.ui.panes()).find((p) => p.id === PANE)

const isOpen = async ($: EngineInterface): Promise<boolean> => (await paneNow($)) !== undefined

// Only a pane a person can see asks, and so only it holds the session's viewer lease: one opened unasked on a narrow
// terminal waits undrawn, holding nothing, and `live ensure` opens a window beside the session as it would without it.
const ticked = async ($: EngineInterface): Promise<void> => {
  if ((await paneNow($))?.isPlaced === true) await refreshed($)
}

function following($: EngineInterface): void {
  run.timer ??= $.clock.every(EVERY_MS, () => void ticked($))
}

// Never `focus`: the prompt keeps the keyboard. The width is asked for as soon as the terminal's is known.
async function opened($: EngineInterface): Promise<void> {
  const columns = run.terminal === null ? null : shareOf(run.terminal, (await read($, model)).look.widthPercent)
  const placed = await $.ui.open({ id: PANE, title: TITLE, ...(columns === null ? {} : { columns }) })
  run.asked = columns
  following($)
  if (placed.isPlaced) return refreshed($)
  $.ui.toast(`Orbit Live opens beside this session once there is room: ${placed.reason}`)
}

// A close reaches the engine even while a tick's ask is still out: a beat that lands after it holds nothing again.
async function left($: EngineInterface, why: 'plugin' | 'person' | 'unload'): Promise<void> {
  run.timer?.cancel()
  run.spin?.cancel()
  Object.assign(run, { timer: null, spin: null, asked: null })
  if (why !== 'unload') await answered($, ['--left=person'])
}

const opening = async ($: EngineInterface, name: string | undefined): Promise<void> => {
  if (ENTRY.test(name ?? '') && !(await isOpen($)) && (await opensHere($))) await opened($)
}

// ---- drawing --------------------------------------------------------------------------------------------------

type Look = { color?: string; dimColor?: boolean; weight?: 'bold'; inverse?: boolean }

// Each tone in the person's theme (0.0.1, ADR 0027: the brand's tones in 'claude', a pill's in its state's colour).
const LOOKS: Readonly<Record<string, Look>> = {
  success: { color: 'success' },
  danger: { color: 'error' },
  warning: { color: 'warning' },
  info: { color: 'suggestion' },
  brand: { color: 'claude', weight: 'bold' },
  subtle: { dimColor: true },
  label: { weight: 'bold' },
  match: { inverse: true },
  title: { color: 'claude', weight: 'bold' },
  chip: { color: 'claude', weight: 'bold' },
  key: { color: 'claude' },
  selected: { inverse: true },
  track: { dimColor: true },
  'pill:success': { color: 'success', weight: 'bold' },
  'pill:danger': { color: 'error', weight: 'bold' },
  'pill:warning': { color: 'warning', weight: 'bold' },
  'pill:info': { color: 'suggestion', weight: 'bold' },
  'pill:subtle': { dimColor: true },
}

export const lookOf = (tone: string | null): Look => (tone === null ? {} : LOOKS[tone] ?? {})

// The room the engine lays the picture out for: docked, the whole column; above the prompt, a short block.
function measured(columns: number, rows: number, docked: boolean): void {
  run.columns = Math.max(20, columns)
  run.rows = Math.max(10, docked ? rows : Math.min(rows, INLINE_ROWS))
}

// How many rows each block may have, by the pane's tier: what the work went through and what it does now first, the
// view a person picked takes what is left. Wide puts the two blocks side by side.
export function budgetOf(m: PaneModel, rows: number): { checklist: number; current: number; view: number } {
  const room = Math.max(0, rows - 4 - (m.headerParts ? HEADER_EXTRA : 0) - (m.hints.inline ? 1 : 0) - (m.progress ?? []).length - cardEdges(m.checklist))
  const tier = m.tier ?? 'medium'
  if (tier === 'tiny' || tier === 'narrow') return { checklist: 0, current: tier === 'tiny' ? 0 : Math.max(0, room - TITLES), view: 0 }
  const top = Math.min(Math.max(m.checklist.length, m.current.length), Math.floor(room * 0.62))
  if (tier === 'wide') return { checklist: top, current: top, view: Math.max(0, room - top - TITLES - 1) }
  const checklist = Math.min(m.checklist.length, Math.floor(room * 0.6))
  const current = Math.min(m.current.length, Math.floor(room * 0.15))
  return { checklist, current, view: Math.max(0, room - checklist - current - TITLES - 1) }
}

// 0.0.2 (ADR 0028): the header's badge is drawn in a border, two rows taller than a line, and a rule closes the header;
// TASK EXECUTION and NOW are a title row and a rule over the blocks; a card adds its two edges.
const HEADER_EXTRA = 3
const TITLES = 2

export const cardEdges = (rows: PaneRow[]): number => rows.filter((r, i) => r.box && rows[i - 1]?.box !== r.box).length * 2

// Rows in their cards: consecutive rows of one card are one group, every other row stands alone.
export function carded(rows: PaneRow[]): Array<{ box: string | null; rows: PaneRow[] }> {
  const out: Array<{ box: string | null; rows: PaneRow[] }> = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (r.box && last?.box === r.box) last.rows.push(r)
    else out.push({ box: r.box ?? null, rows: [r] })
  }
  return out
}

// The status bar's parts, its separators taken out: the pane spreads them across the width with a dot between each.
export const barParts = (r: PaneRow): PaneSegment[] => [...r.left.filter((s) => s.text.trim() !== '·'), ...r.right]

// 0.0.2: whatever a row says on its right keeps the right edge -- a check's status word, a step's detail, a bar -- and
// its left flows and is cut at the end.
const fixedOf = (r: PaneRow): PaneSegment[] => r.right

const flowingOf = (r: PaneRow): PaneSegment[] => r.left

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'orbit-live', description: 'Show or hide Orbit Live beside this session' })
    if (await isOpen($)) following($)
    return next(e)
  })

  // Three doors to one pane, each failing open: whatever goes wrong here, the prompt, the skill and the call go on.
  on('prompt.submit', async ($, e, next) => {
    await opening($, e.command?.name)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    await opening($, e.skill)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Where an organization manages Claude Code, an installed plugin's skill.prompt hooks do not run: the model's
  // Skill call is the door that remains.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    await opening($, e.skill)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'orbit-live' }, async ($, e) => {
    run.terminal = e.presentation.columns
    if (await isOpen($)) {
      await $.ui.close({ id: PANE })
      return { text: 'Orbit Live closed; the task goes on. /orbit, /orbit-help or /orbit-live opens it again.' }
    }
    await opened($)
    return { text: 'Orbit Live opened beside this session.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await left($, e.origin.kind)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const docked = e.props.placement === 'dock'
    measured(e.props.bodyColumns, e.props.scroll.bodyRows, docked)
    // Docked, the viewport is the transcript's, not the terminal's: the terminal is the transcript, the pane and its frame.
    run.terminal = e.viewport ? e.viewport.columns + (docked ? e.props.bodyColumns + 3 : 0) : run.terminal
    const m = await read($, model)
    const picked = await read($, view)
    const frame = await read($, spin)
    const header = withOrbit(m.header, m.orbit, frame)
    const b = budgetOf(m, run.rows)
    const line = (segs: PaneSegment[], key: string) => (
      <Text key={key} wrap="truncate-end">
        {segs.map((s, i) => (
          <Text key={`${key}.${i}`} {...lookOf(s.tone)}>
            {s.text}
          </Text>
        ))}
      </Text>
    )
    // A row: its left flows and is cut, its right keeps the right edge.
    const rowEl = (r: PaneRow, key: string) => (
      <Box key={key} flexDirection="row">
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          {line(flowingOf(r), `${key}.f`)}
        </Box>
        {fixedOf(r).length ? <Box flexShrink={0} marginLeft={1}>{line(fixedOf(r), `${key}.s`)}</Box> : null}
      </Box>
    )
    // Rows in their cards: a card's rows inside a round border, the others as they are.
    const rowsEl = (rows: PaneRow[], key: string) =>
      carded(rows).map((g, i) =>
        g.box ? (
          <Box key={`${key}.c${i}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} flexShrink={0}>
            {g.rows.map((r, j) => rowEl({ ...r, left: r.left.map((s, k) => (k === 0 && /^ *$/.test(s.text) ? { ...s, text: '  '.repeat(Math.max(0, r.depth - g.rows[0].depth)) } : s)) }, `${key}.c${i}.${j}`))}
          </Box>
        ) : (
          rowEl(g.rows[0], `${key}.r${i}`)
        ),
      )
    const parts: PaneHeader | null = m.headerParts ? { left: withOrbit(m.headerParts.left, m.orbit, frame), badge: withOrbit(m.headerParts.badge, m.orbit, frame), right: m.headerParts.right } : null
    // The header (0.0.2, ADR 0028): where the viewer stands on the left; the badge in a border and the task on the right.
    const headerEl = parts ? (
      <Box key="header" flexDirection="row" justifyContent="space-between" alignItems="center" flexShrink={0}>
        <Box flexShrink={1} overflow="hidden">
          {line(parts.left, 'h.l')}
        </Box>
        <Box flexDirection="row" alignItems="center" flexShrink={0}>
          <Box borderStyle="round" borderColor="claude" borderDimColor paddingX={1}>
            {line(parts.badge, 'h.b')}
          </Box>
          <Box marginLeft={1}>{line(parts.right, 'h.r')}</Box>
        </Box>
      </Box>
    ) : (
      line(header, 'header')
    )
    const shown: PaneView | undefined = m.views.find((v) => v.id === picked) ?? m.views[0]
    // The tabs under the header: each view's key over its label, the picked one bright, and what it shows on the right.
    const tabsEl = m.views.length ? (
      <Box key="tabbar" flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <Box key="tabs" flexDirection="row" gap={TAB_GAP}>
          {m.views.map((v, i) => (
            <Button key={`tab.${v.id}`} label={v.label} hotkey={String(i + 1)} plain {...(v.id === shown?.id ? { variant: 'primary' as const } : { dimColor: true })} onPress={() => void update($, view, () => v.id)} />
          ))}
        </Box>
        {shown?.hint ? (
          <Box flexShrink={1} marginLeft={2} overflow="hidden">
            <Text dimColor wrap="truncate-end">
              {shown.hint}
            </Text>
          </Box>
        ) : null}
      </Box>
    ) : null
    const rule = (key: string) => (
      <Text key={key} dimColor wrap="truncate-end">
        {'─'.repeat(run.columns)}
      </Text>
    )
    // TASK EXECUTION on the left, NOW on the right; under them the checklist, and NOW beside it (wide) or below it.
    const titleEl = (
      <Box key="titles" flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <Text {...lookOf('title')}>{b.checklist > 0 ? m.titles.checklist : ''}</Text>
        <Text color="success" bold>
          {m.titles.current}
        </Text>
      </Box>
    )
    const block = (rows: PaneRow[], room: number, key: string) =>
      room > 0 ? (
        <Box key={key} flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
          {key === 'checklist' ? rowsEl(rows.slice(0, room), key) : rows.slice(0, room).map((r, i) => rowEl(r, `${key}.${i}`))}
        </Box>
      ) : null
    const bar = m.statusBar ? barParts(m.statusBar) : []
    // The status bar spread across the width, a dot between each part, the indicator on the right edge.
    const statusEl = m.statusBar ? (
      <Box key="status" flexDirection="row" justifyContent="space-between">
        {bar.flatMap((s, i) => [...(i ? [<Text key={`status.d${i}`} dimColor>·</Text>] : []), <Text key={`status.${i}`} {...lookOf(s.tone)}>{s.text}</Text>])}
      </Box>
    ) : (
      line(m.now[0] ?? [], 'status')
    )
    return (
      <Box flexDirection="column" {...(docked ? { height: e.props.scroll.bodyRows } : {})}>
        {headerEl}
        {parts ? rule('rule.header') : null}
        {!docked && m.hints.inline ? line([{ text: `⚠ ${m.hints.inline}`, tone: 'warning' }], 'hint') : null}
        {tabsEl}
        {b.checklist > 0 || b.current > 0 ? titleEl : null}
        {b.checklist > 0 || b.current > 0 ? rule('rule.top') : null}
        <Box flexDirection={m.tier === 'wide' ? 'row' : 'column'} flexShrink={0}>
          {block(m.checklist, b.checklist, 'checklist')}
          {m.tier === 'wide' && b.checklist > 0 ? <Box width={2} /> : null}
          {block(m.current, b.current, 'current')}
        </Box>
        {b.view > 0 && shown ? (
          <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
            {rule('rule.view')}
            {(shown.rows ?? []).slice(0, b.view).map((r, i) => rowEl(r, `view.${i}`))}
          </Box>
        ) : (
          <Box flexGrow={1} />
        )}
        {(m.progress ?? []).map((r, i) => rowEl(r, `progress.${i}`))}
        {rule('rule.status')}
        {statusEl}
      </Box>
    )
  })
}
