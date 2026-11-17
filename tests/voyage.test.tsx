import type { PromptEditInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { POEMS } from '../hooks/poems'
import { columns, quietAt, scene, squadName } from '../hooks/scene'
import { voyageOf } from '../hooks/voyage'

const VOYAGE = voyageOf({ from: '2025-09-01', to: '2027-06-30', dest: '抵达', ports: [{ date: '2026-03-01', name: '中途' }, { date: '2027-03-01', name: '远港' }] }, 0)
import type { Squad, View } from '../types'

const BACKDROP = {
  plugin: 'star-voyage',
  component: 'Backdrop',
  surface: 'desktop',
  props: { scene: 'voyage', plugin: 'star-voyage', glass: { blur: 0, opacity: 0.2 } },
} as const

const NOW = Date.UTC(2026, 10, 14)

test('the ship charts a course, jumps, comes back and lies up in harbour', async ($, on) => {
  // Nothing sits beneath the plugin: each hook here stands for the engine.
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { coolMinutes: 5 })
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
  on('command.register', () => ({ value: { command: 'voyage' } }))
  on('audio.play', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  const drawn = async (): Promise<string> => {
    const ui = await $.ui.mount(BACKDROP)
    const svg = await ui.find({ type: 'Svg' })
    await ui.unmount()

    return String(svg?.props.source)
  }

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // The chart, with the progress line a fresh cruise shows.
  expect(await drawn()).toContain('class="route"')
  expect(await drawn()).toContain('>航<')

  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(await drawn()).toContain('class="warp"')

  await $.turn.complete({ answer: 'done', durationMs: 900, isAborted: false, turnId: 't1', reason: 'answer' })
  const back = await drawn()
  expect(back).toContain('class="route"')
  expect(back).not.toContain('class="limb"')
  expect(back).toContain('>航<')

  // Once the words have had their time, the chart is drawn again without them.
  await clock.advance(30_000)
  expect(await drawn()).not.toContain('>航<')

  // Idle past the cooling time: into harbour, with no progress line.
  await clock.advance(6 * 60_000)
  const harbour = await drawn()
  expect(harbour).toContain('入港歇歇脚')
  expect(harbour).not.toContain('>航<')
})

test('left alone, the ship lies up once the cache has gone cold: an hour', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
  on('command.register', () => ({ value: { command: 'voyage' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  const drawn = async (): Promise<string> => {
    const ui = await $.ui.mount(BACKDROP)
    const svg = await ui.find({ type: 'Svg' })
    await ui.unmount()

    return String(svg?.props.source)
  }

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(55 * 60_000)
  expect(await drawn()).toContain('class="route"')
  await clock.advance(6 * 60_000)
  expect(await drawn()).toContain('入港歇歇脚')
})

test('a new conversation lies in harbour, and its first message lifts off from there', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
  on('command.register', () => ({ value: { command: 'voyage' } }))
  on('audio.play', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  // Nothing has been asked of this conversation yet.
  on('session.turns', () => ({ value: 0 }))

  const drawn = async (): Promise<string> => {
    const ui = await $.ui.mount(BACKDROP)
    const svg = await ui.find({ type: 'Svg' })
    await ui.unmount()

    return String(svg?.props.source)
  }

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const waiting = await drawn()
  expect(waiting).toContain('class="limb"')
  expect(waiting).toContain('入港歇歇脚')
  expect(waiting).not.toContain('class="route"')

  // The first message: the small world drops away under the ship, then the jump.
  await $.turn.start({ text: 'go', turnId: 't1' })
  const leaving = await drawn()
  expect(leaving).toContain('@keyframes lift')
  expect(leaving).toContain('class="limb"')
  expect(leaving).toContain('class="warp"')

  // Once it is away, only the jump is drawn.
  await clock.advance(5000)
  const away = await drawn()
  expect(away).not.toContain('class="limb"')
  expect(away).toContain('class="warp"')
})

for (const order of ['before', 'after'] as const) {
  test(`a conversation picked up cold is found in harbour (the engine says so ${order} the start)`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
    on('command.register', () => ({ value: { command: 'voyage' } }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('classic.SessionStart', () => ({}))
    // It has history: it is not a new conversation.
    on('session.turns', () => ({ value: 12 }))

    const drawn = async (): Promise<string> => {
      const ui = await $.ui.mount(BACKDROP)
      const svg = await ui.find({ type: 'Svg' })
      await ui.unmount()

      return String(svg?.props.source)
    }
    // Left alone for a month.
    const said = { source: 'resume', seconds_since_last_response: 30 * 86_400 } as const

    if (order === 'before') await $.classic.SessionStart(said)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    if (order === 'after') await $.classic.SessionStart(said)
    await clock.settle()

    const found = await drawn()
    expect(found).toContain('class="limb"')
    expect(found).toContain('入港歇歇脚')
  })
}

test('a conversation picked up while still warm is found on the chart', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
  on('command.register', () => ({ value: { command: 'voyage' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('session.turns', () => ({ value: 12 }))

  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 20 * 60 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(BACKDROP)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('class="route"')
  await ui.unmount()
})

test('a setting changed in another conversation is taken up here within moments', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // The store all conversations share, held where the test can write to it.
  const kept = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_, e) => {
    kept.set(e.key, e.value)

    return { value: undefined }
  })
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
  on('command.register', () => ({ value: { command: 'voyage' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(BACKDROP)
  const source = async (): Promise<string> => String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(await source()).toContain('animation')

  // Elsewhere, the person asks for a backdrop that does not move.
  kept.set('motion', 'still')
  kept.set('rev', NOW + 1)
  await clock.advance(11_000)
  expect(await source()).not.toMatch(/animation|keyframes/)

  // And here, for one that moves again: the others will hear of it the same way.
  await $.command.run({ command: 'voyage', args: 'motion low', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(await source()).toContain('animation')
  expect(kept.get('motion')).toBe('low')
  expect(Number(kept.get('rev'))).toBeGreaterThan(NOW + 1)
  await ui.unmount()
})

test('a calm backdrop is drawn once more, still, when its view has played out', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { motion: 'calm' })
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
  on('command.register', () => ({ value: { command: 'voyage' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.edit', (_, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(BACKDROP)
  const moves = async (): Promise<boolean> => /animation|keyframes/.test(String((await ui.find({ type: 'Svg' }))?.props.source))

  // The chart comes up with its progress line drifting: that plays.
  expect(await moves()).toBe(true)
  // Once the line has gone the chart is drawn still, with nobody asking.
  await clock.advance(20_000)
  expect(await moves()).toBe(false)

  // Typing closes in: it moves for the moment the camera takes, then holds.
  const prompt = $.prompt as unknown as { edit: (e: PromptEditInput) => Promise<unknown> }
  await prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'a' })
  await clock.advance(1200)
  expect(await moves()).toBe(true)
  await clock.advance(3000)
  expect(await moves()).toBe(false)
  await ui.unmount()
})

test('the lab holds one scene up, or sets the colours alone, for measuring', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const looks: { backdrop?: unknown }[] = []
  on('theme.set', (_, e) => {
    looks.push(e)

    return { value: { isDrawn: true, requestId: 'look' } }
  })
  on('command.register', () => ({ value: { command: 'voyage' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const run = async (args: string): Promise<void> => {
    await $.command.run({ command: 'voyage', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  }

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(BACKDROP)
  const source = async (): Promise<string> => String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(await source()).toContain('class="route"')

  // The harbour, though the conversation is out on the chart.
  await run('lab scene=dock')
  expect(await source()).toContain('class="limb"')
  expect(looks.at(-1)?.backdrop).toBeDefined()

  // The colours with no backdrop at all.
  await run('lab scene=dock colors')
  expect(looks.at(-1)?.backdrop).toBeUndefined()

  await run('lab off')
  expect(looks.at(-1)?.backdrop).toBeDefined()
  expect(await source()).toContain('class="route"')
  await ui.unmount()
})

test("a subagent's turn leaves the ship where it is", async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
  on('command.register', () => ({ value: { command: 'voyage' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'side quest', turnId: 't2', agentId: 'a1' })

  const ui = await $.ui.mount(BACKDROP)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain('class="warp"')
  await ui.unmount()
})

test('typing redraws once it pauses, and never for a key that changes nothing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // A scene that moves all the time is drawn again only when its view changes:
  // the redraws counted here are the camera's alone.
  mock.store(on, { coolMinutes: 5, motion: 'low' })
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
  on('command.register', () => ({ value: { command: 'voyage' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // The editor beneath the plugin: it applies the edit to the draft.
  on('prompt.edit', (_, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)

    return { text, cursor: e.start + e.inputText.length }
  })

  const draws = async (): Promise<number> => {
    const { text = '' } = await $.command.run({
      command: 'voyage',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })

    return Number(/背景重绘 (\d+) 次/.exec(text)?.[1])
  }
  const type = async (draft: string, letter: string): Promise<void> => {
    // The kit raises the event; its typings list no `edit` on `$.prompt` yet.
    const prompt = $.prompt as unknown as { edit: (e: PromptEditInput) => Promise<unknown> }
    await prompt.edit({ origin: { kind: 'composer' }, text: draft, cursor: draft.length, start: draft.length, end: draft.length, inputText: letter })
    await clock.settle()
  }

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // A mount that is held, as the app holds the backdrop: a write to the view
  // draws it again.
  const ui = await $.ui.mount(BACKDROP)
  const atStart = await draws()

  // Five keys in a burst: nothing is redrawn while they land.
  await type('', 'a')
  await type('a', 'b')
  await type('ab', 'c')
  await type('abc', 'd')
  await type('abcd', 'e')
  expect(await draws()).toBe(atStart)

  // The typing pauses: the camera closes in, once.
  await clock.advance(1500)
  const closedIn = await draws()
  expect(closedIn).toBeGreaterThan(atStart)

  // More keys within the same level, and a long wait: nothing to redraw.
  await type('abcde', 'f')
  await type('abcdef', 'g')
  await clock.advance(4000)
  expect(await draws()).toBe(closedIn)

  // Cold: one redraw into harbour, one more to clear its poem, then quiet.
  await clock.advance(6 * 60_000)
  const inHarbour = await draws()
  expect(inHarbour).toBeGreaterThan(closedIn)
  await clock.advance(3 * 60_000)
  expect(await draws()).toBe(inHarbour)
  await ui.unmount()
})

test('under way a poem goes up, and changes each minute only while someone is looking', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
  on('command.register', () => ({ value: { command: 'voyage' } }))
  on('audio.play', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  const verses = async (): Promise<number> => {
    const { text = '' } = await $.command.run({
      command: 'voyage',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })

    return Number(/途中换诗 (\d+) 次/.exec(text)?.[1])
  }

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // The jump begins with the conversation off screen: nothing asks for a
  // drawing, minutes pass, and no poem is written for nobody.
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(3 * 60_000)
  expect(await verses()).toBe(0)

  // The person comes back: the backdrop is drawn, and a poem follows at once.
  const ui = await $.ui.mount(BACKDROP)
  const source = async (): Promise<string> => String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(await source()).not.toContain('class="gl"')
  await clock.advance(1000)
  expect(await verses()).toBe(1)
  const first = await source()
  expect(first).toContain('class="gl"')
  expect(first).toContain('class="warp"')

  // While they look, a new one each minute, and only then.
  await clock.advance(30_000)
  expect(await verses()).toBe(1)
  await clock.advance(30_000)
  expect(await verses()).toBe(2)
  await clock.advance(60_000)
  expect(await verses()).toBe(3)
  expect(await source()).not.toBe(first)

  // They leave. The last poem was drawn, so one more is written; nothing
  // draws that one, and the poems stop there.
  await ui.unmount()
  await clock.advance(2 * 60_000)
  const left = await verses()
  expect(left).toBeLessThanOrEqual(4)
  await clock.advance(10 * 60_000)
  expect(await verses()).toBe(left)

  // The turn ends: the chart comes back with its own poem, and the minute stops.
  await $.turn.complete({ answer: 'done', durationMs: 900, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(5 * 60_000)
  expect(await verses()).toBe(left)
})

// ---- the fleet: sessions showing one another as squads

type On = Parameters<TestBody>[1]

const HOME = '/home/pilot'
const FLEET = `${HOME}/.claude/star-voyage/fleet`
const ME = 'aaaaaaaa-0000-4000-8000-000000000001'
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002'

/**
 * What stands beneath the plugin's file calls: the folder the sessions share,
 * held in memory. No test reads or writes the person's real one.
 */
function shared(on: On, clock: { now: () => number }) {
  const files = new Map<string, { text: string; mtimeMs: number }>()
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('session.id', () => ({ value: ME }))
  on('session.cwd', () => ({ value: '/work/atlas' }))
  on('fs.write', (_, e) => {
    files.set(e.path, { text: e.text, mtimeMs: clock.now() })

    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_, e) => ({ value: files.get(e.path)?.text ?? '' }))
  on('fs.list', (_, e) => ({
    value: [...files]
      .filter(([path]) => path.startsWith(`${e.path}/`))
      .map(([path, file]) => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: file.text.length, mtimeMs: file.mtimeMs, isLink: false })),
  }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  return {
    /** Another session writes its row. */
    put: (id: string, row: { name: string; status: string; at?: number; active?: number; warm?: number | null }): void => {
      const { warm = 60 * 60_000, ...rest } = row
      const whole = { id, born: NOW - 1000, at: clock.now(), active: clock.now(), ...rest, ...(warm === null ? {} : { warm }) }
      files.set(`${FLEET}/${id}.json`, { text: JSON.stringify(whole), mtimeMs: clock.now() })
    },
    /** This session's row, as the others would read it. */
    mine: (): { name?: string; status?: string; active?: number; warm?: number } =>
      JSON.parse(files.get(`${FLEET}/${ME}.json`)?.text ?? '{}') as { name?: string; status?: string; active?: number; warm?: number },
  }
}

test('a session tells the others how it stands, and shows them as squads', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { coolMinutes: 5 })
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
  on('command.register', () => ({ value: { command: 'voyage' } }))
  on('audio.play', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} }))
  on('classic.PostToolUse', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('classic.PermissionDenied', () => ({}))
  on('prompt.edit', (_, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  const fleet = shared(on, clock)
  // Rows are there already: one at work; one whose cache went cold long ago,
  // though it still renews its row; one that said goodbye; one written by a
  // version that knew no warmth.
  fleet.put(OTHER, { name: '星图校准', status: 'work' })
  fleet.put('cccccccc-0000-4000-8000-000000000003', { name: '早就凉了', status: 'dock', active: NOW - 3 * 3_600_000 })
  fleet.put('dddddddd-0000-4000-8000-000000000004', { name: '已经告别', status: 'gone' })
  fleet.put('ffffffff-0000-4000-8000-000000000006', { name: '旧版本的行', status: 'wait', warm: null })
  // One whose last turn died on an error hours ago and that still renews its
  // row: it called then, and is cold now like any other.
  fleet.put('99999999-0000-4000-8000-000000000009', { name: '出错后没人管', status: 'need', active: NOW - 2 * 3_600_000 })
  // And one not heard from for ten minutes, in the middle of a turn, whose
  // cache holds for an hour: still on show, as waiting.
  fleet.put('eeeeeeee-0000-4000-8000-000000000005', { name: '还热着的对话', status: 'work', at: NOW - 10 * 60_000, active: NOW - 10 * 60_000 })

  const drawn = async (): Promise<string> => {
    const ui = await $.ui.mount(BACKDROP)
    const svg = await ui.find({ type: 'Svg' })
    await ui.unmount()

    return String(svg?.props.source)
  }

  await $.session.start({ cwd: '/work/atlas', surface: 'desktop', isInteractive: true })
  await clock.settle()
  // Nothing has been asked of it yet: it is no squad, and writes no row. It
  // sees the others all the same.
  expect(fleet.mine()).toEqual({})
  const chart = await drawn()
  expect(chart).toContain('星图校准')
  expect(chart).toContain('探索中')
  expect(chart).not.toContain('早就凉了')
  expect(chart).not.toContain('已经告别')
  expect(chart).not.toContain('旧版本的行')
  expect(chart).not.toContain('出错后没人管')
  expect(chart).toContain('还热着的对话')
  expect(chart).toContain('待命')
  // A minute of standing open changes nothing.
  await clock.advance(60_000)
  expect(fleet.mine()).toEqual({})

  // Given something to do, it is out in the field. Untitled so far, it goes
  // by the folder it works in; its row says how long its cache holds.
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.settle()
  expect(fleet.mine()).toMatchObject({ name: 'atlas', status: 'work', warm: 60 * 60_000 })

  // A question put to the person holds the turn: the session is calling.
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
  await clock.settle()
  expect(fleet.mine().status).toBe('need')
  await $.classic.PostToolUse({ tool_name: 'AskUserQuestion', tool_input: {}, tool_response: {}, tool_use_id: 'q1' })
  await clock.settle()
  expect(fleet.mine().status).toBe('work')

  // A question the person turned away gets no answer, but the loop moves on:
  // its next call says so.
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
  await clock.settle()
  expect(fleet.mine().status).toBe('need')
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.settle()
  expect(fleet.mine().status).toBe('work')

  // A permission asked for, then refused: calling, then back at work.
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await clock.settle()
  expect(fleet.mine().status).toBe('need')
  await $.classic.PermissionDenied({ tool_name: 'Bash', tool_input: {}, tool_use_id: 'b1', reason: 'no' })
  await clock.settle()
  expect(fleet.mine().status).toBe('work')

  // A turn that dies on an error leaves the session stuck until someone looks.
  await $.turn.complete({ answer: '', durationMs: 900, isAborted: false, turnId: 't1', reason: 'error' })
  await clock.settle()
  expect(fleet.mine().status).toBe('need')

  await $.turn.start({ text: 'again', turnId: 't2' })
  await $.turn.complete({ answer: 'done', durationMs: 900, isAborted: false, turnId: 't2', reason: 'answer' })
  await clock.settle()
  expect(fleet.mine().status).toBe('wait')

  // Cold: laid up in harbour, and the others see it resting.
  await clock.advance(6 * 60_000)
  expect(fleet.mine().status).toBe('dock')
  // The other session has renewed nothing in all that time. Its cache is
  // still warm, so it is still on show, but no longer as at work.
  const later = await drawn()
  expect(later).toContain('星图校准')
  expect(later).not.toContain('探索中')

  // Typing for longer than the cooling time is not idling: no harbour.
  await $.turn.start({ text: 'back', turnId: 't3' })
  await $.turn.complete({ answer: 'done', durationMs: 900, isAborted: false, turnId: 't3', reason: 'answer' })
  for (let minute = 0; minute < 12; minute++) {
    const prompt = $.prompt as unknown as { edit: (e: PromptEditInput) => Promise<unknown> }
    await prompt.edit({ origin: { kind: 'composer' }, text: 'x'.repeat(40 + minute), cursor: 40 + minute, start: 40 + minute, end: 40 + minute, inputText: 'y' })
    await clock.advance(60_000)
  }
  expect(fleet.mine().status).toBe('wait')

  // An hour on, the silent ones have gone cold and are off the sky.
  await clock.advance(60 * 60_000)
  const cold = await drawn()
  expect(cold).not.toContain('星图校准')
  expect(cold).not.toContain('还热着的对话')
  expect(cold).not.toContain('远征小队')

  await $.session.end({ reason: 'other', sessionId: ME, resume: { id: ME } })
  expect(fleet.mine().status).toBe('gone')
})

test('the fleet draws the backdrop again only when what it shows of the others changes', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
  on('command.register', () => ({ value: { command: 'voyage' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const fleet = shared(on, clock)

  const draws = async (): Promise<number> => {
    const { text = '' } = await $.command.run({
      command: 'voyage',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })

    return Number(/背景重绘 (\d+) 次/.exec(text)?.[1])
  }

  await $.session.start({ cwd: '/work/atlas', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(BACKDROP)
  const source = async (): Promise<string> => String((await ui.find({ type: 'Svg' }))?.props.source)
  // The first view's progress line drifts off and the chart is drawn clean.
  await clock.advance(40_000)
  const quiet = await draws()
  expect(await source()).not.toContain('远征小队')

  // Alone, and time passes: this session renews its own row, and draws nothing.
  await clock.advance(60_000)
  expect(await draws()).toBe(quiet)

  // Another session appears: one new drawing, with it on.
  fleet.put(OTHER, { name: 'nova-relay', status: 'work' })
  await clock.advance(10_000)
  expect(await draws()).toBe(quiet + 1)
  expect(await source()).toContain('nova-relay')
  expect(await source()).toContain('探索中')

  // It renews its row, saying the same: nothing to draw.
  fleet.put(OTHER, { name: 'nova-relay', status: 'work' })
  await clock.advance(30_000)
  fleet.put(OTHER, { name: 'nova-relay', status: 'work' })
  await clock.advance(30_000)
  expect(await draws()).toBe(quiet + 1)

  // It calls for its person: one more drawing.
  fleet.put(OTHER, { name: 'nova-relay', status: 'need' })
  await clock.advance(10_000)
  expect(await draws()).toBe(quiet + 2)
  expect(await source()).toContain('呼叫你')
  await ui.unmount()
})

test('a poem is set in columns, read from the right', () => {
  expect(columns('长风破浪会有时，直挂云帆济沧海').map(col => col.join(''))).toEqual(['长风破浪会有时', '直挂云帆济沧海'])
  // Short clauses share a column; a long line never takes more than three.
  expect(columns('会挽雕弓如满月，西北望，射天狼').map(col => col.join(''))).toEqual(['会挽雕弓如满月', '西北望 射天狼'])
  expect(columns('他强由他强，清风拂山岗；他横由他横，明月照大江').map(col => col.join(''))).toEqual(['他强由他强 清风拂山岗', '他横由他横 明月照大江'])
  for (const [line] of POEMS) {
    expect(columns(line).length, line).toBeLessThanOrEqual(3)
    expect(columns(line).flat().join('').replaceAll(' ', ''), line).toBe(line.replace(/[，。；？！、\s]/g, ''))
  }
})

// ---- the desktop app's rules for a backdrop that may move, as it applies them

const ALLOWED_ELEMENTS = new Set(
  'animate animateMotion animateTransform set circle clipPath defs desc ellipse feBlend feComposite feDropShadow feFlood feGaussianBlur feMerge feMergeNode feOffset filter g line linearGradient marker mask mpath path pattern polygon polyline radialGradient rect stop style svg symbol text textPath title tspan use'.split(
    ' ',
  ),
)
const ALLOWED_FUNCTIONS = new Set(
  'color.color-mix.hsl.hsla.hwb.lab.lch.light-dark.oklab.oklch.rgb.rgba.abs.acos.asin.atan.atan2.calc.clamp.cos.exp.hypot.log.max.min.mod.pow.rem.round.sign.sin.sqrt.tan.var.matrix.matrix3d.perspective.rotate.rotate3d.rotatex.rotatey.rotatez.scale.scale3d.scalex.scaley.scalez.skew.skewx.skewy.translate.translate3d.translatex.translatey.translatez.cubic-bezier.linear.steps.blur.drop-shadow.grayscale.hue-rotate.invert.opacity.saturate.sepia.is.not.nth-child.nth-last-child.nth-last-of-type.nth-of-type.where'.split(
    '.',
  ),
)
const ALLOWED_AT_RULES = new Set(['keyframes', 'layer', 'media', 'supports'])
const MEDIA = /@media([^{]*)(\{|$)/gi
const MEDIA_FEATURE = /\(\s*(?:prefers-reduced-motion(?:\s*:\s*(?:reduce|no-preference))?|prefers-color-scheme(?:\s*:\s*(?:dark|light))?)\s*\)/gi
const MEDIA_REST = /^(?:\s|,|all|and|not|only|or|screen)*$/i
const VIEWPORT_UNIT = /(?:\d|\.)(?:[dsl]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))(?![a-z0-9_-])/i
const BARRED = /shape-rendering|vector-effect/i
const LOCAL_URL = /url\(#[A-Za-z_][\w.:-]*\)/gi
const SPACE = /[\s\p{Cc}]/gu
const CALL = /([^\s()[\]{}<>;:,'"`=+*/!@#$%^&|~?]{0,64})\(/g
const AT_RULE = /@([^\s{};("'/]*)/g

/** Why the app would refuse this CSS or attribute value, or `undefined` when it would not. */
function refusal(value: string): string | undefined {
  if (value.includes('\\')) return 'a backslash'
  if (VIEWPORT_UNIT.test(value)) return 'a viewport or container unit'
  if (BARRED.test(value)) return 'shape-rendering or vector-effect'
  for (const [, query = '', brace] of value.matchAll(MEDIA)) {
    if (brace !== '{' || !MEDIA_REST.test(query.replaceAll(MEDIA_FEATURE, ''))) return `@media${query}`
  }
  if (value.replaceAll(SPACE, '').toLowerCase().includes('data:')) return 'data:'
  if (value.replaceAll(LOCAL_URL, '').replaceAll(SPACE, '').toLowerCase().includes('url(')) return 'url( that is not url(#id)'
  for (const [, name = ''] of value.matchAll(CALL)) {
    const lower = name.toLowerCase()
    if (lower !== '' && lower !== 'url' && !ALLOWED_FUNCTIONS.has(lower)) return `the function ${name}(`
  }
  for (const [, name = ''] of value.matchAll(AT_RULE)) {
    if (!ALLOWED_AT_RULES.has(name.toLowerCase())) return `@${name}`
  }
  return undefined
}

/** Everything in a drawing the app would refuse, as plain lines. */
function refusals(svg: string): string[] {
  const out: string[] = []
  for (const [, name = ''] of svg.matchAll(/<([A-Za-z][\w:-]*)/g)) {
    if (!ALLOWED_ELEMENTS.has(name)) out.push(`the element <${name}>`)
  }
  const sheets = [...svg.matchAll(/<style>([^<]*)<\/style>/g)].map(m => m[1] ?? '')
  const withoutSheets = svg.replace(/<style>[^<]*<\/style>/g, '')
  for (const sheet of sheets) {
    const why = refusal(sheet.replaceAll('&gt;', '>'))
    if (why !== undefined) out.push(`in a style sheet: ${why}`)
  }
  for (const [, name = '', value = ''] of withoutSheets.matchAll(/\s([A-Za-z_][\w:.-]*)="([^"]*)"/g)) {
    if (/^on/i.test(name) || BARRED.test(name)) out.push(`the attribute ${name}`)
    if (name !== 'xmlns') {
      const why = refusal(value)
      if (why !== undefined) out.push(`in ${name}="${value.slice(0, 40)}": ${why}`)
    }
  }
  return [...new Set(out)]
}

// Squads are on every drawing below. Their names are whatever a person typed
// as a title: each of these would cost the scene its motion, or its shape, if
// it reached the drawing as written.
const HOSTILE: readonly Squad[] = [
  { name: 'a\\b url(javascript:1)', status: 'work' },
  { name: 'metadata: <svg onload="x"> &amp; </text><script>', status: 'need' },
  { name: '@import "x"; 10vw 5cqh expression(1)', status: 'wait' },
  { name: '航线日志整理归档与补充说明以及其他很长的标题', status: 'dock' },
  { name: '', status: 'work' },
  { name: 'vector-effect shape-rendering', status: 'wait' },
  { name: '第七支', status: 'work' },
]
const REST: View = { phase: 'cruise', level: 0, from: 'cruise', fromLevel: 0, at: NOW, poem: null, poemAt: 0, progressAt: 0, fleet: HOSTILE }
const EVERY_POEM = POEMS.map((_, i) => i)
const STATES: Record<string, View> = {
  cruise: { ...REST, at: NOW - 60_000 },
  'closing in': { ...REST, level: 2, fromLevel: 1 },
  'closed in': { ...REST, level: 3, fromLevel: 2, at: NOW - 9000 },
  jump: { ...REST, phase: 'work', fromLevel: 3 },
  'jump out of harbour': { ...REST, phase: 'work', from: 'dock' },
  'under way': { ...REST, phase: 'work', at: NOW - 60_000 },
  'under way with a poem': { ...REST, phase: 'work', at: NOW - 60_000, poem: 0, poemAt: NOW - 5000 },
  arrival: { ...REST, from: 'work', poem: 0, poemAt: NOW, progressAt: NOW },
  'out of harbour': { ...REST, from: 'dock', level: 1, progressAt: NOW },
  'into harbour': { ...REST, phase: 'dock', poem: 0, poemAt: NOW },
  harbour: { ...REST, phase: 'dock', from: 'dock', at: NOW - 60_000 },
}

test('every state is a drawing the desktop app lets move', () => {
  for (const motion of ['low', 'full'] as const) {
    for (const [name, state] of Object.entries(STATES)) {
      const svg = scene(state, NOW, { voyage: VOYAGE, poems: POEMS, motion, veil: 0.2, mark: '巡航 · 档位 0 · 第 1 幅' })
      expect(refusals(svg), `${name} (${motion})`).toEqual([])
      // Moving at all is what makes the app play it; and it has to fit.
      expect(svg, name).toContain('animation')
      expect(svg.length, name).toBeLessThan(131_072)
      // Nothing of a name but letters, digits and plain marks comes through:
      // its words may show, never as markup or as anything a style would run.
      expect(svg, name).not.toMatch(/<script|onload=|javascript:|expression\(|@import|url\(javascript/)
      expect(svg, name).toMatch(/另有 [23] 队/)
    }
  }
})

test('every poem fits its drawing, and is markup the app accepts', () => {
  // A glyph is markup too, and a long poem is heavy: each is tried where the
  // drawing is at its fullest, on arrival with the squads listed.
  const arrival = STATES.arrival as View
  for (const poem of EVERY_POEM) {
    const svg = scene({ ...arrival, poem }, NOW, { voyage: VOYAGE, poems: POEMS, motion: 'low', veil: 0.2 })
    expect(svg.length, `poem ${poem}`).toBeLessThan(131_072)
    // The squads never cost a poem its place.
    expect(svg, `keeps poem ${poem}`).toContain('class="gl"')
    for (const [, d = ''] of svg.matchAll(/ d="([^"]*)"/g)) expect(d, `poem ${poem}`).toMatch(/^[MLCQZHV0-9 .-]*$/)
  }
  // The same holds under way and in harbour, where less else is drawn.
  for (const name of ['under way with a poem', 'into harbour']) {
    const svg = scene({ ...(STATES[name] as View), poem: 44 }, NOW, { voyage: VOYAGE, poems: POEMS, motion: 'low', veil: 0.2 })
    expect(refusals(svg), name).toEqual([])
    expect(svg, name).toContain('class="gl"')
  }
})

test('a squad goes by a name the drawing can take', () => {
  expect(squadName('Claude 星图测试对话')).toBe('Claude 星图测…')
  expect(squadName('Claude 星图测试对话', 16)).toBe('Claude 星图测试对话')
  // A name is cleaned where it is written, where it is read and where it is
  // drawn: the third time gives what the first did.
  for (const name of ['Claude 星图测试对话', 'abcdefghijk 中文中文', '航线日志整理归档与补充', 'orion_lab', '…']) {
    expect(squadName(squadName(squadName(name))), name).toBe(squadName(name))
    expect(squadName(squadName(name, 16), 12), name).toBe(squadName(name, 12))
  }
  expect(squadName('orion_lab')).toBe('orion_lab')
  expect(squadName('<b>&"\\ data:x')).toBe('b data x')
  expect(squadName('   ')).toBe('无名小队')
  for (const squad of HOSTILE) {
    expect(squadName(squad.name)).toMatch(/^[\p{L}\p{N} _.·…-]+$/u)
  }
})

test('the squads stand in the sky left of the conversation, each with its name and standing', () => {
  const squads: Squad[] = [
    { name: '甲队：一个相当长的对话标题用来看能显示多少', status: 'work' },
    { name: '乙队', status: 'need' },
    { name: '丙队', status: 'wait' },
  ]
  const views: View[] = [
    { ...REST, phase: 'dock', from: 'dock', at: NOW - 60_000, fleet: squads },
    { ...REST, at: NOW - 60_000, fleet: squads },
    { ...REST, at: NOW, progressAt: NOW, fleet: squads },
    { ...REST, from: 'work', poem: 0, poemAt: NOW, fleet: squads },
    { ...REST, phase: 'work', at: NOW - 60_000, poem: 0, poemAt: NOW - 5000, fleet: squads },
  ]
  for (const view of views) {
    const svg = scene(view, NOW, { voyage: VOYAGE, poems: POEMS, motion: 'low' })
    // Whatever else is going on, they are there, in the same place.
    expect(svg.match(/class="sq"/g)?.length).toBe(3)
    // Nothing answers to a pointer: every ship says who it is and how it stands.
    for (const word of ['远征小队', '乙队', '丙队', '探索中', '呼叫你', '待命']) expect(svg, word).toContain(word)
    // With room for more of a name than the side column ever gave it.
    expect(svg).toContain('甲队 一个相当长的对话标…')
    // They are in the strip hung left of the conversation, never in the scene
    // and never among the words to its right.
    const [main = '', rest = ''] = svg.split('preserveAspectRatio="xMinYMin meet"')
    const [right = '', left = ''] = rest.split('preserveAspectRatio="xMidYMin meet"')
    expect(main).not.toContain('class="sq"')
    expect(right).not.toContain('class="sq"')
    expect(left.match(/class="sq"/g)?.length).toBe(3)
  }
})

test('the squads stand in the middle of the margin left of the text, as far from it as from the window edge', () => {
  const squads: Squad[] = Array.from({ length: 6 }, (_, i) => ({ name: `第${i}队一个相当长的对话标题用来占满`, status: 'wait' }))
  const svg = scene({ ...REST, at: NOW - 60_000, fleet: squads }, NOW, { voyage: VOYAGE, poems: POEMS, motion: 'low' })
  // The margin runs from the window's edge to the text's, 400 left of the
  // middle: its middle is a quarter of the way across, less 200.
  const hung = /<svg x="25%" width="100%" height="100%" style="overflow:visible"><svg x="(-?\d+)" width="(\d+)" height="100%" viewBox="(-?[\d.]+) 0 200 900" preserveAspectRatio="xMidYMin meet"/.exec(svg)
  expect(hung, 'the squads hang from the margin').not.toBeNull()
  const [, x = '0', width = '0', from = '0'] = hung ?? []
  expect(Number(x) + Number(width) / 2).toBe(-200)
  // What is set on that line is the squads' own middle: from the far end of a
  // name at full length to the ring of the ship furthest out.
  const left = svg.slice(svg.indexOf(hung?.[0] ?? ''))
  const ships = [...left.matchAll(/translate\((\d+) \d+\)"><circle class="sq"/g)].map(m => Number(m[1]))
  expect(ships.length).toBe(6)
  // A full name: twelve characters and the mark of a cut, 11px with spacing.
  const name = 13 * 11 * 1.08
  const block = { from: Math.min(...ships) - 20 - name, to: Math.max(...ships) + 13 }
  expect(Math.abs(Number(from) + 100 - (block.from + block.to) / 2)).toBeLessThan(8)
})

test('the side column stands hard by the text: the poem nearest it, its source right under it', () => {
  for (const poem of EVERY_POEM) {
    const view: View = { ...REST, at: NOW - 60_000, poem, poemAt: NOW - 3000, fleet: [] }
    const svg = scene(view, NOW, { voyage: VOYAGE, poems: POEMS, motion: 'low' })
    // The strip hangs from the window's middle, its drawing beginning past
    // half the text column, so a panel on the right reaches it last.
    const strip = /<svg x="(\d+)" width="600" height="100%" viewBox="(\d+) 0 200 900" preserveAspectRatio="xMinYMin meet" style="overflow:visible">/.exec(svg)
    expect(strip, `poem ${poem}`).not.toBeNull()
    const [, hungAt = '0', begins = '0'] = strip ?? []
    expect(Number(hungAt), `poem ${poem}`).toBeGreaterThanOrEqual(400)
    // The chart has brushed words of its own: only the strip's are the poem's.
    const inStrip = svg.slice((strip?.index ?? 0) + (strip?.[0].length ?? 0))
    const inks = [...inStrip.matchAll(/class="ink" transform="translate\(([\d.-]+) ([\d.-]+)\) scale\(([\d.]+)\)"/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]) }))
    expect(inks.length, `poem ${poem}`).toBeGreaterThan(0)
    const left = Math.min(...inks.map(g => g.x))
    const right = Math.max(...inks.map(g => g.x))
    const lowest = Math.max(...inks.map(g => g.y))
    // Every poem, short or long, begins at the strip's own edge.
    expect(left, `poem ${poem}`).toBeGreaterThanOrEqual(Number(begins) - 2)
    expect(left, `poem ${poem}`).toBeLessThanOrEqual(Number(begins) + 4)
    // The source is one column under the poem: inside its width, below its last glyph.
    const signed = [...inStrip.matchAll(/class="gl small" x="([\d.]+)" y="([\d.]+)"/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]) }))
    expect(signed.length, `poem ${poem}`).toBeGreaterThan(0)
    expect(new Set(signed.map(g => g.x)).size, `poem ${poem}`).toBe(1)
    for (const g of signed) {
      expect(g.x, `poem ${poem}`).toBeGreaterThan(left)
      expect(g.x, `poem ${poem}`).toBeLessThan(right + 27)
      expect(g.y, `poem ${poem}`).toBeGreaterThan(lowest)
      // And still well above the foot of the shortest window's strip.
      expect(g.y, `poem ${poem}`).toBeLessThan(720)
    }
  }
})

test('a calm scene moves while something is happening and holds still the rest of the time', () => {
  const draw = (view: View, at: number): string => scene(view, at, { voyage: VOYAGE, poems: POEMS, motion: 'calm' })
  const moves = (svg: string): boolean => /animation|keyframes/.test(svg)

  // At rest, on the chart or in harbour, there is nothing to play.
  expect(moves(draw({ ...REST, at: NOW - 60_000 }, NOW))).toBe(false)
  expect(moves(draw({ ...REST, phase: 'dock', from: 'dock', at: NOW - 60_000 }, NOW))).toBe(false)

  // Typing closes in: the camera moves, then the chart is still again.
  const closing: View = { ...REST, level: 2, fromLevel: 1, at: NOW }
  expect(moves(draw(closing, NOW))).toBe(true)
  expect(moves(draw(closing, NOW + 3000))).toBe(false)

  // A jump: the dive and the first streaks play; then the streaks are held,
  // as a picture of the jump.
  const jump: View = { ...REST, phase: 'work', from: 'cruise', at: NOW }
  expect(moves(draw(jump, NOW + 5000))).toBe(true)
  const held = draw(jump, NOW + 16_000)
  expect(moves(held)).toBe(false)
  expect(held).toContain('class="warp')

  // A poem under way comes in moving, then stands still and stays on show.
  const verse: View = { ...jump, at: NOW - 60_000, poem: 0, poemAt: NOW }
  expect(moves(draw(verse, NOW + 2000))).toBe(true)
  const standing = draw(verse, NOW + 10_000)
  expect(moves(standing)).toBe(false)
  expect(standing).toContain('class="gl"')

  // An arrival plays right through to its poem drifting off.
  const arrival: View = { ...REST, from: 'work', at: NOW, poem: 0, poemAt: NOW, progressAt: NOW }
  expect(moves(draw(arrival, NOW + 8000))).toBe(true)
  expect(quietAt(arrival, POEMS)).toBeGreaterThan(NOW + 12_000)

  // Whatever the state, once it has played out the drawing is one the app
  // shows as a picture, and still a drawing it accepts.
  for (const [name, state] of Object.entries(STATES)) {
    const after = draw(state, quietAt(state, POEMS))
    expect(moves(after), name).toBe(false)
    expect(refusals(after), name).toEqual([])
  }
})

test('a view drawn again part-way does not come up a second time', () => {
  // The harbour and the jump fade up as they are entered. Drawn again later,
  // for the fleet or a setting, they are already there.
  const again = (view: View): string => scene(view, NOW, { voyage: VOYAGE, poems: POEMS, motion: 'low' })
  expect(again({ ...REST, phase: 'dock', from: 'cruise', at: NOW })).toContain('animation:show')
  expect(again({ ...REST, phase: 'dock', from: 'dock', at: NOW })).not.toContain('animation:show')
  expect(again({ ...REST, phase: 'work', from: 'cruise', at: NOW })).toContain('animation:show')
  expect(again({ ...REST, phase: 'work', from: 'work', at: NOW })).not.toContain('animation:show')
})

test('the lab takes the scene apart without breaking it', () => {
  const base = { voyage: VOYAGE, poems: POEMS, motion: 'low' as const }
  for (const [name, state] of Object.entries(STATES)) {
    for (const lab of [['nostars'], ['noglow'], ['noside'], ['nosquads'], ['flat'], ['nostars', 'noglow', 'noside', 'nosquads']]) {
      const svg = scene(state, NOW, { ...base, lab })
      expect(refusals(svg), `${name} ${lab.join()}`).toEqual([])
      if (lab.includes('nostars')) expect(svg, name).not.toContain('class="star"')
      if (lab.includes('noglow')) expect(svg, name).not.toMatch(/fill="url\(#g/)
      if (lab.includes('noside')) expect(svg, name).not.toContain('xMinYMin meet')
      if (lab.includes('nosquads')) expect(svg, name).not.toContain('class="sq"')
      if (lab.includes('flat')) expect(svg.match(/<svg/g)?.length, name).toBe(1)
    }
    const bare = scene(state, NOW, { ...base, lab: ['bare'] })
    expect(bare.length, name).toBeLessThan(200)
    expect(refusals(bare), name).toEqual([])
  }
  // With no switch set, the scene is what it always was.
  expect(scene(STATES.cruise as View, NOW, { ...base, lab: [] })).toBe(scene(STATES.cruise as View, NOW, base))
})

test('a still scene has nothing in it that moves, in any state', () => {
  for (const [name, state] of Object.entries(STATES)) {
    const svg = scene(state, NOW, { voyage: VOYAGE, poems: POEMS, motion: 'still' })
    // Nothing for the app to play: it shows the picture and lays no moving
    // stand-in over it.
    expect(svg, name).not.toMatch(/animation|keyframes|transition|<animate/)
    expect(refusals(svg), name).toEqual([])
    expect(svg, name).not.toContain('<style></style>')
    // It is still the whole picture of the state.
    expect(svg, name).toContain(state.phase === 'work' ? 'class="warp' : state.phase === 'dock' ? 'class="planet"' : 'class="route"')
  }
})

test('a still drawing is a finished picture: nothing it shows waits on an animation', () => {
  for (const [name, state] of Object.entries(STATES)) {
    const svg = scene(state, NOW, { voyage: VOYAGE, poems: POEMS, motion: 'low' })
    // The app's still version drops every animation and keyframe, so only a
    // style of its own can hide a layer for good; a way in is always
    // `backwards`, never a fill that would hold its first frame.
    expect(svg, name).not.toMatch(/animation:[^;"]*\b(?:both|forwards)\b[^;"]*;animation-delay/)
  }
})

// ---------------------------------------------------------------- the ground

/** The scene as the mod asks for it with the app's glass off: its own veil, and a ground. */
const BARE = { voyage: VOYAGE, poems: POEMS, veil: 0.2, ground: 380 } as const
/** The part of a drawing that hangs from the window's foot: one pixel to a unit, heights as negative y. */
const footOf = (svg: string): string =>
  svg.match(/<svg y="100%" width="100%" height="100%" style="overflow:visible">(.*?)<\/svg>(?:<svg x="50%" width="|<\/svg>$)/s)?.[1] ?? ''
/** How far above the window's foot the harbour's horizon stands at the window's edges, and in its middle. */
function horizon(svg: string): { edge: number; middle: number } {
  const [, cy = '', r = ''] = svg.match(/<circle class="(?:land|planet)" cx="1000" cy="([\d.]+)" r="(\d+)"/) ?? []
  const middle = Number(r) - Number(cy)

  return { middle, edge: middle - (Number(r) - Math.sqrt(Number(r) ** 2 - 1000 ** 2)) }
}

test('with a ground, nothing a tall message box could cut stands in the foot of the window', () => {
  for (const motion of ['low', 'still'] as const) {
    for (const [name, state] of Object.entries(STATES)) {
      const svg = scene(state, NOW, { ...BARE, motion })
      const where = `${name} (${motion})`
      expect(refusals(svg), where).toEqual([])
      expect(svg.length, where).toBeLessThan(131_072)
      const foot = footOf(svg)
      expect(foot, where).not.toBe('')

      if (state.phase === 'dock') {
        // The small world is the page's colour, and its horizon clears the
        // ground at the window's edges, where it stands lowest, by the depth
        // its body still carries light to.
        expect(foot, where).toContain('class="land"')
        expect(horizon(svg).edge, where).toBeGreaterThanOrEqual(380 + 24)
        expect(horizon(svg).edge, where).toBeLessThan(380 + 26)
      } else {
        // The chart and the jump dissolve into the page's colour, and from
        // 380 pixels up to the foot they are that colour alone.
        expect(foot, where).toContain('fill="url(#gSoil)"')
        expect(foot, where).toMatch(/<rect class="veil" x="0" y="-381" width="100%" height="389"\/>/)
        // The chart and the jump are raised clear of it, whole: nothing of
        // them is left where it was, and the glow of the engines is no longer
        // at the scene's own foot.
        expect(svg, where).toContain('<g transform="translate(0 -150)">')
        expect(svg, where).not.toMatch(/cy="960"/)
      }
      // The harbour's sky is not raised: a harbour that has settled has nothing in it that is.
      if (name === 'harbour') expect(svg, where).not.toContain('translate(0 -150)')
      // A glow on the ground's side of the line is behind the world or under the fade, never over them.
      const glow = foot.indexOf('fill="url(#gFire)"')
      if (state.phase !== 'cruise') expect(glow, where).toBeGreaterThanOrEqual(0)
      if (glow >= 0) expect(glow, where).toBeLessThan(state.phase === 'dock' ? foot.indexOf('class="land"') : foot.indexOf('url(#gSoil)'))
      // The side column's small words and the last of the squads stand in the
      // upper part of their strips (the strips' own units, 900 to the window's
      // height): above the ground on any window some 800 pixels tall or more.
      const strips = svg.slice(svg.indexOf('<svg x="50%" width="'))
      for (const [, y = ''] of strips.matchAll(/<text [^>]*\by="([\d.]+)"/g)) expect(Number(y), where).toBeLessThan(500)
    }
  }
  // The ground costs no poem its place: the longest still fits where the drawing is at its fullest.
  for (const poem of EVERY_POEM) {
    const svg = scene({ ...(STATES.arrival as View), poem }, NOW, { ...BARE, motion: 'low' })
    expect(svg.length, `poem ${poem}`).toBeLessThan(131_072)
    expect(svg, `keeps poem ${poem}`).toContain('class="gl"')
  }
  // Leaving harbour, the world that drops away is the same world, drawn over a ground that is already there.
  const leaving = scene(STATES['jump out of harbour'] as View, NOW, { ...BARE, motion: 'low' })
  expect(footOf(leaving)).toContain('class="land"')
  expect(footOf(leaving)).toContain('url(#gSoil)')
  expect(footOf(scene({ ...(STATES['jump out of harbour'] as View), at: NOW - 5000 }, NOW, { ...BARE, motion: 'low' }))).not.toContain('class="land"')
  // Coming into harbour, the chart's ground goes with the chart.
  expect(footOf(scene(STATES['into harbour'] as View, NOW, { ...BARE, motion: 'low' }))).toMatch(/opacity:0;animation:hide[^"]*"><rect [^>]*url\(#gSoil\)/)
})

test('without a ground the scene is laid out as it was, and the harbour keeps its own colour', () => {
  for (const [name, state] of Object.entries(STATES)) {
    const svg = scene(state, NOW, { voyage: VOYAGE, poems: POEMS, motion: 'low', veil: 0.2 })
    expect(svg, name).not.toContain('url(#gSoil)')
    expect(svg, name).not.toContain('class="land"')
    expect(svg, name).not.toContain(`translate(0 -150)`)
    if (state.phase === 'dock') {
      expect(horizon(svg).middle, name).toBe(260)
      // With no ground to keep to, the lamp lights the ground it stands on, as it always did.
      const foot = footOf(svg)
      expect(foot, name).toContain('class="planet"')
      expect(foot.indexOf('fill="url(#gFire)"'), name).toBeGreaterThan(foot.indexOf('class="planet"'))
    }
  }
  // The ground is given in whole pixels and never more than the scene is tall.
  const tall = scene(STATES.harbour as View, NOW, { ...BARE, ground: 5000.4, motion: 'low' })
  expect(Math.round(horizon(tall).edge)).toBe(924)
})

test('the mod keeps a ground while the glass is off, moves it when asked, and drops it with the glass on', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kept = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_, e) => {
    kept.set(e.key, e.value)

    return { value: undefined }
  })
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
  on('command.register', () => ({ value: { command: 'voyage' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const run = async (args: string): Promise<string> => {
    const { text = '' } = await $.command.run({ command: 'voyage', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

    return text
  }

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(BACKDROP)
  const source = async (): Promise<string> => String((await ui.find({ type: 'Svg' }))?.props.source)
  // The chart, on its ground: 120 pixels unless told otherwise.
  expect(await source()).toMatch(/<rect class="veil" x="0" y="-121"/)

  // In harbour the world stands on it.
  await run('lab scene=dock')
  expect(Math.round(horizon(await source()).edge)).toBe(144)
  expect(await source()).toContain('class="land"')

  // Lower, for someone whose message box is never tall; the others hear of it.
  expect(await run('ground 240')).toContain('240')
  expect(Math.round(horizon(await source()).edge)).toBe(264)
  expect(kept.get('ground')).toBe(240)
  expect(await run('')).toContain('底部留地面 240 像素')

  // Not a height: the command says what it takes and changes nothing.
  expect(await run('ground 9000')).toContain('用法')
  expect(await run('ground')).toContain('现在是 240')
  expect(kept.get('ground')).toBe(240)

  // None: the scene is laid out as it was.
  await run('ground 0')
  expect(await source()).toContain('class="planet"')
  await run('lab off')
  expect(await source()).not.toContain('url(#gSoil)')

  // Set elsewhere, it is taken up here.
  kept.set('ground', 300)
  kept.set('rev', NOW + 5)
  await clock.advance(11_000)
  expect(await source()).toMatch(/<rect class="veil" x="0" y="-301"/)

  // With the app's glass on there is no slab to hide, and no ground.
  await run('glass 8 0.3')
  expect(await source()).not.toContain('url(#gSoil)')
  await run('glass off')
  expect(await source()).toContain('url(#gSoil)')
  await ui.unmount()
})

test('the voyage is set by command, kept for every conversation, and starts on the day of install until then', async ($, on) => {
  mock.clock(on, { now: NOW })
  const kept = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_, e) => {
    kept.set(e.key, e.value)

    return { value: undefined }
  })
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
  on('command.register', () => ({ value: { command: 'voyage' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const run = async (args: string): Promise<string> => {
    const { text = '' } = await $.command.run({ command: 'voyage', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

    return text
  }

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(BACKDROP)
  const source = async (): Promise<string> => String((await ui.find({ type: 'Svg' }))?.props.source)

  // Nothing set: from the first run, a year long, no harbours.
  expect(kept.get('since')).toBe(NOW)
  expect(await source()).not.toContain('class="hb"')
  expect(await run('')).toContain('港湾：没有')

  // A voyage of one's own.
  expect(await run('from 2025-09-01')).toContain('2025-09-01 启航')
  expect(await run('to 2028-06-30 归航')).toContain('2028-06-30 抵达「归航」')
  expect(await run('port 2026-09-01 灯塔')).toContain('灯塔 2026-09-01')
  await run('port 2027-12-01 补给站')
  // A harbour beyond the voyage is kept, but not drawn.
  await run('port 2030-01-01 远方')
  const chart = await source()
  expect(chart).toContain('2028.06.30')
  expect(chart).toContain('灯塔')
  expect(chart).toContain('补给站')
  expect(chart).not.toContain('远方')
  expect(kept.get('voyage')).toMatchObject({ from: '2025-09-01', to: '2028-06-30', dest: '归航' })

  // What is not a date changes nothing.
  expect(await run('from 2025-02-30')).toContain('用法')
  expect(await run('port 2026-09-01')).toContain('用法')
  expect(await run('to tomorrow')).toContain('用法')
  expect(kept.get('voyage')).toMatchObject({ from: '2025-09-01' })

  // The same day again renames; remove and clear take them away.
  await run('port 2026-09-01 中途')
  expect(await source()).toContain('中途')
  expect(await source()).not.toContain('灯塔')
  await run('port remove 补给站')
  expect(await source()).not.toContain('补给站')
  await run('port clear')
  expect(await source()).not.toContain('class="hb"')

  // Back to the defaults.
  await run('from reset')
  await run('to reset')
  expect(kept.get('voyage')).toMatchObject({ ports: [] })
  expect(await run('')).toContain('（装上那天）')
  await ui.unmount()
})
