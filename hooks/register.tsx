// 星空远征: a look for the desktop and mobile apps.
//
// The ship charts a course while the person thinks, closes in as they type,
// jumps when the turn starts, comes back to the chart when it ends, and lies
// up in harbour once the session has been idle long enough for its cache to
// go cold. The backdrop is drawn in `scene.ts`; this file decides which view
// stands, and when.
//
// Every new view is a new drawing for the surface to load, so a view changes
// only when what it shows does: a keystroke is noted and the camera follows
// once the typing pauses.
//
// Sessions running side by side show one another as squads. Each leaves a
// small file saying how it stands (under way, waiting, laid up, calling for
// its person) in a folder they all read; nothing else passes between them.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs, Timer } from 'claude-code'

import { makeColors } from './make-colors.js'
import { POEMS } from './poems'
import { describe, quietAt, scene, settlesAfter, squadName } from './scene'
import type { Motion } from './scene'
import { COOL_MINUTES, DEST_ROOM, PORT_ROOM, PORTS_MOST, WARM_MINUTES, dayOf, parseDay, readPlan, voyageOf } from './voyage'
import type { Plan } from './voyage'
import type { Squad, SquadStatus, View } from '../types'

const SCENE = 'voyage'

// By night, deep space with one warm colour: the engine. By day, the app's own
// warm paper, which the scene draws on in ink. Both halves are given: a look
// with one half alone holds the app in that mode whatever the person chose.
const { theme, problems } = makeColors({
  label: '星空远征',
  roles: { accent: '#ff7a3c', danger: '#e5484d', success: '#46a758', warning: '#f5a524', pro: '#8e7cf0' },
  light: {
    roles: { accent: '#c6613f' },
    gray: {
      anchors: {
        'surface-0': '#f0eee6',
        'surface-1': '#f5f4ed',
        'surface-2': '#faf9f5',
        'text-primary': '#1f1e1d',
        'text-secondary': '#3d3d3a',
        'text-muted': '#63625c',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#060a13',
        'surface-1': '#0a101d',
        'surface-2': '#0e1626',
        'surface-3': '#111a2d',
        'text-primary': '#e3e9f5',
        'text-secondary': '#b9c4d9',
        'text-muted': '#93a0ba',
      },
    },
  },
})

const AT_REST: View = {
  phase: 'cruise',
  level: 0,
  from: 'cruise',
  fromLevel: 0,
  at: 0,
  poem: null,
  poemAt: 0,
  progressAt: 0,
  fleet: [],
}

/** What a session leaves in the fleet folder: who it is and how it stands. */
type Row = {
  id: string
  name: string
  status: SquadStatus | 'gone'
  /** When the session was first heard of, which orders the squads. */
  born: number
  /** When this was written. A row is renewed while its session's process runs. */
  at: number
  /** When something last happened in the session: a turn, or its person typing. */
  active: number
  /** How long after that the session still counts as a squad out in the field, in milliseconds. */
  warm: number
}

/**
 * How much of the window's foot the scene gives up to the page's colour, in
 * pixels, and the most it can be asked to. 120 clears a one-line message box
 * and the status line; a box with a card or a picture above it wants 250–380.
 */
const GROUND = 120
const GROUND_MOST = 700
/** Under way, the first poem comes once the jump has settled, and a new one each minute after. */
const VERSE_FIRST_MS = 3000
const VERSE_EVERY_MS = 60_000

/** How often a session looks at the others, and renews its own row at least. */
const MUSTER_MS = 10_000
const RENEW_MS = 30_000
/**
 * A row not renewed for this long is a session that is no longer heard from:
 * whatever it was doing, it is shown as waiting. It stays on show all the same
 * for as long as its cache is warm, as every squad does: a conversation left
 * warm is one its person may still come back to.
 */
const STALE_MS = 100_000
/** Rows this old are cleared out of the folder when a session starts. */
const FORGET_MS = 24 * 3_600_000
const STANCE: Record<SquadStatus, string> = { work: '探索中', wait: '待命', dock: '休整', need: '呼叫你' }
/** How much of a name a row carries: more than any drawing shows, so the drawing decides. */
const NAME_ROOM = 16
const ROW_FILE = /^[0-9a-zA-Z-]{8,64}\.json$/

// Change the tag when a field of View changes: it declines what an earlier
// version stored, which outlives a reload.
const view = atom({ plugin: 'star-voyage', key: 'view' } as const, AT_REST, { shape: 'view-2' })

// What this load has heard and decided. A reload starts it over; what has to
// outlive one is in `view` (the session's) or `$.store` (across sessions).
const ship = {
  // What stands now, kept beside the atom: a write redraws the backdrop, so a
  // keystroke or a tick that changes nothing must not write at all.
  phase: 'cruise' as View['phase'],
  level: 0,
  viewAt: 0,
  /** The draft's length at the last keystroke, and how many there have been. */
  draft: 0,
  keys: 0,
  /** The key count at the clock's last turn: a change since is the person at work here. */
  keysSeen: 0,
  /**
   * How long the conversation had lain untouched when it was picked up again,
   * as the engine says at its start; -1 when it has not said.
   */
  idleMs: -1,
  /** The start has drawn its first view: what is learned after it is acted on at once. */
  hasStarted: false,
  /** What the engine said of the pick-up, for `/voyage`. */
  pickedUp: '没有说',
  draftWatch: undefined as Timer | undefined,
  /** The redraw booked to clear away what the standing view leaves behind. */
  settle: undefined as Timer | undefined,
  lastActive: 0,
  coolMs: COOL_MINUTES * 60_000,
  hasSound: true,
  isOn: true,
  // Still unless something is happening: a scene that moves all the time
  // costs the app's graphics process several hundred megabytes and a good
  // deal of its time, and at rest there is little to see moving.
  motion: 'calm' as Motion,
  hasMark: false,
  // The app's glass panels, which let the scene show through its sidebar and
  // cards: off unless asked for. Measured on a 5K window they cost about half
  // a gigabyte of graphics memory whatever is drawn behind them, where the
  // scene with no glass costs next to nothing.
  glass: false as false | { blur: number; opacity: number },
  /** With the glass off, how much of the page's colour the scene lays over itself. */
  veil: 0.2,
  // With the glass off the app lays an opaque slab of the page's colour
  // behind the message box, from the box's top to the foot of the window, and
  // tells the scene nothing of it. The scene gives that much of its foot up
  // to the same colour, so the slab cannot be seen: pixels from the window's
  // foot. A box taller than this shows as a faint edge, no more.
  ground: GROUND,
  /** The voyage the person has set; what is left out is filled in by `voyageOf`. */
  plan: {} as Plan,
  /** The day the skin first ran here: the voyage starts then until a start is set. */
  since: 0,
  bag: [] as number[],
  // `/voyage` reports these, so a part that stays silent on a surface can be
  // told from one that is broken.
  turns: 0,
  /** Times the camera moved for the draft, a view was cleared, the ship docked: each from a timer. */
  follows: 0,
  settles: 0,
  docks: 0,
  asks: 0,
  draws: 0,
  drawn: '还没有设置',
  lastAsk: '还没有被问过',
  /** Where the side column stands in the scene. */
  side: 0,
  /** The settings' mark as last read: another conversation changing one moves it on. */
  rev: 0,
  /** The version this load is, from the manifest: told with a drawing when the lab is on. */
  version: '',
  /**
   * Switches for taking the skin apart to measure what each part costs the
   * app; empty in ordinary use. `scene=…` draws one scene whatever the
   * conversation is doing, `motion=…` overrides the motion, `colors` sets the
   * colours with no backdrop, `noglass` leaves the app's panels as they are;
   * the rest are the scene's own.
   */
  lab: [] as string[],
  /** The redraw booked for the moment a calm scene falls still. */
  calm: undefined as Timer | undefined,

  // ---- poems under way
  /** The timer for the next poem of a jump. */
  verseWatch: undefined as Timer | undefined,
  /** When the jump began, when its last poem went up, and whether it has had one. */
  jumpAt: 0,
  verseAt: 0,
  hasVerse: false,
  /**
   * How many drawings had been asked for when the last poem went up. A
   * surface asks only while the conversation is on screen, so a count that
   * has not moved means nobody is looking, and no poem is written for nobody.
   */
  verseDraws: 0,
  /** A poem booked for the moment after a drawing, when the person has come back. */
  verseSoon: undefined as Timer | undefined,
  /**
   * A jump is on: from the moment a turn starts to the moment it is heard to
   * end. `phase` says the same a little later, once the arrival is drawn; a
   * poem must not slip into that gap.
   */
  isUnderWay: false,
  verses: 0,

  // ---- the fleet
  hasFleet: true,
  /**
   * Whether this session is a squad out in the field: it has been given
   * something to do. One that only stands open, or that the app keeps ready
   * in the background, is not, and tells the others nothing.
   */
  isOut: false,
  /** How long after its last activity a squad stays on show. */
  warmMs: WARM_MINUTES * 60_000,
  /** The folder every session writes its row to; `''` until found, `'-'` when there is none. */
  fleetDir: '',
  /** This session, as its row names it. */
  id: '',
  born: 0,
  title: '',
  firstWords: '',
  /** What this session's row called it before a reload. */
  savedName: '',
  folder: '',
  /** Goes up at each goodbye, so a row written before it is not written after it. */
  epoch: 0,
  /** What was last written, so a row is rewritten only when it changes or grows old. */
  told: { status: '', name: '', at: 0 },
  /** What stands open with the person, counted by loop and kind: a question, a plan, a permission. */
  needs: new Map<string, number>(),
  /** The last turn ended in an error: the session is stuck until its person looks. */
  hasFailed: false,
  /** The others as last read, and that reading as one string to compare. */
  fleet: [] as Squad[],
  fleetKey: '[]',
  /** The reading the view on screen was drawn from. */
  fleetShown: '[]',
  /** Rows already read, by file name: one that has not changed is not read again. */
  rows: new Map<string, { mtimeMs: number; row: Row }>(),
  musters: 0,
  tells: 0,
  questions: 0,
  permits: 0,
  fleetFault: '',
}

/** How close the camera stands for a draft of this many characters. */
function levelFor(length: number): number {
  if (length === 0) return 0
  if (length < 12) return 1
  return length < 36 ? 2 : 3
}

/** The next poem: a shuffled round through before any repeats. */
function nextPoem(): number {
  if (ship.bag.length === 0) {
    ship.bag = POEMS.map((_, i) => i)
    for (let i = ship.bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const a = ship.bag[i] ?? 0
      ship.bag[i] = ship.bag[j] ?? 0
      ship.bag[j] = a
    }
  }
  return ship.bag.pop() ?? 0
}

function play($: EngineInterface, asset: string): void {
  if (ship.hasSound) {
    void $.audio.play({ asset }, { gain: 0.6 }).catch(() => undefined)
  }
}

/** Sets the look, or clears it when the skin is switched off. */
async function applyLook($: EngineInterface): Promise<void> {
  if (!ship.isOn) {
    await $.theme.clear()
    ship.drawn = '已关闭'
    return
  }
  const glass = ship.lab.includes('noglass') ? (false as const) : ship.glass
  const look: ThemeSetArgs = ship.lab.includes('colors') ? { colors: theme } : { colors: theme, backdrop: { scene: SCENE, glass } }
  const set = await $.theme.set(look)
  ship.drawn = set.isDrawn ? '是' : `否（${set.reason}）`
}

/** The motion in force: the person's, unless the lab names one. */
function motionNow(): Motion {
  const named = ship.lab.find(flag => flag.startsWith('motion='))?.slice(7)
  return named === 'low' || named === 'full' || named === 'still' || named === 'calm' ? named : ship.motion
}

/**
 * The view the lab asks to have drawn in place of the standing one, so a
 * scene can be measured whatever the conversation happens to be doing.
 */
function labView(standing: View, now: number): View {
  const named = ship.lab.find(flag => flag.startsWith('scene='))?.slice(6)
  const rest: View = { ...standing, level: 0, fromLevel: 0, at: now - 60_000, poem: null, poemAt: 0, progressAt: 0 }

  if (named === 'cruise') return { ...rest, phase: 'cruise', from: 'cruise' }
  if (named === 'dock') return { ...rest, phase: 'dock', from: 'dock' }
  if (named === 'work') return { ...rest, phase: 'work', from: 'work' }
  if (named === 'verse') return { ...rest, phase: 'cruise', from: 'cruise', poem: 3, poemAt: now - 5000 }
  if (named === 'workverse') return { ...rest, phase: 'work', from: 'work', poem: 3, poemAt: now - 5000 }
  if (named === 'jump') return { ...rest, phase: 'work', from: 'cruise', at: now }
  return standing
}

/**
 * With the lab on, each drawing leaves a line saying what was drawn, so a
 * reading of the app's memory can be put beside the scene that was on screen.
 */
async function reportDraw($: EngineInterface, standing: View, shown: View, now: number, bytes: number): Promise<void> {
  const home = await $.env.get('HOME')

  if (home === undefined || home === '') {
    return
  }
  const id = await $.session.id()
  await $.fs.write(
    `${home}/.claude/star-voyage/state/${id}.json`,
    JSON.stringify({
      id,
      version: ship.version,
      at: now,
      phase: standing.phase,
      drawn: `${shown.phase}${shown.poem === null ? '' : '+poem'}`,
      motion: motionNow(),
      isQuiet: now >= quietAt(shown, POEMS),
      lab: ship.lab.join(),
      bytes,
      draws: ship.draws,
    }),
  )
}

/** What this load is, as its manifest says. */
async function readVersion($: EngineInterface): Promise<string> {
  try {
    const manifest = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : ''
  } catch {
    return ''
  }
}

/** Leaves what this load has heard where it can be read from outside the app. */
function note($: EngineInterface, why: string): void {
  void $.store
    .set('diag', {
      why,
      phase: ship.phase,
      level: ship.level,
      keys: ship.keys,
      turns: ship.turns,
      follows: ship.follows,
      settles: ship.settles,
      docks: ship.docks,
      asks: ship.asks,
      draws: ship.draws,
      drawn: ship.drawn,
      lastAsk: ship.lastAsk,
      motion: ship.motion,
      glass: ship.glass,
      squads: ship.fleet.length,
      musters: ship.musters,
      tells: ship.tells,
      questions: ship.questions,
      permits: ship.permits,
      fleetFault: ship.fleetFault,
      pickedUp: ship.pickedUp,
    })
    .catch(() => undefined)
}

// ---------------------------------------------------------------- the fleet
//
// Nothing here may take the skin down with it: every call into the folder is
// tried, and a failure is kept as one line for `/voyage` to show.

/** The folder the rows live in, found once: `STAR_VOYAGE_FLEET`, else under the person's own `.claude`. */
async function fleetFolder($: EngineInterface): Promise<string> {
  if (ship.fleetDir === '') {
    const named = await $.env.get('STAR_VOYAGE_FLEET')
    const home = await $.env.get('HOME')
    ship.fleetDir = named !== undefined && named !== '' ? named : home !== undefined && home !== '' ? `${home}/.claude/star-voyage/fleet` : '-'
  }
  return ship.fleetDir === '-' ? '' : ship.fleetDir
}

/** How many prompts the person has sent in this conversation, or -1 when the engine will not say. */
async function promptsSoFar($: EngineInterface): Promise<number> {
  try {
    return await $.session.turns()
  } catch {
    return -1
  }
}

/** The name of the folder the session works in, which names it until it has a title. */
async function folderName($: EngineInterface): Promise<string> {
  try {
    return (await $.session.cwd()).split('/').filter(Boolean).pop() ?? ''
  } catch {
    return ''
  }
}

/** How this session stands, as the others will show it. */
function stance(): SquadStatus {
  if (ship.needs.size > 0) return 'need'
  if (ship.phase === 'work') return 'work'
  if (ship.hasFailed) return 'need'
  return ship.phase === 'dock' ? 'dock' : 'wait'
}

/**
 * What this session is called: its title, else how it began, else what its
 * row called it before a reload, else where it works.
 */
function calledAs(): string {
  const folder = /^scratch-/.test(ship.folder) ? '' : ship.folder
  return squadName(ship.title || ship.firstWords || ship.savedName || folder || '新对话', NAME_ROOM)
}

function parseRow(text: string): Row | undefined {
  try {
    const row = JSON.parse(text) as Partial<Row> | null
    const isStatus = row?.status === 'work' || row?.status === 'wait' || row?.status === 'dock' || row?.status === 'need' || row?.status === 'gone'
    // A row with no `warm` is from before squads had one: not a row.
    if (row === null || typeof row !== 'object' || typeof row.id !== 'string' || !isStatus || typeof row.at !== 'number' || typeof row.warm !== 'number') {
      return undefined
    }
    return {
      id: row.id,
      name: typeof row.name === 'string' ? row.name : '',
      status: row.status ?? 'gone',
      born: typeof row.born === 'number' ? row.born : row.at,
      at: row.at,
      active: typeof row.active === 'number' ? row.active : row.at,
      warm: typeof row.warm === 'number' && row.warm > 0 ? Math.min(row.warm, FORGET_MS) : 0,
    }
  } catch {
    return undefined
  }
}

/**
 * Writes this session's row when it says something new, or has grown old
 * enough that the others would take the session for gone.
 */
async function tell($: EngineInterface): Promise<void> {
  if (!ship.hasFleet) {
    return
  }
  // A goodbye said while this is on its way must have the last word.
  const epoch = ship.epoch
  try {
    const dir = await fleetFolder($)

    if (dir === '') {
      return
    }
    const id = await $.session.id()
    const now = await $.clock.now()

    if (epoch !== ship.epoch) {
      return
    }
    if (ship.id !== id) {
      // A `/clear` goes on under a new id with no `session.start`: the old
      // conversation is over, and so is what it was called.
      if (ship.id !== '') {
        if (ship.isOut) {
          await $.fs.write(`${dir}/${ship.id}.json`, JSON.stringify({ id: ship.id, name: '', status: 'gone', born: ship.born, at: now, active: 0, warm: 0 } satisfies Row))
        }
        // The new conversation is out only if it has already been given work.
        ship.isOut = ship.phase === 'work'
        ship.title = ''
        ship.firstWords = ''
        ship.savedName = ''
        ship.born = 0
      }
      ship.id = id
      ship.told = { status: '', name: '', at: 0 }
    }
    if (ship.born === 0) {
      // A reload starts this file's memory over; the row it left knows better.
      const mine = (await $.fs.exists(`${dir}/${id}.json`)) ? parseRow(await $.fs.read(`${dir}/${id}.json`)) : undefined
      ship.born = mine?.born ?? now
      ship.savedName = mine?.name ?? ''

      // It was out before the reload: it still is, and no warmer for having
      // been reloaded.
      if (mine !== undefined && mine.status !== 'gone') {
        ship.isOut = true

        if (mine.active > 0 && ship.phase !== 'work') {
          ship.lastActive = mine.active
        }
      }
    }
    // Nothing has been asked of this session yet: it is no squad.
    if (!ship.isOut) {
      return
    }
    const status = stance()
    const name = calledAs()

    if (epoch !== ship.epoch || (ship.told.status === status && ship.told.name === name && now - ship.told.at < RENEW_MS)) {
      return
    }
    ship.told = { status, name, at: now }
    ship.tells += 1
    // A turn under way is the session at its warmest.
    const active = ship.phase === 'work' ? now : ship.lastActive
    await $.fs.write(`${dir}/${id}.json`, JSON.stringify({ id, name, status, born: ship.born, at: now, active, warm: ship.warmMs } satisfies Row))
  } catch (error) {
    // Not told after all: the next look tries again, not the next renewal.
    ship.told = { status: '', name: '', at: 0 }
    ship.fleetFault = `上报：${String(error).slice(0, 120)}`
  }
}

/** What is in the fleet folder, or `undefined` when it cannot be listed. */
async function listRows($: EngineInterface, dir: string) {
  try {
    return await $.fs.list(dir)
  } catch (error) {
    ship.fleetFault = `点名：${String(error).slice(0, 120)}`

    return undefined
  }
}

/** One row, or `undefined` when it cannot be read or is not a row. */
async function readRow($: EngineInterface, path: string): Promise<Row | undefined> {
  try {
    return parseRow(await $.fs.read(path))
  } catch {
    return undefined
  }
}

/** Reads the others' rows: every session but this one that has spoken lately. */
async function muster($: EngineInterface): Promise<Squad[] | undefined> {
  try {
    const dir = await fleetFolder($)

    if (dir === '' || ship.id === '') {
      return undefined
    }
    const now = await $.clock.now()
    const listed = await listRows($, dir)

    if (listed === undefined) {
      // No folder is no fleet; this session's next row makes the folder again.
      ship.rows.clear()

      return []
    }
    const live = new Set<string>()
    const rows: Row[] = []

    for (const entry of listed) {
      // A row untouched for a day is past any cache: not worth opening. One
      // that has not changed since it was read is not read again.
      if (entry.kind !== 'file' || !ROW_FILE.test(entry.name) || entry.name === `${ship.id}.json` || now - entry.mtimeMs > FORGET_MS) {
        continue
      }
      let known = ship.rows.get(entry.name)

      if (known === undefined || known.mtimeMs !== entry.mtimeMs) {
        const row = await readRow($, `${dir}/${entry.name}`)

        // One bad row is one squad missing, not the fleet; and a row caught
        // half-written is read again at the next look.
        if (row === undefined) {
          continue
        }
        known = { mtimeMs: entry.mtimeMs, row }
        ship.rows.set(entry.name, known)
      }
      live.add(entry.name)

      const row = known.row

      if (row.status === 'gone') {
        continue
      }
      // On show for as long as its cache is warm, heard from or not, and no
      // longer: a turn under way renews its warmth with every row, so only a
      // session nothing happens in goes cold, one stuck on an error included.
      // A silent one is not known to be doing anything: it waits.
      if (now - row.active >= row.warm) {
        continue
      }
      rows.push(now - row.at <= STALE_MS ? row : { ...row, status: row.status === 'dock' ? 'dock' : 'wait' })
    }
    for (const name of [...ship.rows.keys()]) {
      if (!live.has(name)) ship.rows.delete(name)
    }
    ship.musters += 1
    ship.fleetFault = ''
    rows.sort((a, b) => a.born - b.born || (a.id < b.id ? -1 : 1))
    // More squads than rows: the ones that call or work are named first, the
    // rest are counted.
    const rank: Record<string, number> = { need: 0, work: 1, wait: 2, dock: 3 }
    const named = rows.length > 5 ? [...rows].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9)).slice(0, 4) : rows
    const ordered = [...rows.filter(row => named.includes(row)), ...rows.filter(row => !named.includes(row))]

    return ordered.slice(0, 30).map(row => ({ name: squadName(row.name, NAME_ROOM), status: row.status === 'gone' ? 'wait' : row.status }))
  } catch (error) {
    ship.fleetFault = `点名：${String(error).slice(0, 120)}`

    return undefined
  }
}

/** Renews this session's row and reads the others', drawing nothing. */
async function gather($: EngineInterface): Promise<void> {
  if (!ship.hasFleet) {
    return
  }
  await tell($)
  const squads = await muster($)

  if (squads !== undefined) {
    ship.fleet = squads
    ship.fleetKey = JSON.stringify(squads)
  }
}

/**
 * The session is over, or wants no part in the fleet: its row says so, and the
 * others stop showing it at their next look. `id` is the session that ended,
 * or `undefined` for the one running now.
 */
async function farewell($: EngineInterface, id: string | undefined): Promise<void> {
  // Any row still on its way is too late to say otherwise.
  ship.epoch += 1
  const born = ship.born
  const wasOut = ship.isOut
  // After a `/clear` the process goes on as a new conversation, with nothing
  // asked of it yet.
  ship.isOut = false
  ship.id = ''
  ship.born = 0
  ship.title = ''
  ship.firstWords = ''
  ship.savedName = ''
  ship.needs.clear()
  ship.hasFailed = false
  ship.told = { status: '', name: '', at: 0 }
  try {
    const dir = await fleetFolder($)
    const who = id ?? (await $.session.id())

    if (dir !== '' && who !== '' && wasOut) {
      await $.fs.write(`${dir}/${who}.json`, JSON.stringify({ id: who, name: '', status: 'gone', born, at: await $.clock.now(), active: 0, warm: 0 } satisfies Row))
    }
  } catch {
    // The row grows stale on its own.
  }
}

/**
 * The fleet's turn of the clock: this session's row is renewed, the others are
 * read, and the backdrop is drawn again only when what it shows of them has
 * changed and nothing on it is in the middle of moving.
 */
async function sync($: EngineInterface): Promise<void> {
  if (!ship.hasFleet) {
    return
  }
  // No surface has ever asked this session for a drawing: there is nobody to
  // show the others to, so they are not read.
  if (ship.asks === 0) {
    await tell($)

    return
  }
  await gather($)
  const now = await $.clock.now()

  // Checked and claimed in one breath, so no other drawing slips in between.
  if (ship.fleetKey === ship.fleetShown || ship.settle !== undefined || now - ship.viewAt < 3000) {
    return
  }
  const squads = ship.fleet
  ship.fleetShown = ship.fleetKey
  try {
    await update($, view, (was): View => ({ ...was, fleet: squads }))
  } catch (error) {
    // Not shown after all: the next look draws it.
    ship.fleetShown = ''
    ship.fleetFault = `重画：${String(error).slice(0, 120)}`
  }
}

/**
 * Something stands open with the person (`1`), one such thing is settled
 * (`-1`), or everything whose key begins so is (`0`). The others hear when
 * the session starts or stops calling.
 */
function flag($: EngineInterface, key: string, change: 1 | -1 | 0): void {
  const had = ship.needs.size

  if (change === 1) {
    ship.needs.set(key, (ship.needs.get(key) ?? 0) + 1)
  } else if (change === -1) {
    const left = (ship.needs.get(key) ?? 0) - 1

    if (left > 0) ship.needs.set(key, left)
    else ship.needs.delete(key)
  } else {
    for (const open of [...ship.needs.keys()]) {
      if (open.startsWith(key)) ship.needs.delete(open)
    }
  }
  if (had > 0 !== ship.needs.size > 0) {
    void tell($)
  }
}

/** The session's title, from the last lines of its own record, where the app keeps it. */
async function learnTitle($: EngineInterface, transcript: string): Promise<void> {
  if (!ship.hasFleet || transcript === '') {
    return
  }
  try {
    const tail = await $.process.run(['tail', '-c', '65536', transcript], { timeoutMs: 5000 })
    const titles = [...tail.stdout.matchAll(/"customTitle":"((?:[^"\\]|\\.)*)"/g)]
    const last = titles[titles.length - 1]?.[1]
    const title = last === undefined ? '' : String(JSON.parse(`"${last}"`))

    // A conversation renamed later goes by its new name.
    if (title !== '' && title !== ship.title) {
      ship.title = title
      await tell($)
    }
  } catch (error) {
    ship.fleetFault = `读标题：${String(error).slice(0, 120)}`
  }
}

/** Clears out rows no session has touched for a day, so the folder stays a handful of files. */
async function forget($: EngineInterface): Promise<void> {
  try {
    const dir = await fleetFolder($)

    if (dir === '') {
      return
    }
    const now = await $.clock.now()
    const old = (await $.fs.list(dir)).filter(entry => entry.kind === 'file' && ROW_FILE.test(entry.name) && now - entry.mtimeMs > FORGET_MS)

    if (old.length > 0) {
      await $.process.run(['rm', '-f', ...old.slice(0, 200).map(entry => `${dir}/${entry.name}`)], { timeoutMs: 5000 })
    }
  } catch {
    // Old rows are skipped over anyway; clearing them is only tidiness.
  }
}

/**
 * Once a view's words have drifted off and its fading layers are gone, draws
 * it again clean: on a surface that plays no animation the words would
 * otherwise stay, and on one that does, a layer that has faded would go on
 * costing a little.
 */
async function settle($: EngineInterface, at: number): Promise<void> {
  if (ship.viewAt !== at) {
    return
  }
  if (ship.phase === 'work') {
    ship.settle = undefined

    return
  }
  const now = await $.clock.now()

  // A newer view may have come up while the clock was read: it books its own.
  if (ship.viewAt !== at) {
    return
  }
  // Until here the fleet holds off, so this drawing is the one that takes it.
  ship.settle = undefined
  ship.viewAt = now
  ship.settles += 1
  const squads = ship.fleet
  ship.fleetShown = ship.fleetKey
  await update($, view, (was): View => ({ ...was, from: was.phase, fromLevel: was.level, at: now, poem: null, progressAt: 0, fleet: squads }))
  note($, 'settle')
}

/** Puts a new view up, and books the redraw that clears what it leaves behind. */
async function enter($: EngineInterface, change: (was: View, now: number) => View): Promise<void> {
  const now = await $.clock.now()
  const made: { view?: View } = {}
  ship.settle?.cancel()
  ship.settle = undefined
  // Every new view takes the fleet as last read, so no drawing is made for
  // the fleet alone while this one is still coming in.
  const squads = ship.fleet
  ship.fleetShown = ship.fleetKey
  await update($, view, (was): View => {
    made.view = { ...change(was, now), fleet: squads }
    return made.view
  })
  const shown = made.view

  if (shown === undefined) {
    return
  }
  ship.phase = shown.phase
  ship.level = shown.level
  ship.viewAt = shown.at
  const after = settlesAfter(shown, POEMS)

  if (after > 0) {
    const at = shown.at
    ship.settle = $.clock.after(after * 1000 + 600, () => {
      void settle($, at).catch(() => undefined)
    })
  }
  // How the session stands may have changed with the view: the others hear.
  void tell($)
}

/** Into harbour: the chart gives way to the horizon, with one poem. */
async function dock($: EngineInterface): Promise<void> {
  if (ship.phase !== 'cruise') {
    return
  }
  ship.phase = 'dock'
  ship.docks += 1
  await enter($, (was, now) => ({
    ...was,
    phase: 'dock',
    level: 0,
    from: 'cruise',
    fromLevel: was.level,
    at: now,
    poem: nextPoem(),
    poemAt: now,
    progressAt: 0,
  }))
  note($, 'dock')
}

/** Harbour is a matter of how long nothing has happened. */
async function dockIfCold($: EngineInterface): Promise<void> {
  if (ship.phase === 'cruise' && (await $.clock.now()) - ship.lastActive >= ship.coolMs) {
    await dock($)
  }
}

/** The jump is over, or a new one begins: no poem booked for the old one may still come. */
function stopVerse(): void {
  ship.verseWatch?.cancel()
  ship.verseWatch = undefined
  ship.verseSoon?.cancel()
  ship.verseSoon = undefined
}

/**
 * The next poem of a jump, if someone is there to read it. Asked for by the
 * clock each minute, and by a drawing when the person comes back to a jump
 * whose poem has grown old.
 */
async function nextVerse($: EngineInterface): Promise<void> {
  if (!ship.isUnderWay || ship.phase !== 'work') {
    return
  }
  // Nothing has asked for a drawing since the last poem went up: the
  // conversation is not on screen. The poems wait until it is.
  if (ship.draws === ship.verseDraws) {
    return
  }
  const now = await $.clock.now()

  // The clock and a drawing may both ask within a moment: one poem a minute.
  if (!ship.isUnderWay || ship.phase !== 'work' || (ship.hasVerse && now - ship.verseAt < VERSE_EVERY_MS - 1500)) {
    return
  }
  const before = { at: ship.verseAt, draws: ship.verseDraws, has: ship.hasVerse }
  ship.verseAt = now
  ship.verseDraws = ship.draws
  ship.hasVerse = true
  // The minute is counted from this poem, whoever asked for it.
  watchVerse($, VERSE_EVERY_MS)
  const poem = nextPoem()
  try {
    // Only the poem changes: the jump goes on as it was.
    await update($, view, (was): View => (was.phase === 'work' ? { ...was, poem, poemAt: now } : was))
    ship.verses += 1
  } catch {
    // Not written after all: the next drawing or the next minute tries again.
    ship.verseAt = before.at
    ship.verseDraws = before.draws
    ship.hasVerse = before.has
  }
}

/** Books the next poem of a jump: soon after it begins, then once a minute. */
function watchVerse($: EngineInterface, after: number): void {
  ship.verseWatch?.cancel()
  ship.verseWatch = $.clock.after(after, () => {
    ship.verseWatch = undefined

    if (!ship.isUnderWay || ship.phase !== 'work') {
      return
    }
    watchVerse($, VERSE_EVERY_MS)
    void nextVerse($).catch(() => undefined)
  })
}

/** Draws the standing view again from the start, with no words left over from before. */
async function redraw($: EngineInterface): Promise<void> {
  await enter($, (was, now) => ({ ...was, from: was.phase, fromLevel: was.level, at: now, poem: null, progressAt: 0 }))
}

/**
 * Reads what the person has set, which is kept in one place for every
 * conversation. Read at the start, and again whenever another conversation
 * changes something.
 */
async function loadSettings($: EngineInterface): Promise<void> {
  const minutes = Number(await $.store.get('coolMinutes'))

  if (Number.isFinite(minutes) && minutes > 0) {
    ship.coolMs = minutes * 60_000
  }
  ship.hasSound = (await $.store.get('sound')) !== false
  ship.isOn = (await $.store.get('on')) !== false
  ship.hasMark = (await $.store.get('mark')) === true
  const motion = await $.store.get('motion')
  ship.motion = motion === 'full' || motion === 'still' || motion === 'low' ? motion : 'calm'
  const lab = await $.store.get('lab')
  ship.lab = typeof lab === 'string' ? lab.split(',').map(flag => flag.trim()).filter(flag => flag !== '') : []
  const glass = (await $.store.get('glass')) as { blur?: unknown; opacity?: unknown } | false | undefined
  ship.glass = glass !== false && typeof glass?.blur === 'number' && typeof glass.opacity === 'number' ? { blur: glass.blur, opacity: glass.opacity } : false
  const veil = Number(await $.store.get('veil') ?? Number.NaN)
  ship.veil = Number.isFinite(veil) && veil >= 0 && veil <= 0.8 ? veil : 0.2
  const ground = Number(await $.store.get('ground') ?? Number.NaN)
  ship.ground = Number.isFinite(ground) && ground >= 0 && ground <= GROUND_MOST ? Math.round(ground) : GROUND
  const side = Number(await $.store.get('side'))

  if (Number.isFinite(side) && side >= -200 && side <= 60) {
    ship.side = side
  }
  ship.hasFleet = (await $.store.get('fleet')) !== false
  const warm = Number(await $.store.get('warmMinutes'))

  if (Number.isFinite(warm) && warm >= 1) {
    ship.warmMs = Math.min(warm, 24 * 60) * 60_000
  }
  ship.plan = readPlan(await $.store.get('voyage'))
  const since = Number(await $.store.get('since'))

  if (Number.isFinite(since) && since > 0) {
    ship.since = since
  } else {
    // First run on this machine: the voyage starts today until told otherwise.
    ship.since = await $.clock.now()
    await $.store.set('since', ship.since)
  }
  const rev = Number(await $.store.get('rev'))
  ship.rev = Number.isFinite(rev) ? rev : 0
}

/** The voyage in words, for the status and the answers to `from`, `to` and `port`. */
function voyageWords(): string {
  const plan = ship.plan
  const from = plan.from ?? `${dayOf(ship.since)}（装上那天）`
  const to = plan.to ?? '一年后'
  const ports = (plan.ports ?? []).map(p => `${p.name} ${p.date}`).join('，')

  return `航程：${from} 启航 → ${to} 抵达「${plan.dest ?? '终点'}」；港湾：${ports === '' ? '没有' : ports}`
}

/** Keeps a changed voyage and draws it. */
async function keepPlan($: EngineInterface, plan: Plan): Promise<string> {
  ship.plan = readPlan(plan)
  await keep($, 'voyage', ship.plan)
  await redraw($)

  return voyageWords()
}

/** Keeps a setting, and marks the settings as changed so every other conversation reads them again. */
async function keep($: EngineInterface, key: string, value: unknown): Promise<void> {
  await $.store.set(key, value)
  ship.rev = await $.clock.now()
  await $.store.set('rev', ship.rev)
}

/**
 * Another conversation changed a setting: this one takes it up too, and draws
 * itself again with it.
 */
async function followSettings($: EngineInterface): Promise<void> {
  try {
    const rev = Number(await $.store.get('rev'))

    if (!Number.isFinite(rev) || rev === 0 || rev === ship.rev) {
      return
    }
    const was = { isOn: ship.isOn, glass: JSON.stringify(ship.glass), hasFleet: ship.hasFleet, lab: ship.lab.join() }
    await loadSettings($)

    if (was.isOn !== ship.isOn || was.glass !== JSON.stringify(ship.glass) || was.lab !== ship.lab.join()) {
      await applyLook($)
    }
    if (was.hasFleet && !ship.hasFleet) {
      await farewell($, undefined)
      ship.fleet = []
      ship.fleetKey = '[]'
    }
    await redraw($)
    note($, 'settings')
  } catch {
    // The settings as they stood are good enough until the next look.
  }
}


/**
 * A conversation is picked up again: how long it lay untouched decides
 * whether it is found on the chart or in harbour.
 */
async function pickUp($: EngineInterface, source: string, seconds: number | undefined, isExpired: boolean): Promise<void> {
  const known = typeof seconds === 'number' && seconds >= 0
  ship.pickedUp = `${source}，距上次回答 ${known ? `${Math.round(seconds)} 秒` : '未知'}${isExpired ? '，缓存已凉' : ''}`
  // Kept apart from the rest, which every session overwrites: the last
  // pick-up any session heard of, to check the engine does speak.
  void $.store.set('pickUp', { said: ship.pickedUp, hadStarted: ship.hasStarted }).catch(() => undefined)

  if (!known && !isExpired) {
    return
  }
  // The engine's word that the cache has gone cold counts for the full time.
  const idle = Math.max(known ? seconds * 1000 : 0, isExpired ? ship.coolMs : 0)
  ship.idleMs = idle

  if (!ship.hasStarted) {
    return
  }
  // The first view is already up, drawn as if the conversation were fresh
  // from use: put that right.
  ship.lastActive = Math.min(ship.lastActive, (await $.clock.now()) - idle)
  await dockIfCold($)
  note($, 'pickUp')
}

/** Every ten seconds: into harbour if the session has gone cold, then a look at the fleet. */
async function tick($: EngineInterface): Promise<void> {
  // Typing is the person at work on this conversation: it keeps the ship out
  // of harbour and the session warm, however long the message takes.
  if (ship.keys !== ship.keysSeen) {
    ship.keysSeen = ship.keys
    ship.lastActive = await $.clock.now()
  }
  await followSettings($)
  await dockIfCold($)
  await sync($)
}

/** The camera takes the place the draft's length calls for; typing leaves harbour. */
async function follow($: EngineInterface, length: number): Promise<void> {
  const level = levelFor(length)

  if (ship.phase === 'work' || (ship.phase === 'cruise' && ship.level === level)) {
    return
  }
  ship.lastActive = await $.clock.now()
  // Each time the chart comes back, the progress line shows for a moment.
  await enter($, (was, now) => ({
    ...was,
    phase: 'cruise',
    level,
    from: was.phase === 'work' ? 'cruise' : was.phase,
    fromLevel: was.level,
    at: now,
    poem: null,
    progressAt: was.phase === 'dock' ? now : 0,
  }))
  ship.follows += 1
  note($, 'follow')
}

/**
 * A keystroke. Only its count and the draft's length are kept here; the camera
 * follows once the typing has paused for half a second, or after three seconds
 * of typing without a pause. So a burst of keys costs the backdrop one new
 * drawing, and none of them waits on it.
 */
function noteDraft($: EngineInterface, length: number): void {
  ship.draft = length
  ship.keys += 1

  if (ship.draftWatch !== undefined || ship.phase === 'work') {
    return
  }
  let seen = ship.keys
  let waited = 0
  ship.draftWatch = $.clock.every(500, () => {
    waited += 1

    if (ship.keys !== seen && waited < 6) {
      seen = ship.keys
      return
    }
    ship.draftWatch?.cancel()
    ship.draftWatch = undefined
    void follow($, ship.draft).catch(() => undefined)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }
    await loadSettings($)
    ship.folder = await folderName($)
    ship.lastActive = await $.clock.now()
    // The first drawing already has the others on it.
    await gather($)
    // A conversation nothing has been asked of yet lies in harbour, ready to
    // leave; one picked up again is out on the chart, where it was.
    const isFresh = (await promptsSoFar($)) === 0
    // So does one picked up after its cache went cold: it has been lying
    // there all along.
    const isCold = ship.idleMs >= ship.coolMs

    if (ship.idleMs >= 0) {
      ship.lastActive -= ship.idleMs
    }
    await enter($, (_, now) => (isFresh || isCold ? { ...AT_REST, phase: 'dock', from: 'dock', at: now } : { ...AT_REST, at: now, progressAt: now }))
    ship.hasStarted = true
    ship.version = await readVersion($)
    await applyLook($)
    note($, 'session.start')
    void forget($)

    await $.command.register({
      name: 'voyage',
      description: '星空远征：看状态，或 from <日期> / to <日期> [名字] / port <日期> <名字> | clear / dock / poem / side <偏移> / fleet on|off / warm <分钟> / motion low|full|calm|still / glass off|<模糊> <遮罩> / veil <深浅> / ground <像素> / on / off / cool <分钟> / sound on|off',
    })
    $.clock.every(MUSTER_MS, () => {
      void tick($).catch(() => undefined)
    })

    return next(e)
  })

  // Not awaited: the editor's answer goes straight back to it, and the camera
  // hears of the key on the side.
  on('prompt.edit', ($, e, next) => {
    noteDraft($, e.text.length - (e.end - e.start) + e.inputText.length)

    return next(e)
  })

  on('prompt.change', ($, e, next) => {
    noteDraft($, e.text.length)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // A subagent's turn is not the ship's: only the main loop jumps.
    if (e.agentId !== undefined) {
      return next(e)
    }
    ship.turns += 1
    // Given something to do, the session is a squad out in the field.
    ship.isOut = true
    ship.hasFailed = false
    ship.needs.clear()
    ship.draftWatch?.cancel()
    ship.draftWatch = undefined
    ship.draft = 0
    ship.phase = 'work'
    ship.lastActive = await $.clock.now()
    stopVerse()
    ship.isUnderWay = true
    ship.jumpAt = ship.lastActive
    ship.verseAt = ship.lastActive
    ship.hasVerse = false
    ship.verseDraws = ship.draws
    watchVerse($, VERSE_FIRST_MS)
    await enter($, (was, now) => ({
      ...was,
      phase: 'work',
      level: 0,
      from: was.phase,
      fromLevel: was.phase === 'cruise' ? was.level : 0,
      at: now,
      poem: null,
      progressAt: 0,
    }))
    play($, 'sounds/depart.wav')
    note($, 'turn.start')

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)

    if (e.agentId !== undefined) {
      // A subagent's loop is over: nothing it asked is still open.
      flag($, `ask|${e.agentId}|`, 0)
      flag($, `permit|${e.agentId}|`, 0)

      return done
    }
    // Before anything is waited on: from here no poem of the jump may go up.
    ship.isUnderWay = false
    stopVerse()
    ship.lastActive = await $.clock.now()
    ship.hasFailed = e.reason === 'error' || e.reason === 'refusal'
    ship.needs.clear()
    // Read the fleet now, so the arrival is drawn with it and not again for it.
    await gather($)
    await enter($, (was, now) => ({
      ...was,
      phase: 'cruise',
      level: 0,
      from: 'work',
      fromLevel: 0,
      at: now,
      poem: nextPoem(),
      poemAt: now,
      progressAt: now,
    }))

    if (e.reason === 'answer') {
      play($, 'sounds/arrive.wav')
    }
    note($, 'turn.complete')

    return done
  })

  // ---- what the others are told of this session

  // The engine says how long a conversation picked up again had lain
  // untouched. Whether it says so before or after `session.start` is its
  // business: both orders end in harbour for one gone cold.
  on('classic.SessionStart', ($, e, next) => {
    void pickUp($, e.source, e.seconds_since_last_response, e.prompt_cache_likely_expired === true).catch(() => undefined)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (ship.hasFleet) {
      await farewell($, e.sessionId)
    }

    return next(e)
  })

  on('classic.UserPromptSubmit', ($, e, next) => {
    if (typeof e.session_title === 'string' && e.session_title !== '') {
      ship.title = e.session_title
    }
    // Until the app has named the conversation, it goes by how it began.
    if (ship.firstWords === '' && !/^\s*[/<]/.test(e.prompt)) {
      ship.firstWords = e.prompt.trim().slice(0, 40)
    }

    return next(e)
  })

  on('classic.Stop', ($, e, next) => {
    void learnTitle($, e.transcript_path)

    return next(e)
  })

  // A question or a plan put to the person holds its loop until they answer:
  // the others show this session calling. Any other call in that loop means
  // the loop has moved on, whatever became of the question. Never awaited:
  // the call is not ours to hold.
  on('tool.call', ($, e, next) => {
    const loop = e.agentId ?? 'main'

    if (e.tool === 'AskUserQuestion' || e.tool === 'ExitPlanMode') {
      ship.questions += 1
      flag($, `ask|${loop}|`, 1)
    } else if (ship.needs.size > 0) {
      flag($, `ask|${loop}|`, 0)
    }

    return next(e)
  })

  on('classic.PermissionRequest', ($, e, next) => {
    ship.permits += 1
    flag($, `permit|${e.agent_id ?? 'main'}|${e.tool_name}`, 1)

    return next(e)
  })

  on('classic.PermissionDenied', ($, e, next) => {
    flag($, `permit|${e.agent_id ?? 'main'}|${e.tool_name}`, -1)

    return next(e)
  })

  on('classic.PostToolUse', ($, e, next) => {
    if (ship.needs.size > 0) {
      const loop = e.agent_id ?? 'main'
      flag($, `permit|${loop}|${e.tool_name}`, -1)

      if (e.tool_name === 'AskUserQuestion' || e.tool_name === 'ExitPlanMode') flag($, `ask|${loop}|`, 0)
    }

    return next(e)
  })

  on('classic.PostToolUseFailure', ($, e, next) => {
    if (ship.needs.size > 0) {
      const loop = e.agent_id ?? 'main'
      flag($, `permit|${loop}|${e.tool_name}`, -1)

      if (e.tool_name === 'AskUserQuestion' || e.tool_name === 'ExitPlanMode') flag($, `ask|${loop}|`, 0)
    }

    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    const isOurs = e.props.scene === SCENE && e.props.plugin === $.plugin.name
    ship.asks += 1
    ship.lastAsk = `surface=${e.surface} scene=${e.props.scene} plugin=${e.props.plugin}`

    if (!isOurs || (e.surface !== 'desktop' && e.surface !== 'mobile')) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    const standing = await read($, view)
    ship.draws += 1
    const drawnAt = await $.clock.now()

    // The person is back at a jump whose poem went up while nobody looked, or
    // never did: one comes right after this drawing, not at the next minute.
    if (
      standing.phase === 'work' &&
      ship.isUnderWay &&
      ship.verseSoon === undefined &&
      (ship.hasVerse ? drawnAt - ship.verseAt >= VERSE_EVERY_MS : drawnAt - ship.jumpAt >= VERSE_FIRST_MS)
    ) {
      ship.verseSoon = $.clock.after(400, () => {
        ship.verseSoon = undefined
        void nextVerse($).catch(() => undefined)
      })
    }
    const mark = ship.hasMark ? `${{ cruise: '巡航', work: '穿梭', dock: '入港' }[standing.phase]} · 档位 ${standing.level} · 第 ${ship.draws} 幅` : ''
    const shown = labView(standing, drawnAt)
    const motion = motionNow()
    // With the app's glass on, the app lays its own veil; with it off, the scene does.
    const isBare = ship.glass === false || ship.lab.includes('noglass')
    const veil = isBare ? ship.veil : 0
    // The app's slab behind the message box is there only with the glass off,
    // and so is the ground that hides it.
    const ground = isBare ? ship.ground : 0
    const source = scene(shown, drawnAt, { voyage: voyageOf(ship.plan, ship.since || drawnAt), poems: POEMS, motion, mark, side: ship.side, veil, ground, lab: ship.lab })

    // A calm scene drawn while something is still playing is drawn once more,
    // still, at the moment it has played out. Only a drawing books this, so a
    // conversation nobody is looking at books nothing.
    // When a redraw is already booked to clear the view's words away, that
    // one is the still one.
    if (motion === 'calm' && ship.settle === undefined) {
      const quiet = quietAt(shown, POEMS)

      if (quiet > drawnAt) {
        ship.calm?.cancel()
        ship.calm = $.clock.after(quiet - drawnAt + 250, () => {
          ship.calm = undefined
          $.ui.invalidate('ui.render')
        })
      }
    }
    if (ship.lab.length > 0) {
      void reportDraw($, standing, shown, drawnAt, source.length).catch(() => undefined)
    }

    // One Svg and nothing around it: the app lets a backdrop move only when it
    // is a single drawing.
    return <Svg source={source} alt={describe(shown)} isInteractive />
  })

  on('command.run', { command: 'voyage' }, async ($, e) => {
    const [word = '', value = '', second = ''] = e.args.trim().split(/\s+/)

    if (word === 'from') {
      if (value === 'reset') {
        return { text: await keepPlan($, { ...ship.plan, from: undefined }) }
      }

      if (parseDay(value) === undefined) {
        return { text: `用法：/voyage from <YYYY-MM-DD>，启航日，比如 /voyage from 2024-09-01。/voyage from reset 改回装上那天。\n${voyageWords()}` }
      }

      return { text: await keepPlan($, { ...ship.plan, from: value }) }
    }

    if (word === 'to') {
      const dest = e.args.trim().split(/\s+/).slice(2).join(' ')

      if (value === 'reset') {
        return { text: await keepPlan($, { ...ship.plan, to: undefined, dest: undefined }) }
      }

      if (parseDay(value) === undefined) {
        return { text: `用法：/voyage to <YYYY-MM-DD> [终点名]，抵达日和它叫什么（最多 ${DEST_ROOM} 个字），比如 /voyage to 2028-06-30 毕业；/voyage to reset 改回一年后。\n${voyageWords()}` }
      }

      return { text: await keepPlan($, { ...ship.plan, to: value, dest: dest === '' ? ship.plan.dest : dest }) }
    }

    if (word === 'port') {
      const ports = ship.plan.ports ?? []

      if (value === 'clear') {
        return { text: await keepPlan($, { ...ship.plan, ports: [] }) }
      }

      if (value === 'remove' && second !== '') {
        return { text: await keepPlan($, { ...ship.plan, ports: ports.filter(p => p.name !== second) }) }
      }
      const name = e.args.trim().split(/\s+/).slice(2).join(' ')

      if (parseDay(value) === undefined || name === '') {
        return { text: `用法：/voyage port <YYYY-MM-DD> <港湾名>，在航线上加一个港湾（最多 ${PORTS_MOST} 个，名字最多 ${PORT_ROOM} 个字），比如 /voyage port 2026-03-01 中期；同一天再设一次就换名字。/voyage port remove <港湾名> 去掉一个，/voyage port clear 全部去掉。只有落在启航和抵达之间的港湾会画出来。\n${voyageWords()}` }
      }
      const kept = ports.filter(p => p.date !== value)

      if (kept.length >= PORTS_MOST) {
        return { text: `港湾最多 ${PORTS_MOST} 个，先用 /voyage port remove <港湾名> 去掉一个。` }
      }

      return { text: await keepPlan($, { ...ship.plan, ports: [...kept, { date: value, name }] }) }
    }

    if (word === 'dock') {
      await dock($)

      return { text: '入港。' }
    }

    if (word === 'poem') {
      if (ship.phase !== 'work') {
        await enter($, (was, now) => ({ ...was, from: was.phase, fromLevel: was.level, at: now, poem: nextPoem(), poemAt: now, progressAt: 0 }))
      }

      return { text: '来一句。' }
    }

    if (word === 'side') {
      const x = Number(value)

      if (value === '' || !(x >= -200 && x <= 60)) {
        return { text: `用法：/voyage side <偏移>，-200 到 60，负数往对话那边挪，正数往窗口右边缘挪；现在是 ${ship.side}，默认 0。诗句、穿梭时的进度轴和小队都排在这一列，这一列居中在正文和窗口右边缘之间。` }
      }
      ship.side = x
      await keep($, 'side', x)
      await redraw($)

      return { text: `侧栏偏移：${x}。` }
    }

    if (word === 'fleet') {
      if (value !== 'on' && value !== 'off') {
        return { text: '用法：/voyage fleet on（显示其他对话的小队，并让别的对话看到这一个）或 /voyage fleet off' }
      }
      // Off first, so nothing writes this session's row back after its goodbye.
      ship.hasFleet = value === 'on'

      // Back on in a conversation that has already been given work: out again.
      if (ship.hasFleet && ship.turns > 0) {
        ship.isOut = true
      }

      if (!ship.hasFleet) {
        await farewell($, undefined)
        ship.fleet = []
        ship.fleetKey = '[]'
      }
      await keep($, 'fleet', ship.hasFleet)
      await gather($)
      await redraw($)

      return { text: ship.hasFleet ? '小队：开。' : '小队：关，这个对话也不再向别的对话上报。' }
    }

    if (word === 'warm') {
      const minutes = Number(value)

      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) {
        return { text: `用法：/voyage warm <分钟>，这个对话在最后一次活动之后多久内还算一支在外的小队；现在是 ${Math.round(ship.warmMs / 60_000)} 分钟。` }
      }
      ship.warmMs = minutes * 60_000
      await keep($, 'warmMinutes', minutes)
      ship.told = { status: '', name: '', at: 0 }
      await tell($)

      return { text: `最后一次活动后 ${minutes} 分钟内，别的对话都会显示这支小队。` }
    }

    if (word === 'cool') {
      const minutes = Number(value)

      if (!Number.isFinite(minutes) || minutes <= 0) {
        return { text: '用法：/voyage cool <分钟>，比如 /voyage cool 60' }
      }
      ship.coolMs = minutes * 60_000
      await keep($, 'coolMinutes', minutes)

      return { text: `闲置 ${minutes} 分钟后入港。` }
    }

    if (word === 'glass') {
      if (value === 'off') {
        ship.glass = false
        await keep($, 'glass', false)
        await applyLook($)
        await redraw($)

        return { text: '毛玻璃：关。侧边栏和卡片恢复成不透明，背景只在对话区域后面；画面自己加一层薄遮罩（/voyage veil 调深浅），底部留出一块地面给输入区（/voyage ground 调高低）。这是最省内存的设置。' }
      }
      const blur = Number(value)
      const opacity = Number(second)

      if (value === '' || second === '' || !(blur >= 0 && blur <= 64) || !(opacity >= 0 && opacity <= 1)) {
        return { text: '用法：/voyage glass off（默认，最省内存），或 /voyage glass <模糊 0–64> <遮罩 0–1>，比如 /voyage glass 0 0.2。打开毛玻璃后侧边栏和卡片会透出背景，在 5K 窗口上约多占 0.5 GB 图形内存。' }
      }
      ship.glass = { blur, opacity }
      await keep($, 'glass', ship.glass)
      await applyLook($)
      await redraw($)

      return { text: `毛玻璃：模糊 ${blur}，遮罩 ${opacity}。约多占 0.5 GB 图形内存；/voyage glass off 关闭。` }
    }

    if (word === 'veil') {
      const veil = Number(value)

      if (value === '' || !(veil >= 0 && veil <= 0.8)) {
        return { text: `用法：/voyage veil <0–0.8>，背景上那层薄遮罩的深浅，越大背景越淡、文字越清楚；现在是 ${ship.veil}，默认 0.2。毛玻璃打开时由 App 自己加遮罩，这个不起作用。` }
      }
      ship.veil = veil
      await keep($, 'veil', veil)
      await redraw($)

      return { text: `遮罩：${veil}。` }
    }

    if (word === 'ground') {
      const ground = Number(value)

      if (value === '' || !(ground >= 0 && ground <= GROUND_MOST)) {
        return {
          text: `用法：/voyage ground <0–${GROUND_MOST}>，画面底部让给输入区的高度（像素，从窗口底边量起）。毛玻璃关着时，App 会在输入区后面垫一块不透明的底板，画面把底部这么高画成同样的颜色，底板就看不出来；输入区比它高时会露出一道浅边，调大即可。现在是 ${ship.ground}，默认 ${GROUND}；0 表示不留。毛玻璃打开时没有底板，这个不起作用。`,
        }
      }
      ship.ground = Math.round(ground)
      await keep($, 'ground', ship.ground)
      await redraw($)

      return { text: ship.ground === 0 ? '地面：不留。输入区后面的底板会露出来。' : `地面：底部 ${ship.ground} 像素。` }
    }

    if (word === 'on' || word === 'off') {
      ship.isOn = word === 'on'
      await keep($, 'on', ship.isOn)
      await applyLook($)

      return { text: ship.isOn ? '皮肤：开。' : '皮肤：关，回到 App 自己的样子。' }
    }

    if (word === 'lab') {
      // For measuring only: takes the scene apart, or holds one scene up.
      const flags = value === '' || value === 'off' ? '' : e.args.trim().split(/\s+/).slice(1).join(',')
      ship.lab = flags === '' ? [] : flags.split(',').filter(flag => flag !== '')
      await keep($, 'lab', flags)
      await applyLook($)
      await redraw($)

      return { text: flags === '' ? '实验开关：全部关闭。' : `实验开关：${ship.lab.join()}。用 /voyage lab off 关闭。` }
    }

    if (word === 'motion') {
      if (value !== 'low' && value !== 'full' && value !== 'still' && value !== 'calm') {
        return { text: '用法：/voyage motion low（每秒重画几次）、full（顺滑，每秒六十次）、calm（有事才动：穿梭开头、抵达、诗句出现和散去时动，其余时间静止）或 still（完全不动）' }
      }
      ship.motion = value
      await keep($, 'motion', value)
      await redraw($)

      return { text: { full: '动效：顺滑。', low: '动效：省电。', calm: '动效：有事才动。', still: '动效：静止。背景不再播放动画，只在状态变化时换一幅画。' }[value] }
    }

    if (word === 'mark') {
      ship.hasMark = value !== 'off'
      await keep($, 'mark', ship.hasMark)
      await redraw($)

      return { text: ship.hasMark ? '角标：开。' : '角标：关。' }
    }

    if (word === 'sound') {
      ship.hasSound = value !== 'off'
      await keep($, 'sound', ship.hasSound)

      return { text: ship.hasSound ? '音效：开。' : '音效：关。' }
    }
    const now = await $.clock.now()
    const standing = await read($, view)
    const phase = { cruise: '巡航', work: '穿梭', dock: '入港' }[standing.phase]

    return {
      text: [
        `星空远征 · 当前：${phase}（镜头档位 ${standing.level}）`,
        `皮肤是否被绘制：${ship.drawn}`,
        `背景被请求绘制 ${ship.asks} 次，最近一次：${ship.lastAsk}`,
        `本次加载以来：背景重绘 ${ship.draws} 次，听到打字 ${ship.keys} 次，回合 ${ship.turns} 次`,
        `镜头跟随 ${ship.follows} 次，清场 ${ship.settles} 次，入港 ${ship.docks} 次，穿梭途中换诗 ${ship.verses} 次`,
        `动效：${{ full: '顺滑', low: '省电', calm: '有事才动', still: '静止（不播动画）' }[ship.motion]}${ship.lab.length > 0 ? `（实验开关：${ship.lab.join()}）` : ''}；毛玻璃：${ship.glass === false ? `关（画面自带遮罩 ${ship.veil}，底部留地面 ${ship.ground} 像素）` : `模糊 ${ship.glass.blur}，遮罩 ${ship.glass.opacity}`}；音效${ship.hasSound ? '开' : '关'}`,
        `闲置 ${Math.round(ship.coolMs / 60_000)} 分钟入港，已闲置 ${Math.round((now - ship.lastActive) / 60_000)} 分钟`,
        ship.hasFleet
          ? `小队：看到 ${ship.fleet.length} 支${ship.fleet.length > 0 ? `（${ship.fleet.map(squad => `${squad.name}·${STANCE[squad.status]}`).join('，')}）` : ''}；${ship.isOut ? `本对话上报为「${calledAs()}·${STANCE[stance()]}」，活动后 ${Math.round(ship.warmMs / 60_000)} 分钟内显示` : '本对话还没发过消息，不算小队'}`
          : '小队：关',
        `小队通道：上报 ${ship.tells} 次，点名 ${ship.musters} 次，听到提问 ${ship.questions} 次、权限请求 ${ship.permits} 次${ship.fleetFault === '' ? '' : `；最近一次出错：${ship.fleetFault}`}`,
        `侧栏偏移：${ship.side}`,
        `重开这个对话时引擎的说法：${ship.pickedUp}`,
        voyageWords(),
        '子命令：from <YYYY-MM-DD>、to <YYYY-MM-DD> [终点名]、port <YYYY-MM-DD> <港湾名>、port remove <港湾名>、port clear、dock、poem、side <偏移>、fleet on|off、warm <分钟>、motion low|full|calm|still、glass off|<模糊> <遮罩>、veil <深浅>、ground <像素>、on / off、cool <分钟>、sound on|off、mark on|off',
      ].join('\n'),
    }
  })
}
