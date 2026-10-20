import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

// The pane against the engine's own `$`: what /orbit-help opens, what the Orbit engine is asked, what is drawn from its
// answer (the TASK EXECUTION checklist, NOW, the views a person switches between, the status bar), the width it asks
// for, and what a close tells it. Beneath the plugin, these hooks stand for the machine: `node cli/live.mjs pane`'s
// answers and the session's panes.
//
// Named .test.tsx, never .test.ts: Node 22.18 and later run every **/*.test.ts under a bare `node --test`, which is
// the engine's own suite, and this file is `claude plugin test`'s alone.

const PANE = 'orbit-live'

const r = (left: string, right: string[] = [], depth = 0, status: string | null = null, label: string | null = null) => ({ left: [{ text: left, tone: null }], right: right.map((t) => ({ text: t, tone: null })), depth, status, label })

const answer = (tier = 'medium') => ({
  version: 2,
  lease: 'k1.o1',
  held: true,
  task: 'tsk-1',
  header: [{ text: ' ORBIT LIVE ', tone: 'brand' }, { text: '  tsk-1 · verifying', tone: 'info' }],
  overview: [[{ text: 'STAGE', tone: 'label' }]],
  now: [[{ text: '▶ npm test', tone: 'info' }]],
  tier,
  titles: { checklist: 'TASK EXECUTION', current: 'NOW' },
  checklist: [r('✓ Plan', ['3 check(s) required'], 0, 'PASSED'), r('● Verify', [], 0, 'RUNNING'), r('    ● node:web · test test passes', ['RUNNING', '24 passed · 2 failed'], 1, 'RUNNING')],
  current: [r('task      tsk-1 · refund totals', [], 0, null, 'task'), r('observed  24 passed · 2 failed', [], 0, null, 'observed'), r('status    ● RUNNING', [], 0, null, 'status')],
  statusBar: r('STEPS 1/2  ·  CHECKS 0/3  ·  TESTS 24/26?', ['● ORBITING'], 0, null, null),
  views: [
    { id: 'events', label: 'Events', rows: [r('✓  05:59:02  Build succeeded')] },
    { id: 'tests', label: 'Tests', rows: [r('✗ a discount rounds half a cent up — assertion')] },
    { id: 'changes', label: 'Changes', rows: [r('M web/src/pricing.js', ['+1 −1'])] },
    { id: 'notices', label: 'Notices', rows: [r('[05:58:10] ✗ TEST failed')] },
  ],
  look: { widthPercent: 36, focusCli: true },
  hints: { inline: 'docks on the right in fullscreen; here it sits above the prompt' },
})

// What 1.8.6's engine answers: the same picture, version 2, with task and test progress and the Plan and Timeline views.
const answerV2 = (tier = 'medium') => ({
  ...answer(tier),
  version: 2,
  statusBar: r('STEPS 1/5  ·  EXECUTING', ['◑ ORBITING'], 0, null, null),
  progress: { task: { basis: 'plan', done: 1, total: 5, percent: 20 }, tests: null, rows: [r('TASK   ▓▓▓░░░░░░░░░░░░░ 1/5 steps · 20% · 1 reported'), r('TESTS  12 passed · 1 failed · 3 pending of 16')] },
  views: [...answer(tier).views, { id: 'plan', label: 'Plan', rows: [r('plan-2 (playbook) · 5 step(s) · revised 1×'), r('↻ plan-2 CAPABILITY_MISSING → insert-generation at playbook')] }, { id: 'timeline', label: 'Timeline', rows: [r('05:59:03 observed  adds', ['failed']), r('           expected 2  actual 1')] }],
  indicator: { state: 'ACTIVE', word: 'ORBITING', glyph: '◑', tone: 'success', pulse: 2 },
})

// What 0.0.3's engine answers (ADR 0029): the header opens with its orbit, parked, and the badge holds a smaller one;
// `orbit` gives a ring for each -- every frame as segments -- whether they turn (in every state, unless the animation is
// off) and how long one revolution takes. Twelve frames and six over 1200 ms: one every 100 ms, one every 200.
const FRAMES = ['⠊⠶⠀⠀⠀', '⠈⠷⠀⠀⠀', '⠀⠿⠀⠀⠀', '⠀⠾⠁⠀⠀', '⠀⠶⠑⠀⠀', '⠀⠶⠰⠀⠀', '⠀⠶⡠⠀⠀', '⠀⢶⡀⠀⠀', '⠀⣶⠀⠀⠀', '⢀⡶⠀⠀⠀', '⢄⠶⠀⠀⠀', '⠆⠶⠀⠀⠀']
const PARKED = '⠀⠀⠾⠀⠀'
const BADGE = ['⢎⠾⡱', '⢎⠶⠁', '⢎⠶⠐', '⢎⠶⡀', '⢎⢶⡱', '⢀⠶⡱']
const BADGE_PARKED = '⠀⠾⠀'
const REV_MS = 1200
const ringOf = (size: string, parked: string, frames: string[]) => ({ size, parked, frames: frames.map((f) => [{ text: f, tone: 'orbit:planet' }]) })
const withOrbitAnswer = (a: ReturnType<typeof answer>, moving: boolean) => ({
  ...a,
  header: [{ text: PARKED, tone: 'brand' }, { text: ' ', tone: null }, ...a.header],
  orbit: { moving, revMs: REV_MS, variant: 'bright', rings: [ringOf('compact', PARKED, FRAMES), ringOf('mini', BADGE_PARKED, BADGE)] },
})

// What 0.0.2's engine adds (ADR 0028): the header in its parts, the baseline's runs in a card, each view's hint.
const answer002 = () => ({
  ...answerV2('medium'),
  headerParts: { left: [{ text: PARKED, tone: 'brand' }, { text: ' ORBIT LIVE ', tone: 'chip' }, { text: 'my-app → main', tone: 'subtle' }], badge: [{ text: BADGE_PARKED, tone: 'brand' }, { text: ' ● ', tone: 'pill:success' }, { text: 'ORBITING ', tone: 'chip' }], right: [{ text: 'workflow', tone: 'subtle' }, { text: ' · ', tone: 'subtle' }, { text: '2m47s', tone: 'subtle' }] },
  checklist: [r('✓ Engineering', [], 0, 'PASSED'), { ...r('  ▶ Baseline (before the change)', ['status'], 1, 'PASSED'), box: 'baseline' }, { ...r('    ✗ test dotnet:ledger.tests', ['FAILED'], 2, 'FAILED'), box: 'baseline' }, r('  ✓ Verify', [], 1, 'PASSED')],
  statusBar: r('STEPS 4/6  ·  CHECKS 3/3  ·  TESTS 30/30  ·  COMPLETED', ['BLOCKED'], 0, null, null),
  views: answerV2('medium').views.map((v) => (v.id === 'events' ? { ...v, hint: 'newest on top · milestones · every line · scroll' } : v)),
})

type Asked = { argv: readonly string[]; stdin: string | undefined }
type Machine = { opens?: boolean; placed?: boolean; tier?: string; broken?: boolean; v2?: boolean; v002?: boolean; version?: number; orbit?: { moving: boolean }; oldOrbit?: boolean }
type World = { asked: Asked[]; opened: number; open: boolean; columns: (number | undefined)[]; clock: MockClock; shown: () => Asked[] }

function machine(on: On, m: Machine = {}): World {
  const w: World = { asked: [], opened: 0, open: false, columns: [], clock: mock.clock(on), shown: () => w.asked.filter((a) => !a.argv.includes('--auto')) }
  const placed = m.placed ?? true
  mock.env(on, { HOME: '/home/someone' })
  on('session.id', () => ({ value: 'session-1' }))
  on('session.root', () => ({ value: '/work/checkout' }))
  on('session.cwd', () => ({ value: '/home/someone/.orbit/projects/x' }))
  on('process.run', (_$, e) => {
    w.asked.push({ argv: e.argv, stdin: e.init?.stdin })
    const auto = { version: 2, opens: m.opens ?? true, why: m.opens === false ? 'opening it by itself is switched off' : null }
    const base = m.v002 ? answer002() : m.v2 ? answerV2(m.tier) : m.version ? { ...answer(m.tier), version: m.version } : answer(m.tier)
    const turning = m.orbit ? withOrbitAnswer(base, m.orbit.moving) : base
    // 0.0.1's orbit, as an older engine answered it: frames of text, a phase from the newest evidence.
    const picture = m.oldOrbit ? { ...turning, orbit: { moving: true, tone: 'brand', frames: FRAMES, parked: PARKED, lastAt: null, kickMs: 3000, fps: { kick: 10, cruise: 4 } } } : turning
    const said = m.broken ? 'not json' : JSON.stringify(e.argv.includes('--auto') ? auto : picture)
    return { value: { exitCode: m.broken ? 1 : 0, stdout: `${said}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', (_$, e) => {
    Object.assign(w, { opened: w.opened + 1, open: true })
    w.columns.push(e.columns)
    return { value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'unasked panes wait below 144 columns; the terminal has 100' } }
  })
  on('ui.panes', () => ({ value: w.open ? [{ id: PANE, title: 'Orbit Live', isShown: placed, isFocused: false, isPlaced: placed }] : [] }))
  on('ui.close', () => {
    w.open = false
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  return w
}

const TYPED = { wait: false, origin: { kind: 'composer' } } as const

const TOGGLE = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const DOCKED = { title: 'Orbit Live', isFocused: false, bodyColumns: 58, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

const INLINE = { ...DOCKED, placement: 'inline', bodyColumns: 150, scroll: { offset: 0, bodyRows: 16 } } as const

const help = { text: '/orbit-help', command: { name: 'orbit-help', args: '' }, ...TYPED }

describe('Orbit Live pane', () => {
  test('a typed /orbit-help asks whether Live opens by itself, opens the pane, and asks the engine for this session -- its project root, never the shell directory a host cd-ed into', async ($, on) => {
    const w = machine(on)
    await $.prompt.submit({ text: '/orbit-help', command: { name: 'orbit:orbit-help', args: '' }, ...TYPED })
    expect(w.opened).toBe(1)
    expect(w.asked[0]?.argv).toContain('--auto')
    expect(w.shown()).toHaveLength(1)
    expect(w.shown()[0]?.argv.slice(2, 4)).toEqual(['pane', '--host=claude'])
    expect(JSON.parse(w.shown()[0]?.stdin ?? '{}')).toEqual({ session_id: 'session-1', cwd: '/work/checkout' })
  })

  test('a typed /orbit opens it as /orbit-help does, and so does the model running the orbit skill -- once', async ($, on) => {
    const w = machine(on)
    await $.prompt.submit({ text: '/orbit fix the refunds', command: { name: 'orbit:orbit', args: 'fix the refunds' }, ...TYPED })
    expect(w.opened).toBe(1)
    await $.skill.prompt({ skill: 'orbit:orbit', text: 'goal' })
    expect(w.opened).toBe(1)
  })

  test('another orbit-* skill opens nothing: only orbit and orbit-help are named', async ($, on) => {
    const w = machine(on)
    await $.skill.prompt({ skill: 'orbit:orbit-ui-test', text: 'x' })
    await $.skill.prompt({ skill: 'orbit:orbit-engineer', text: 'x' })
    expect(w.opened).toBe(0)
  })

  test('the orbits turn on the pane’s own clock in every state the engine answers -- a blocked task’s too -- the header’s and the badge’s at one angle', async ($, on) => {
    const w = machine(on, { v002: true, orbit: { moving: true } })
    await $.prompt.submit(help)
    const ui = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: DOCKED })
    expect(await ui.find({ type: 'Text', text: /^BLOCKED$/ })).toBeDefined()
    await w.clock.advance(300 - w.clock.now())
    expect(await ui.find({ type: 'Text', text: FRAMES[3] })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: BADGE[1] })).toBeDefined()
    await w.clock.advance(300)
    expect(await ui.find({ type: 'Text', text: FRAMES[6] })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: BADGE[3] })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: FRAMES[3] })).toBeUndefined()
    await w.clock.advance(REV_MS)
    expect(await ui.find({ type: 'Text', text: FRAMES[6] })).toBeDefined()
  })

  test('with the animation off the orbits are the engine’s own parked frames, and no clock moves them', async ($, on) => {
    const w = machine(on, { v002: true, orbit: { moving: false } })
    await $.prompt.submit(help)
    const ui = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: DOCKED })
    await w.clock.advance(5000)
    expect(await ui.find({ type: 'Text', text: PARKED })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: BADGE_PARKED })).toBeDefined()
    expect((await ui.findAll({ type: 'Text' })).some((t) => [...FRAMES, ...BADGE].includes(String(t.props.children ?? '')))).toBe(false)
  })

  test('an answer whose orbit this pane does not know -- the one an older engine drew -- is drawn as said, parked', async ($, on) => {
    const w = machine(on, { v002: true, orbit: { moving: true }, oldOrbit: true })
    await $.prompt.submit(help)
    const ui = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: DOCKED })
    await w.clock.advance(2000)
    expect(await ui.find({ type: 'Text', text: PARKED })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ORBITING/ })).toBeDefined()
  })

  test('closing the pane stops the orbits’ clock with it: nothing turns, nothing is asked', async ($, on) => {
    const w = machine(on, { v002: true, orbit: { moving: true } })
    await $.prompt.submit(help)
    await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: DOCKED })
    await w.clock.advance(300)
    await $.command.run({ command: 'orbit-live', ...TOGGLE })
    expect(w.open).toBe(false)
    const asked = w.shown().length
    await w.clock.advance(5000)
    expect(w.shown().length).toBe(asked)
  })

  test('the model running the orbit-help skill opens it too, once', async ($, on) => {
    const w = machine(on)
    await $.skill.prompt({ skill: 'orbit:orbit-help', text: 'help' })
    await $.skill.prompt({ skill: 'orbit-help', text: 'help' })
    expect(w.opened).toBe(1)
  })

  test('the model’s Skill call for orbit-help opens it, the door left where skill.prompt hooks do not run', async ($, on) => {
    const w = machine(on)
    on('tool.call', () => ({ result: { success: true, commandName: 'orbit-help' }, text: 'ran' }))
    await $.tool.call({ tool: 'Skill', skill: 'orbit:orbit-help', tool_use_id: 'toolu_1' })
    await $.tool.call({ tool: 'Skill', skill: 'commit', tool_use_id: 'toolu_2' })
    expect(w.opened).toBe(1)
  })

  test('another skill or command opens nothing and asks nothing', async ($, on) => {
    const w = machine(on)
    await $.skill.prompt({ skill: 'orbit:orbit-help-more', text: 'x' })
    await $.prompt.submit({ text: '/commit', command: { name: 'commit', args: '' }, ...TYPED })
    expect(w.opened).toBe(0)
    expect(w.asked).toHaveLength(0)
  })

  test('a person who switched off opening Live by itself: /orbit-help opens nothing, /orbit-live still does', async ($, on) => {
    const w = machine(on, { opens: false })
    await $.prompt.submit(help)
    expect(w.opened).toBe(0)
    expect(w.shown()).toHaveLength(0)
    expect((await $.command.run({ command: 'orbit-live', ...TOGGLE })).text).toMatch(/opened/)
    expect(w.opened).toBe(1)
  })

  test('the pane draws the workspace: TASK EXECUTION, NOW, the views and the status bar, on every surface', async ($, on) => {
    machine(on)
    await $.prompt.submit(help)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'orbit', surface, component: 'Pane', requestId: PANE, props: DOCKED })
      expect(await ui.find({ type: 'Text', text: /TASK EXECUTION/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /node:web · test test passes/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^NOW$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /24 passed · 2 failed/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /STEPS 1\/2/ })).toBeDefined()
      expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
      expect(await ui.find({ type: 'Text', text: /Build succeeded/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a tab switches the view a person reads: Tests shows the failing case, Changes the files', async ($, on) => {
    machine(on)
    await $.prompt.submit(help)
    const ui = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: DOCKED })
    expect(await ui.find({ type: 'Text', text: /a discount rounds half a cent up/ })).toBeUndefined()
    await ui.press({ key: 'tab.tests' })
    expect(await ui.find({ type: 'Text', text: /a discount rounds half a cent up/ })).toBeDefined()
    await ui.press({ key: 'tab.changes' })
    expect(await ui.find({ type: 'Text', text: /web\/src\/pricing\.js/ })).toBeDefined()
  })

  test('the tabs stand apart: a terminal draws a row of Buttons as written, so the row carries a gap', async ($, on) => {
    machine(on)
    await $.prompt.submit(help)
    const ui = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: DOCKED })
    expect((await ui.find({ key: 'tabs' }))?.props.gap).toBeGreaterThan(0)
  })

  test('narrow keeps NOW and the status bar, never the checklist', async ($, on) => {
    machine(on, { tier: 'narrow' })
    await $.prompt.submit(help)
    const ui = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: DOCKED })
    expect(await ui.find({ type: 'Text', text: /TASK EXECUTION/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^NOW$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /STEPS 1\/2/ })).toBeDefined()
  })

  test('wide puts TASK EXECUTION and NOW side by side', async ($, on) => {
    machine(on, { tier: 'wide' })
    await $.prompt.submit(help)
    const ui = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...DOCKED, bodyColumns: 96 } })
    expect(await ui.find({ type: 'Text', text: /TASK EXECUTION/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^NOW$/ })).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).toContain('"flexDirection":"row"')
  })

  test('above the prompt the pane says where it would dock; docked it says nothing of it', async ($, on) => {
    machine(on)
    await $.prompt.submit(help)
    const inline = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: INLINE })
    expect(await inline.find({ type: 'Text', text: /docks on the right in fullscreen/ })).toBeDefined()
    await inline.unmount()
    const docked = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: DOCKED })
    expect(await docked.find({ type: 'Text', text: /docks on the right in fullscreen/ })).toBeUndefined()
  })

  test('it asks for the share of the width a person set, once the terminal’s width is known', async ($, on) => {
    const w = machine(on)
    await $.command.run({ command: 'orbit-live', ...TOGGLE })
    expect(w.columns.at(-1)).toBe(58)
    expect(w.opened).toBe(1)
  })

  test('docked, the share is of the whole terminal -- the transcript, the pane and its frame -- never of the transcript alone', async ($, on) => {
    const w = machine(on)
    await $.prompt.submit(help)
    const ui = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: DOCKED, viewport: { columns: 128, rows: 40, isFullscreen: true } })
    await ui.unmount()
    await w.clock.advance(2000)
    expect(w.columns.at(-1)).toBe(68)
  })

  test('every tick of a drawn pane asks again, with the lease the engine gave and the room the pane was drawn in', async ($, on) => {
    const w = machine(on)
    await $.prompt.submit(help)
    const ui = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: DOCKED })
    await ui.unmount()
    await w.clock.advance(2000)
    const last = w.shown().at(-1)?.argv ?? []
    expect(last).toContain('--lease=k1.o1')
    expect(last).toContain('--columns=58')
    expect(last).toContain('--rows=40')
  })

  test('a pane that waits undrawn asks nothing, so it holds no lease', async ($, on) => {
    const w = machine(on, { placed: false })
    await $.skill.prompt({ skill: 'orbit:orbit-help', text: 'help' })
    await w.clock.advance(6000)
    expect(w.opened).toBe(1)
    expect(w.shown()).toHaveLength(0)
  })

  test('/orbit-live closes an open pane and tells the engine, with the lease; the task is not touched; again, opens it', async ($, on) => {
    const w = machine(on)
    await $.prompt.submit(help)
    expect((await $.command.run({ command: 'orbit-live', ...TOGGLE })).text).toMatch(/closed; the task goes on/)
    expect(w.open).toBe(false)
    const last = w.shown().at(-1)?.argv ?? []
    expect(last).toContain('--left=person')
    expect(last).toContain('--lease=k1.o1')
    expect(w.asked.every((a) => a.argv[2] === 'pane')).toBe(true)
    await w.clock.advance(6000)
    expect(w.shown().filter((a) => !a.argv.includes('--left=person'))).toHaveLength(1)
    expect((await $.command.run({ command: 'orbit-live', ...TOGGLE })).text).toMatch(/opened/)
  })

  test('a 1.8.6 answer: task and test progress above the status bar, six views, and the ORBITING indicator the engine drew', async ($, on) => {
    machine(on, { v2: true })
    await $.prompt.submit(help)
    const ui = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: DOCKED })
    expect(await ui.find({ type: 'Text', text: /1\/5 steps · 20%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /12 passed · 1 failed · 3 pending of 16/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◑ ORBITING/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(6)
    await ui.press({ key: 'tab.plan' })
    expect(await ui.find({ type: 'Text', text: /CAPABILITY_MISSING/ })).toBeDefined()
    await ui.press({ key: 'tab.timeline' })
    expect(await ui.find({ type: 'Text', text: /expected 2  actual 1/ })).toBeDefined()
  })

  test('a 0.0.2 answer: the badge in a round border on the right, the baseline in a card, the hint beside the tabs, the status bar spread', async ($, on) => {
    machine(on, { v002: true })
    await $.prompt.submit(help)
    const ui = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: DOCKED })
    const header = await ui.find({ key: 'header' })
    expect(header?.props.justifyContent).toBe('space-between')
    const borders = (await ui.findAll({ type: 'Box' })).filter((b) => b.props.borderStyle === 'round')
    expect(borders.length).toBe(2)
    expect(await ui.find({ type: 'Text', text: /ORBITING/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /workflow/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Baseline \(before the change\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /newest on top · milestones · every line · scroll/ })).toBeDefined()
    expect((await ui.find({ key: 'status' }))?.props.justifyContent).toBe('space-between')
    expect(await ui.find({ type: 'Text', text: /^BLOCKED$/ })).toBeDefined()
  })

  test('an answer of a version this pane does not know is not drawn as if it were one it does', async ($, on) => {
    machine(on, { version: 3 })
    await $.prompt.submit(help)
    const ui = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: DOCKED })
    expect(await ui.find({ type: 'Text', text: /did not answer/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /TASK EXECUTION/ })).toBeUndefined()
  })

  test('an engine that answers nothing usable: the pane says so and the prompt goes on', async ($, on) => {
    machine(on, { broken: true })
    const got = await $.prompt.submit({ text: 'keep working', ...TYPED })
    expect(got).toMatchObject({ text: 'keep working' })
    expect((await $.command.run({ command: 'orbit-live', ...TOGGLE })).text).toMatch(/opened/)
    const ui = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: PANE, props: DOCKED })
    expect(await ui.find({ type: 'Text', text: /did not answer/ })).toBeDefined()
  })
})
