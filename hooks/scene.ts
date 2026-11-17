// The backdrop of 星空远征, as SVG text. Pure functions of the view and the clock.
//
// How the desktop app draws it decides how it is written:
//
// - It always draws a still version first, with every animation taken out. So
//   each layer's own style is where it ends up, and an animation only plays the
//   way in: the still drawing is a finished picture of the state.
// - It lets a backdrop move only when the SVG passes a strict check, and then
//   plays it as an image. The check allows `@media` on colour scheme and
//   reduced motion alone, a short list of CSS functions, no `vector-effect` or
//   `shape-rendering`, no viewport units, no `data:` and no `url()` but
//   `url(#id)`. `tests/voyage.test.tsx` holds every state to those rules.
// - While it plays, the app measures each frame and stops a scene that costs
//   too much or flashes. So slow loops move in steps on a beat the whole scene
//   shares (the picture is redrawn a few times a second, not sixty), and a
//   layer that has faded out stops moving.
// - The surface runs no script in a scene, so every state is its own document
//   and every timeline starts from "how long ago did this begin".

import { EM, GLYPHS } from './glyphs'
import type { Squad, SquadStatus, View } from '../types'

/** The voyage: where it starts, where it ends, and the harbours on the way. */
export type Voyage = {
  start: number
  end: number
  endLabel: string
  /** What the end is called, as in “距××还有 N 天”. */
  dest: string
  harbors: readonly { at: number; name: string }[]
}

export type Poem = readonly [line: string, source: string]

/**
 * How much the scene moves once the app lets it: `low` holds the slow loops to
 * a few drawings a second, `full` lets them run smooth, and `still` moves
 * nothing at all. A drawing with nothing to play is shown by the app as a
 * picture, with no moving stand-in laid over it: the cheapest a backdrop gets.
 *
 * `calm` moves while something is happening (the first seconds of a jump, an
 * arrival, a poem coming in or drifting off) and holds still the rest of the
 * time: `quietAt` says when a view has nothing left to play.
 */
export type Motion = 'low' | 'full' | 'still' | 'calm'

/** What `scene` draws with, beside the view and the clock. */
export type SceneOptions = {
  voyage: Voyage
  poems: readonly Poem[]
  motion: Motion
  /** A small line in the corner naming what is drawn; `''` for none. */
  mark?: string
  /**
   * How far the side column is moved from where it stands, in the strip's own
   * units: below zero toward the conversation, above toward the window's
   * edge. 0 when left out.
   */
  side?: number
  /**
   * How much of the page's own colour is laid over the scene, 0 to 1, so the
   * conversation reads easily on it. The app can do this with its glass
   * panels, at a price in graphics memory the scene's own veil does not pay.
   * 0 when left out.
   */
  veil?: number
  /**
   * How much of the window's foot the scene gives up to the page's own colour,
   * in the window's pixels. With its glass off the app lays an opaque slab of
   * that colour behind the message box, from the box's top edge to the foot of
   * the window and as wide as the conversation's pane, and the scene is told
   * neither that it is there nor how tall it is. A slab over a flat ground of
   * its own colour cannot be seen; one that cuts a glow or a horizon is a
   * black box. So everything the scene draws stands above this line: the
   * harbour's world rises to it, and the chart and the jump dissolve into it.
   * 0 or left out for no ground, as with the app's glass on.
   */
  ground?: number
  /**
   * Switches for taking the scene apart, to measure what each part costs the
   * app: `bare` (nothing drawn), `nostars`, `noglow` (no soft lights),
   * `noside` (no side column), `nosquads`, `flat` (the scene alone as one
   * drawing: no strips, and nothing of what hangs from the window's foot).
   * None in ordinary use.
   */
  lab?: readonly string[]
}

const W = 1600
const H = 900
const SPARK = 'M0 -9L2 -2L9 0L2 2L0 9L-2 2L-9 0L-2 -2Z'
const SHIP = 'M8 0L-6 -4.6L-3 0L-6 4.6Z'
/** How far the camera has closed on the ship at each typing level. */
const ZOOM = [0, 0.4, 0.7, 1] as const
const DIVE = 2.7
/** Where the camera brings the ship as it closes in. */
const FOCUS = { x: 800, y: 490 }
/** The tilt of the orbits' plane on the chart, and how far it is squashed. */
const TILT = -20
const SQUASH = 0.39
const SUN = { x: 560, y: 590 }
/**
 * The side column is a drawing of its own, `STRIP` wide and as tall as the
 * scene, hung just right of the conversation's text, whatever the window's
 * shape. A column placed in the scene itself slides under the text as the
 * window gets shorter, and one set further out, in the margin's middle or
 * against the window's edge, is what a panel opened on the right covers
 * first. `SIDE` is the column's centre line within the strip.
 */
const STRIP = 200
const SIDE = 112
/** Where the strip's drawing begins: the poem's left edge, the part nearest the text. */
const VERSE_LEFT = 46
/**
 * How far the strip's left edge stands right of the window's middle, in the
 * window's own pixels: half the conversation's text column, about 800 wide
 * (measured on a 2560-wide window), and a gap. The column is as wide on every
 * screen that has room for it, so this is not scaled. A panel opened beside
 * the conversation moves the column, and no drawing is told: here, hard by the
 * text, the side column is the last thing a panel on the right reaches.
 */
const TEXT_HALF = 400
const VERSE_GAP = 24
/**
 * The side column from the top: the poem, and to its right a lane for the
 * voyage line of a jump, the progress line or the harbour's greeting. All of
 * it stands in the upper half, clear of the ground.
 */
const VERSE_TOP = 120
const VERSE_ROOM = 344
const LANE_TOP = VERSE_TOP + 22
/** The voyage line of a jump runs down the strip's outer edge, beside the verse. */
const GAUGE_X = SIDE + 70
/** The lane the small words stand in, at rest and in harbour: where the voyage line runs during a jump. */
const LANE_X = SIDE + 74
/** How long a poem holds before it drifts off, in seconds: a moment at rest, most of a minute under way. */
const HOLD = 9
/** How much lower each column of a poem begins than the one before it, in cells. */
const STAGGER = 0.6
/** How far under the poem's lowest glyph its source begins. */
const SOURCE_GAP = 10
const HOLD_UNDER_WAY = 52
/** How long the streaks of a jump play before a calm scene holds them still, in seconds. */
const JUMP_PLAYS = 15

/** How far the chart and the jump are raised when the scene has a ground, in the scene's units: what stood at its foot would lie under it. */
const LIFT = 150
/** The height over which the scene dissolves into the ground, in pixels. */
const FADE = 150
/** How far the harbour's horizon falls from its middle to the window's edge, in pixels, on a window of any width. */
const SAG = 56
/** How far below its horizon the small world's body still carries the sky's light, in pixels. */
const INNER = 24
/** The land's own width, stretched to the window's; and the radius that gives `SAG` across it. */
const SPAN = 2000
const WORLD = 8957
/** How high the small world stands when the scene has no ground to keep to, in pixels. */
const REST = 180
/** Where the harbour's voyage line begins and ends, as a part of the window's width from each side. */
const EDGE = 0.06

const f1 = (n: number): string => (Math.round(n * 10) / 10).toString()
const f2 = (n: number): string => (Math.round(n * 100) / 100).toString()

function rng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** How far along the voyage `now` is, and the days left. */
export function progress(voyage: Voyage, now: number): { done: number; daysLeft: number } {
  return {
    done: clamp01((now - voyage.start) / (voyage.end - voyage.start)),
    daysLeft: Math.max(0, Math.ceil((voyage.end - now) / 864e5)),
  }
}

// ---------------------------------------------------------------- timing

/**
 * The timing of a slow loop that began `since` seconds into its cycle.
 *
 * On `low` the loop moves in steps, and both its length and its phase are whole
 * beats: every loop in the scene then steps at the same instants, so the
 * picture is redrawn `fps` times a second however many things move in it.
 */
function loop(seconds: number, since: number, fps: number, motion: Motion, ease = 'linear'): string {
  const beat = 1 / fps
  const period = Math.max(beat, Math.round(seconds / beat) * beat)
  const phase = Math.round((((since % period) + period) % period) / beat) * beat
  const timing = motion === 'low' ? `steps(${Math.round(period / beat)})` : ease
  return `animation-duration:${f2(period)}s;animation-timing-function:${timing};animation-delay:-${f2(phase)}s`
}

/**
 * The way in for a layer that began `since` seconds ago. The layer's own style
 * is where it ends up: a surface that plays no animation shows that, and one
 * that does plays this first.
 */
function run(name: string, seconds: number, since: number, ease = 'ease'): string {
  return `animation:${name} ${seconds}s ${ease} backwards;animation-delay:${f1(-since)}s`
}

// ---------------------------------------------------------------- the route

const ROUTE = [
  [250, 800],
  [620, 830],
  [1120, 610],
  [1350, 220],
] as const
const ROUTE_D = 'M250 800C620 830 1120 610 1350 220'

function bezier(t: number): [number, number] {
  const u = 1 - t
  const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const
  let x = 0
  let y = 0
  ROUTE.forEach((p, i) => {
    x += p[0] * (k[i] ?? 0)
    y += p[1] * (k[i] ?? 0)
  })
  return [x, y]
}

// The route sampled once, by length: a ship at "80% of the way" stands at 80%
// of the line's length, as the dash that marks the travelled part does.
const SAMPLES = 400
const ALONG: { x: number; y: number; len: number }[] = []
{
  let len = 0
  let prev = bezier(0)
  for (let i = 0; i <= SAMPLES; i++) {
    const p = bezier(i / SAMPLES)
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1])
    ALONG.push({ x: p[0], y: p[1], len })
    prev = p
  }
}
const ROUTE_LEN = ALONG[SAMPLES]?.len ?? 1

function onRoute(fraction: number): { x: number; y: number; deg: number } {
  const want = ROUTE_LEN * clamp01(fraction)
  let i = ALONG.findIndex(p => p.len >= want)
  i = Math.min(SAMPLES - 1, Math.max(1, i))
  const a = ALONG[i - 1] ?? { x: 0, y: 0, len: 0 }
  const b = ALONG[i + 1] ?? ALONG[i] ?? a
  const at = ALONG[i] ?? a
  return { x: at.x, y: at.y, deg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI }
}

// ---------------------------------------------------------------- pieces

/**
 * A field of stars. With a `motion`, a few of them twinkle, slowly and
 * together; without one the field is still.
 */
function stars(seed: number, count: number, box: readonly [number, number, number, number], now: number, motion?: Motion): string {
  const r = rng(seed)
  let out = ''
  for (let i = 0; i < count; i++) {
    const x = box[0] + r() * box[2]
    const y = box[1] + r() * box[3]
    const k = r()
    const rad = k < 0.75 ? 0.7 + r() * 0.5 : k < 0.95 ? 1.2 + r() * 0.6 : 1.9 + r() * 0.7
    const opacity = f1(0.3 + r() * 0.6)
    const twinkles = r() < 0.06
    const offset = r() * 12
    const style = twinkles && motion !== undefined ? ` class="tw" style="${loop(6, now / 1000 + offset, 2, motion, 'ease-in-out')}"` : ''
    out += `<circle cx="${x | 0}" cy="${y | 0}" r="${f1(rad)}" opacity="${opacity}"${style}/>`
  }
  return `<g class="star">${out}</g>`
}

function ship(x: number, y: number, deg: number, flame: number): string {
  return `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(deg)})"><circle r="26" cx="-8" fill="url(#gFire)" opacity="${f1(0.1 + flame * 0.9)}"/><path class="flame" d="M-6 0L-22 -3.2L-22 3.2Z" style="transform:scaleX(${f1(0.15 + flame * 1.05)});opacity:${f1(0.15 + flame * 0.85)}"/><path class="ship" d="${SHIP}"/></g>`
}

/** Where the camera stands for a zoom: the ship drifts to the middle as it grows. */
function camera(zoom: number, shipAt: { x: number; y: number }): string {
  const k = Math.min(1, zoom)
  const s = Math.pow(3, zoom)
  const px = shipAt.x + (FOCUS.x - shipAt.x) * k
  const py = shipAt.y + (FOCUS.y - shipAt.y) * k
  return `translate(${f1(px - s * shipAt.x)}px,${f1(py - s * shipAt.y)}px) scale(${s.toFixed(3)})`
}

/**
 * The star chart: orbits, constellations, the route with its harbours, the ship.
 * Without a `motion` it is a copy on its way out: nothing in it moves, so it
 * costs nothing once it has faded.
 */
function chart(
  voyage: Voyage,
  now: number,
  o: { flame: number; motion?: Motion; labels?: string },
): { body: string; shipAt: { x: number; y: number } } {
  const { done } = progress(voyage, now)
  const seconds = now / 1000
  const radii = [180, 320, 480, 660]
  const periods = [90, 150, 240, 380]
  let rings = ''
  let planets = ''
  radii.forEach((radius, i) => {
    const period = periods[i] ?? 100
    // Where the planet is now comes from the clock and is drawn in, so a still
    // drawing has it in its place and a redraw leaves it where it was.
    const angle = (((seconds + period * 0.37 * (i + 1)) % period) / period) * 360
    rings += `<ellipse class="orbit" cx="${SUN.x}" cy="${SUN.y}" rx="${radius}" ry="${f1(radius * SQUASH)}" transform="rotate(${TILT} ${SUN.x} ${SUN.y})"/>`
    const turning = o.motion === undefined ? '' : ` class="orb" style="${loop(period, 0, 4, o.motion)}"`
    planets += `<g transform="rotate(${f1(angle)})"><g${turning}><circle cx="${radius}" r="${5 + i}"/></g></g>`
  })
  const constellations = [
    [
      [1090, 590],
      [1180, 650],
      [1290, 618],
      [1345, 710],
      [1450, 692],
    ],
    [
      [150, 120],
      [240, 70],
      [330, 140],
      [300, 240],
    ],
    [
      [690, 70],
      [790, 40],
      [850, 120],
    ],
  ]
  let cons = ''
  for (const c of constellations) {
    cons += `<polyline class="con" points="${c.map(p => p.join(',')).join(' ')}"/>`
    cons += `<g class="star">${c.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="1.8" opacity=".8"/>`).join('')}</g>`
  }
  let grid = ''
  for (let x = -200; x <= 1800; x += 200) grid += `<line x1="${x}" y1="-250" x2="${x}" y2="1150"/>`
  for (let y = -250; y <= 1150; y += 200) grid += `<line x1="-200" y1="${y}" x2="1800" y2="${y}"/>`
  let ticks = ''
  for (let i = 0; i < 32; i++) ticks += `<line x1="0" y1="${i % 4 ? -58 : -52}" x2="0" y2="-64" transform="rotate(${i * 11.25})"/>`
  // Drawn by day only: the paper chart's grid, its compass and its title.
  const paper = `<g class="paper">${grid}<g class="rose" transform="translate(1390 750)"><circle r="64"/><circle r="44"/>${ticks}<path d="M0 -44L7 0L0 44L-7 0Z"/><path d="M-44 0L0 -7L44 0L0 7Z"/><g class="title">${brushLine('北', 0, -74, 20, 0)}</g></g><g class="title">${brushLine('星际指南 远征航段', 1390, 855, 20, 0.2)}</g></g>`

  const at = onRoute(done)
  const travelled = ROUTE_LEN * done
  const next = voyage.harbors.find(h => h.at > done)
  const charge = Math.max(30, ROUTE_LEN * (next?.at ?? 1) - travelled) * o.flame
  let harbors = ''
  let names = ''
  for (const h of voyage.harbors) {
    const p = onRoute(h.at)
    harbors += `<circle class="hb" cx="${f1(p.x)}" cy="${f1(p.y)}" r="5"/>`
    names += `<text x="${f1(p.x + 12)}" y="${f1(p.y + 16)}">${esc(h.name)}</text>`
  }
  const from = onRoute(0)
  const to = onRoute(1)
  // The names fade as the camera closes in: at three times the size they shout.
  const namesOpacity = f1(Math.max(0, 1 - o.flame * 1.8))
  const pulse = o.motion === undefined ? '' : ` style="${loop(8, seconds, 4, o.motion, 'ease-in-out')}"`
  const body =
    paper +
    stars(23, 70, [-300, -250, 2200, 1400], now, o.motion) +
    cons +
    rings +
    `<g class="planets" transform="translate(${SUN.x} ${SUN.y}) rotate(${TILT}) scale(1 ${SQUASH})">${planets}</g>` +
    `<circle cx="${SUN.x}" cy="${SUN.y}" r="60" fill="url(#gFire)" opacity=".5"/><circle cx="${SUN.x}" cy="${SUN.y}" r="5" class="dest"/>` +
    `<path class="route" d="${ROUTE_D}"/>` +
    `<path class="done" d="${ROUTE_D}" stroke-dasharray="${f1(travelled)} ${f1(ROUTE_LEN + 50)}"/>` +
    (o.flame > 0 ? `<path class="charge" d="${ROUTE_D}" stroke-dasharray="0 ${f1(travelled)} ${f1(charge)} 9999"/>` : '') +
    harbors +
    `<g opacity="${namesOpacity}"><g style="${o.labels ?? ''}">${names}<text x="${f1(from.x - 14)}" y="${f1(from.y + 26)}">启航</text><text x="${f1(to.x + 20)}" y="${f1(to.y + 4)}">${esc(voyage.endLabel)} · ${esc(voyage.dest)}</text></g></g>` +
    `<circle class="${o.motion === undefined ? 'ring' : 'ring pulse'}" cx="${f1(to.x)}" cy="${f1(to.y)}" r="16"${pulse}/>` +
    `<g transform="translate(${f1(to.x)} ${f1(to.y)}) scale(1.3)"><path class="dest" d="${SPARK}"/></g>` +
    ship(at.x, at.y, at.deg, o.flame)
  return { body, shipAt: at }
}

/**
 * Deep space and the streaks of a jump: what the ship sees once it is under way.
 * `fading` is for the arrival: each streak flies out once more and is gone.
 */
function space(now: number, motion: Motion, fading = false): string {
  const r = rng(11)
  let streaks = ''
  for (let i = 0; i < 72; i++) {
    const turn = r() * 360
    const from = (30 + r() * 430) | 0
    // Each streak rests part-way out, so the picture reads as a jump even on a
    // surface that plays no animation; where one plays, it takes over.
    const along = 0.15 + r() * 0.65
    const length = 1.6 + r() * 2.6
    const offset = r() * 9
    const timing = loop(length, now / 1000 + offset, 20, motion, 'cubic-bezier(.6,0,.95,.5)')
    streaks += `<g transform="rotate(${f1(turn)})"><rect class="w" x="${from}" y="-0.8" width="3" height="1.6" rx=".8" style="transform:translateX(${(900 * along) | 0}px) scaleX(${f1(1 + 69 * along)});${timing}"/></g>`
  }
  const drift = fading ? '' : ` class="pan" style="${loop(90, now / 1000, 2, motion, 'ease-in-out')}"`
  return (
    `<g${drift}><ellipse cx="800" cy="420" rx="1050" ry="190" transform="rotate(-17 800 420)" fill="url(#gGal)"/><g opacity=".3">${stars(7, 110, [-100, -110, 1800, 1120], now)}</g></g>` +
    `<g class="${fading ? 'warp last' : 'warp'}" transform="translate(800 420)">${streaks}</g>`
  )
}

/**
 * The harbour: standing on a small world, the galaxy overhead, the ship laid
 * up. It comes in two parts. The `sky` is part of the scene, cut to fill the
 * window from its top. The `land` hangs from the window's foot and is measured
 * in the window's own pixels, since what it has to clear, the message box, is
 * measured so: its horizon stands `flat` pixels up at the window's edges, and
 * below it the world is one flat colour, the page's own where `isOwn` says the
 * scene has a ground to keep to.
 *
 * The world is a circle in a drawing `SPAN` wide that is stretched to the
 * window's width, so its horizon falls the same `SAG` on a narrow window as
 * on a wide one. What must keep its shape (names, the ship, the lamp) is set
 * beside that drawing, each at its part of the window's width.
 *
 * Without a `motion` it is a copy on its way out, as the chart's is: nothing
 * in it moves.
 */
function harbour(voyage: Voyage, now: number, flat: number, isOwn: boolean, motion?: Motion): { sky: string; land: string } {
  const moving = (cls: string, seconds: number, since: number, fps: number): string =>
    motion === undefined ? '' : ` class="${cls}" style="${loop(seconds, since, fps, motion, 'ease-in-out')}"`
  const { done } = progress(voyage, now)
  const seconds = now / 1000
  const r = rng(77)
  let band = ''
  for (let i = 0; i < 150; i++) {
    const t = r() * 2 - 1
    const g = (r() + r() + r() - 1.5) / 1.5
    band += `<circle cx="${(800 + t * 1150) | 0}" cy="${(230 + g * 150) | 0}" r="${f1(0.6 + r() * 0.9)}" opacity="${f1(0.25 + r() * 0.6)}"/>`
  }
  const sky = `<g${moving('sky', 900, seconds, 0.5)}><g transform="rotate(-24 800 230)"><ellipse cx="800" cy="230" rx="1250" ry="250" fill="url(#gGal)"/><ellipse cx="800" cy="230" rx="1000" ry="90" fill="url(#gGal)"/><g class="star">${band}</g></g>${stars(53, 120, [-200, -300, 2000, 1200], now, motion)}</g>`

  // Heights are pixels above the window's foot, written as the negative y
  // they are in a drawing whose origin is that foot.
  const cy = WORLD - (flat + SAG + INNER)
  const axis = WORLD + 30
  /** The height of the circle of radius `q` about the world's centre, at a part `p` of the window's width. */
  const rise = (p: number, q = WORLD): number => cy - Math.sqrt(q * q - ((p - 0.5) * SPAN) ** 2)
  const part = (f: number): number => EDGE + (1 - 2 * EDGE) * f
  const pct = (p: number): string => `${f1(p * 100)}%`
  const mid = SPAN / 2
  let harbors = ''
  for (const h of voyage.harbors) {
    const p = part(h.at)
    const y = rise(p, axis)
    harbors += `<circle class="hb" cx="${pct(p)}" cy="${f1(y)}" r="4"/><text x="${pct(p)}" y="${f1(y - 14)}" text-anchor="middle" opacity=".75">${esc(h.name)}</text>`
  }
  const from = part(0)
  const to = part(1)
  // The ship lies on the ground, nose toward the depth of the picture.
  const berth = part(done)
  const aim = (Math.atan2(-300, (0.5 - berth) * 1600) * 180) / Math.PI
  const lamp = `<g${moving('breath', 8, seconds + 3, 2)}><circle cx="${pct(berth)}" cy="${f1(rise(berth) - 4)}" r="100" fill="url(#gFire)"/></g>`
  const land =
    // Where the world is the ground, the lamp stands behind it: its light is
    // in the sky, and the ground under it stays the page's colour. Where
    // there is no ground to keep to, it lights the ground it stands on.
    (isOwn ? lamp : '') +
    `<svg width="100%" height="8" viewBox="0 0 ${SPAN} 8" preserveAspectRatio="none" style="overflow:visible">` +
    `<circle class="${isOwn ? 'land' : 'planet'}" cx="${mid}" cy="${f1(cy)}" r="${WORLD}"/>` +
    `<g${moving('breath', 12, seconds, 2)}><circle cx="${mid}" cy="${f1(cy)}" r="${WORLD + 100}" fill="url(#gAir)"/><circle class="limb" cx="${mid}" cy="${f1(cy)}" r="${WORLD}"/></g>` +
    // The axis stays as a quiet line along the horizon: no mark of how far along.
    `<path class="ax" d="M${f1(from * SPAN)} ${f1(rise(from, axis))}A${axis} ${axis} 0 0 1 ${f1(to * SPAN)} ${f1(rise(to, axis))}"/>` +
    `</svg>` +
    (isOwn ? '' : lamp) +
    harbors +
    `<text x="${pct(from)}" y="${f1(rise(from, axis) - 14)}" text-anchor="middle" opacity=".75">启航</text>` +
    `<svg x="${pct(to)}" y="${f1(rise(to, axis))}" width="8" height="8" style="overflow:visible"><path class="dest" d="${SPARK}"/></svg>` +
    // The date stands a row above the harbours' names: on a narrow window the last of them is hard by it.
    `<text x="${pct(to)}" dx="18" y="${f1(rise(to, axis) - 30)}" text-anchor="end">${esc(voyage.endLabel)}</text>` +
    `<svg x="${pct(berth)}" y="${f1(rise(berth) - 7)}" width="8" height="8" style="overflow:visible"><g transform="rotate(${f1(aim)}) scale(1.25 1.9)"><path class="ship" d="${SHIP}"/></g></svg>`
  return { sky, land }
}

/**
 * The ground under the chart and the jump: the scene dissolves into the page's
 * colour over `FADE` pixels, and below `flat` it is that colour alone. Drawn
 * in the window's pixels from its foot.
 */
function soil(flat: number): string {
  return `<rect x="0" y="${-(flat + FADE)}" width="100%" height="${FADE}" fill="url(#gSoil)"/><rect class="veil" x="0" y="${-flat - 1}" width="100%" height="${flat + 9}"/>`
}

/** The glow of the engines, low over the ground: the ground's own fade is laid over its lower half. */
function embers(flat: number, opacity: number, style = ''): string {
  return `<ellipse${style === '' ? '' : ` class="breath" style="${style}"`} cx="50%" cy="${-(flat + 50)}" rx="36%" ry="130" fill="url(#gFire)" opacity="${f2(opacity)}"/>`
}

// ---------------------------------------------------------------- words

/**
 * One brushed glyph in a cell `width` wide whose left edge is `x`, on the
 * baseline `y`: Long Cang's outline where the poems' set has it, and the
 * system's own 行楷 where it does not.
 */
function brushed(glyph: string, x: number, width: number, y: number, size: number): string {
  const drawn = GLYPHS[glyph]
  if (drawn === undefined) {
    return `<text class="brush" text-anchor="middle" x="${f1(x + width / 2)}" y="${f1(y)}" style="font-size:${size}px">${esc(glyph)}</text>`
  }
  const scale = size / EM
  return `<path class="ink" transform="translate(${f1(x + (width - drawn[0] * scale) / 2)} ${f1(y)}) scale(${scale.toFixed(4)})" d="${drawn[1]}"/>`
}

/** A still line of brushed text, centred on `cx`. */
function brushLine(text: string, cx: number, y: number, size: number, spacing: number): string {
  const glyphs = [...text]
  const width = size * (1 + spacing)
  let x = cx - (glyphs.length * width) / 2
  let out = ''
  for (const g of glyphs) {
    if (g !== ' ') out += brushed(g, x, width, y, size)
    x += width
  }
  return out
}

/**
 * The style of the `index`th glyph of words that began `since` seconds ago:
 * when it comes in, when it lets go, and where the wind takes it.
 */
function drift(r: () => number, index: number, since: number, holdFor: number): string {
  const inAt = index * 0.09 - since
  const outAt = holdFor + index * 0.07 - since
  return `--dx:${(40 + r() * 90) | 0}px;--dy:${(-8 - r() * 40) | 0}px;--rot:${(r() * 50 - 10) | 0}deg;animation-delay:${f1(inAt)}s,${f1(outAt)}s`
}

/** Seconds drifting words of `count` glyphs need from the first one in to the last one gone. */
function driftSpan(count: number, holdFor: number): number {
  return holdFor + count * 0.07 + 2.8
}

/**
 * A line of verse as the columns it is set in, read from the right: a clause
 * to a column, short neighbours sharing one with a blank between them, and
 * never more than three.
 */
export function columns(line: string): string[][] {
  const clauses = line
    .split(/[，。；？！、,.;?!\s]+/u)
    .map(clause => [...clause])
    .filter(clause => clause.length > 0)
  const longest = Math.max(7, ...clauses.map(clause => clause.length))
  let cols: string[][] = []
  for (const clause of clauses) {
    const last = cols[cols.length - 1]
    if (last !== undefined && last.length + 1 + clause.length <= longest) last.push(' ', ...clause)
    else cols.push([...clause])
  }
  while (cols.length > 3) {
    const paired: string[][] = []
    for (let i = 0; i < cols.length; i += 2) {
      const a = cols[i] ?? []
      const b = cols[i + 1]
      paired.push(b === undefined ? a : [...a, ' ', ...b])
    }
    cols = paired
  }
  return cols
}

/** How many glyphs a poem and its source put on screen. */
function verseCount(poem: Poem): number {
  return columns(poem[0]).reduce((n, col) => n + col.filter(g => g !== ' ').length, 0) + [...poem[1]].length
}

/**
 * A poem set the old way: brushed columns read from the right, each glyph
 * coming in on its own and drifting off on the wind, and its source in small
 * type beneath them. The poem's left edge is held at `VERSE_LEFT`, nearest
 * the conversation, so a short poem stands as close to the text as a long one
 * and nothing of it reaches further in.
 */
function verse(poem: Poem, since: number, seed: number, holdFor: number): string {
  const [line, source] = poem
  const cols = columns(line)
  const tallest = Math.max(1, ...cols.map(col => col.length))
  // Each column begins a little lower than the one to its right, as a hand
  // sets them; the last one still has to end inside the room.
  const steps = STAGGER * (cols.length - 1)
  const size = Math.min(cols.length >= 3 ? 24 : 27, Math.floor(VERSE_ROOM / ((tallest + steps) * 1.14)))
  const cell = size * 1.14
  const pitch = size * 1.3
  const wide = (cols.length - 1) * pitch + size
  const r = rng(seed)
  let index = 0
  let out = ''
  let bottom = VERSE_TOP
  cols.forEach((col, c) => {
    const cx = VERSE_LEFT + wide - size / 2 - c * pitch
    const top = VERSE_TOP + c * STAGGER * cell
    bottom = Math.max(bottom, top + (col.length - 1) * cell + size)
    col.forEach((g, i) => {
      if (g === ' ') return
      out += `<g class="gl" style="${drift(r, index, since, holdFor)}">${brushed(g, cx - size / 2, size, top + i * cell + size * 0.86, size)}</g>`
      index += 1
    })
  })
  // The source, small, in a column of its own under the middle of the poem,
  // below its lowest glyph. In a column, a title's marks turn to their
  // upright forms.
  const signed = [...source.replace(/《/g, '︽').replace(/》/g, '︾')]
  const sx = VERSE_LEFT + wide / 2
  let sy = bottom + SOURCE_GAP
  const q = rng(9)
  signed.forEach((g, i) => {
    if (g === ' ') {
      sy += 5
      return
    }
    sy += 12.5
    out += `<text class="gl small" x="${f1(sx)}" y="${f1(sy)}" style="font-size:10px;${drift(q, i, since - 0.8, holdFor - 0.4)}">${esc(g)}</text>`
  })
  return out
}

/**
 * Small words set in columns read from the right, drifting as a poem's do. A
 * cell is one glyph, or a number kept whole and set across.
 */
function note(cols: readonly (readonly string[])[], since: number, holdFor: number): string {
  const r = rng(5)
  let index = 0
  let out = ''
  cols.forEach((col, c) => {
    const x = LANE_X - c * 28
    col.forEach((cell, i) => {
      out += `<text class="gl small" x="${x}" y="${LANE_TOP + i * 19}" style="font-size:13px;${drift(r, index, since, holdFor)}">${esc(cell)}</text>`
      index += 1
    })
  })
  return out
}

/** The progress line's cells: how far, and how long is left. */
function progressNote(voyage: Voyage, now: number): string[][] {
  const { done, daysLeft } = progress(voyage, now)
  return [
    ['航', '程', '已', '过', `${Math.round(done * 100)}%`],
    ['距', ...voyage.dest, '还', '有', `${daysLeft}`, '天'],
  ]
}

/**
 * How long after it begins a view's words are gone, in seconds: the moment the
 * view can be drawn again without them. 0 for a view with no words.
 */
export function wordsSpan(view: View, poems: readonly Poem[]): number {
  // Under way the poem is changed for the next one, never cleared away.
  if (view.phase === 'work') return 0
  const poem = view.poem === null ? undefined : poems[view.poem]
  const forPoem = poem === undefined ? 0 : 1.2 + driftSpan(verseCount(poem), HOLD)
  const forProgress = view.progressAt > 0 && view.phase === 'cruise' ? driftSpan(12, 10) : 0
  return Math.max(forPoem, forProgress)
}

/**
 * The words of a view, all in the side column where no line of the
 * conversation runs under them: the poem, and in the lane to its right the
 * progress line or the harbour's greeting.
 */
function words(view: View, now: number, o: SceneOptions): string {
  let out = ''
  if (view.phase === 'dock') {
    // In the sky over the small world: its ground is given up to the message box.
    out += `<text class="quiet v" x="${LANE_X}" y="${LANE_TOP - 10}">入港歇歇脚</text><text class="quiet v" x="${LANE_X - 26}" y="${LANE_TOP + 2}">漫看这片星河</text>`
  }
  if (view.progressAt > 0 && view.phase === 'cruise') {
    const since = (now - view.progressAt) / 1000
    if (since < driftSpan(12, 10)) out += note(progressNote(o.voyage, now), since, 10)
  }
  const poem = view.poem === null ? undefined : o.poems[view.poem]
  if (poem !== undefined) {
    const since = (now - view.poemAt) / 1000 - 1.2
    const holdFor = view.phase === 'work' ? HOLD_UNDER_WAY : HOLD
    if (since < driftSpan(verseCount(poem), holdFor)) out += verse(poem, since, view.poemAt | 0, holdFor)
  }
  return out
}

/**
 * The voyage as a pilot's gauge, shown during a jump: a thin line up the side
 * column, departure at its foot and the destination at its head.
 */
function hudAxis(voyage: Voyage, now: number): string {
  const { done } = progress(voyage, now)
  const x = GAUGE_X
  const foot = VERSE_TOP + VERSE_ROOM - 24
  const head = VERSE_TOP + 14
  const y = (f: number): number => foot - (foot - head) * f
  let harbors = ''
  for (const h of voyage.harbors) {
    harbors += `<circle class="hb" cx="${x}" cy="${f1(y(h.at))}" r="3.2"/><text x="${x - 10}" y="${f1(y(h.at) + 4)}" text-anchor="end" opacity=".6">${esc(h.name)}</text>`
  }
  return (
    `<path class="ax" d="M${x} ${foot}V${head}"/><path class="ax lit" d="M${x} ${foot}V${f1(y(done))}"/>${harbors}` +
    `<text x="${x}" y="${foot + 20}" text-anchor="middle" opacity=".6">启航</text>` +
    `<g transform="translate(${x} ${head}) scale(.8)"><path class="dest" d="${SPARK}"/></g>` +
    `<text class="st" x="${x + 9}" y="${head - 15}" text-anchor="end">${esc(voyage.endLabel)}</text>` +
    `<g transform="translate(${x} ${f1(y(done))}) rotate(-90)"><path class="ship" d="${SHIP}"/></g>`
  )
}

// ---------------------------------------------------------------- squads

const SQUAD_WORD: Record<SquadStatus, string> = { work: '探索中', wait: '待命', dock: '休整', need: '呼叫你' }

/**
 * A session's name as the drawing takes it. A title is whatever its person
 * typed, and the app refuses a whole scene over one stray character, so only
 * letters, digits and a few plain marks pass, cut to `room` ems.
 */
export function squadName(raw: string, room = 7): string {
  // A name that was cut before says so with its last mark; cutting it again
  // must give the same name, so the mark is set aside and put back.
  const wasCut = /…\s*$/.test(raw)
  const plain = raw
    .replace(/…/g, ' ')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _.·-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  let width = 0
  let out = ''
  for (const g of plain) {
    const w = /[\u0000-\u024f]/.test(g) ? 0.56 : 1
    if (width + w > room) return `${out.trimEnd()}…`
    width += w
    out += g
  }
  if (out === '') return '无名小队'
  return wasCut ? `${out}…` : out
}

/**
 * Where the squads stand, in the order they are listed: down the sky to the
 * left of the conversation, each a little in or out from the last so they
 * read as scattered and not as a table. A place is the ship's, in a strip
 * `STRIP` wide; the name runs leftward from it, with room for a long one.
 */
const AFIELD = [
  [178, 112, -150],
  [152, 184, -128],
  [182, 258, -165],
  [148, 330, -140],
  [176, 404, -120],
  [156, 476, -158],
] as const

/** How much of a squad's name is shown: the left margin is wide, and nothing else is set there. */
const SQUAD_ROOM = 12

/**
 * The middle of the squads as drawn in their strip, names at full length:
 * from the far end of the longest name to the ring of the ship furthest out.
 * It is set on the middle of the margin left of the text, so the squads keep
 * as far from the conversation as from the window's edge.
 */
const SQUAD_MID = 88

/**
 * The other sessions, as squads out among the stars: each a small ship in a
 * ring with the light that says how it stands, and beside it its name and
 * that standing in words, since nothing here answers to a pointer. A light
 * breathes while its squad is under way and beats when the squad is calling.
 */
function afield(squads: readonly Squad[], now: number, motion: Motion): string {
  if (squads.length === 0) return ''
  const shown = squads.length > AFIELD.length ? squads.slice(0, AFIELD.length - 1) : squads
  let out = `<text class="cap" x="${STRIP - 8}" y="78" text-anchor="end">远征小队</text>`
  shown.forEach((squad, i) => {
    const [x, y, turn] = AFIELD[i] ?? AFIELD[0]
    const status: SquadStatus = squad.status in SQUAD_WORD ? squad.status : 'wait'
    const halo =
      status === 'work' || status === 'need'
        ? `<circle class="halo pulse s-${status}" cx="9.5" cy="-9.5" r="5.5" style="${loop(status === 'need' ? 1 : 3, now / 1000, 4, motion, 'ease-in-out')}"/>`
        : ''
    out += `<g transform="translate(${x} ${y})"><circle class="sq" r="12.5"/><g transform="rotate(${turn}) scale(.85)"><path class="ship" d="${SHIP}"/></g>${halo}<circle class="s-${status}" cx="9.5" cy="-9.5" r="3.4"/><text class="sn" x="-20" y="0" text-anchor="end">${esc(squadName(String(squad.name), SQUAD_ROOM))}</text><text class="st" x="-20" y="12" text-anchor="end">${SQUAD_WORD[status]}</text></g>`
  })
  if (squads.length > shown.length) {
    const [x, y] = AFIELD[AFIELD.length - 1] ?? [160, 476]
    out += `<text class="st" x="${x + 12}" y="${y}" text-anchor="end">另有 ${squads.length - shown.length} 队</text>`
  }
  return out
}

// ---------------------------------------------------------------- the sheet

/** The air over the small world, as parts of the radius of the circle it is drawn on: clear `INNER` below the horizon, brightest on it, gone 100 above. */
const AIR = [(WORLD - INNER) / (WORLD + 100), WORLD / (WORLD + 100), (WORLD + 30) / (WORLD + 100)].map(n => n.toFixed(5))

const DEFS = `<defs><radialGradient id="gFire"><stop offset="0" style="stop-color:var(--fire2);stop-opacity:.75"/><stop offset=".45" style="stop-color:var(--fire);stop-opacity:.34"/><stop offset="1" style="stop-color:var(--fire);stop-opacity:0"/></radialGradient><radialGradient id="gGal"><stop offset="0" style="stop-color:var(--gal);stop-opacity:.42"/><stop offset="1" style="stop-color:var(--gal);stop-opacity:0"/></radialGradient><radialGradient id="gAir"><stop offset="${AIR[0]}" style="stop-color:var(--limb);stop-opacity:0"/><stop offset="${AIR[1]}" style="stop-color:var(--limb);stop-opacity:.55"/><stop offset="${AIR[2]}" style="stop-color:var(--limb);stop-opacity:.2"/><stop offset="1" style="stop-color:var(--limb);stop-opacity:0"/></radialGradient><linearGradient id="gSoil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--veil);stop-opacity:0"/><stop offset=".25" style="stop-color:var(--veil);stop-opacity:.16"/><stop offset=".5" style="stop-color:var(--veil);stop-opacity:.5"/><stop offset=".75" style="stop-color:var(--veil);stop-opacity:.84"/><stop offset="1" style="stop-color:var(--veil);stop-opacity:1"/></linearGradient></defs>`

const BRUSH = `"Long Cang","Xingkai SC","STXingkai","Kaiti SC","STKaiti",serif`

// By night, pale light on deep space; by day, ink on the app's own paper.
const SHEET = `<style>
svg{--star:#cfe0ff;--line:#8fb0e8;--ink:#e3e9f5;--muted:#8a97b0;--fire:#ff7a3c;--fire2:#ffc27a;--gal:#3d5a9e;--planet:#0a1120;--limb:#9cc4ff;--paper:none;--ok:#4ade80;--idle:#60a5fa;--need:#f87171;--veil:#0a101d}
@media (prefers-color-scheme:light){svg{--star:#6b5a45;--line:#7a6650;--ink:#3d3929;--muted:#7d7462;--fire:#c6613f;--fire2:#d97757;--gal:#c9b48a;--planet:#e4dccb;--limb:#a08a62;--paper:inline;--ok:#2f9a5b;--idle:#3f7fc1;--need:#d0453a;--veil:#f5f4ed}
.orbit{stroke-dasharray:6 5;opacity:.4}.con{opacity:.45}.star{opacity:.75}}
text{font:11px -apple-system,"PingFang SC","Helvetica Neue",sans-serif;fill:var(--muted);letter-spacing:.08em}
.star{fill:var(--star)}
.tw{animation:tw infinite alternate}
@keyframes tw{from{opacity:.25}to{opacity:1}}
@keyframes spin{to{transform:rotate(360deg)}}
.ax{fill:none;stroke:var(--line);stroke-width:1;opacity:.28}
.ax.lit{opacity:.6;stroke-width:1.4}
.hb{fill:none;stroke:var(--line);stroke-width:1;opacity:.6}
.dest{fill:var(--fire2)}
.ship{fill:var(--ink)}
.flame{fill:var(--fire);transform-box:fill-box;transform-origin:right center}
.paper{display:var(--paper)}
.paper line,.paper circle,.paper .rose>path{fill:none;stroke:var(--line);stroke-width:.8;opacity:.3}
.paper .rose{opacity:.55}
.brush{font-family:${BRUSH};fill:var(--ink)}
.ink{fill:var(--ink)}
.paper .title .ink,.paper .title .brush{fill:var(--line);opacity:.7}
.orbit{fill:none;stroke:var(--line);stroke-width:1;opacity:.22}
.orb{animation:spin infinite}
.planets circle{fill:var(--line);opacity:.8}
.con{fill:none;stroke:var(--line);stroke-width:.8;opacity:.22}
.route{fill:none;stroke:var(--line);stroke-width:1.2;stroke-dasharray:2 9;opacity:.4}
.done{fill:none;stroke:var(--line);stroke-width:1.6;opacity:.75}
.charge{fill:none;stroke:var(--fire);stroke-width:2.4;stroke-linecap:round}
.ring{fill:none;stroke:var(--fire2);stroke-width:1;opacity:.4}
.pulse{transform-box:fill-box;transform-origin:center;animation:pulse infinite alternate}
@keyframes pulse{from{transform:scale(1);opacity:.5}to{transform:scale(1.5);opacity:.12}}
.pan{transform-origin:800px 450px;transform:scale(1.06);animation:pan infinite alternate}
@keyframes pan{from{transform:translate(-34px,10px) scale(1.06)}to{transform:translate(34px,-10px) scale(1.06)}}
.w{fill:var(--star);opacity:.6;transform-box:fill-box;transform-origin:left center;animation:warp infinite}
.last .w{animation-iteration-count:1;animation-fill-mode:forwards}
@keyframes warp{from{transform:translateX(0) scaleX(0)}to{transform:translateX(900px) scaleX(70)}}
.sky{transform-origin:800px 3080px;animation:sky infinite alternate}
@keyframes sky{from{transform:rotate(-1.6deg)}to{transform:rotate(1.6deg)}}
.planet{fill:var(--planet)}
.land{fill:var(--veil)}
.limb{fill:none;stroke:var(--limb);stroke-width:1.6;opacity:.85}
.breath{animation:breath infinite alternate}
@keyframes breath{from{opacity:.6}to{opacity:1}}
.quiet{font-size:13px;letter-spacing:.3em}
.v{writing-mode:vertical-rl}
.so{fill:none;stroke:var(--line);stroke-width:.8;stroke-dasharray:2 3;opacity:.5}
.ss{fill:var(--line);opacity:.8}
.s-work{fill:var(--ok)}.s-wait{fill:var(--idle)}.s-dock{fill:var(--idle);opacity:.4}.s-need{fill:var(--need)}
.halo{opacity:.3}
.veil{fill:var(--veil)}
.sq{fill:var(--planet);fill-opacity:.55;stroke:var(--line);stroke-width:1;opacity:.85}
.cap{font-size:10px;letter-spacing:.24em;opacity:.55}
.sn{opacity:.9}
.st{font-size:9px;opacity:.6}
.small{fill:var(--muted)}
.gl{text-anchor:middle;opacity:.9;transform-box:fill-box;transform-origin:center;animation:glin 1.3s ease backwards,glout 2.6s ease-in forwards}
@keyframes glin{from{opacity:0;transform:translateY(6px)}}
@keyframes glout{from{opacity:.9}to{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(var(--rot))}}
@keyframes show{from{opacity:0}}
@keyframes hide{from{opacity:1}}
.dbg{font-size:12px;fill:var(--muted);opacity:.7}
@media (prefers-reduced-motion:reduce){.tw,.orb,.pulse,.pan,.w,.sky,.breath{animation:none}}
</style>`

// ---------------------------------------------------------------- the scene

/** The most a surface takes of one scene, with room to spare. */
const ROOM = 124_000

/** The whole backdrop for a view, as one SVG document. */
export function scene(view: View, now: number, o: SceneOptions): string {
  const lab = o.lab ?? []
  if (lab.includes('bare')) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><rect width="100%" height="100%" fill="none"/></svg>`
  }
  // A still scene is the moving one with every way of moving taken out; a
  // calm one is still once its view has nothing left to play.
  const isStill = o.motion === 'still' || (o.motion === 'calm' && now >= quietAt(view, o.poems))
  const moving: SceneOptions = o.motion === 'still' || o.motion === 'calm' ? { ...o, motion: 'low' } : o
  const whole = draw(view, now, moving)
  // Brushed glyphs are heavy: a long poem over a busy transition gives way.
  let fitted = whole.length <= ROOM || view.poem === null ? whole : draw({ ...view, poem: null }, now, moving)
  if (lab.includes('nostars')) fitted = fitted.replace(/<g class="star">(?:<circle[^>]*\/>)*<\/g>/g, '')
  if (lab.includes('noglow')) fitted = fitted.replace(/<(?:circle|ellipse)[^>]*fill="url\(#g[A-Za-z]+\)"[^>]*\/>/g, '')
  return isStill ? becalm(fitted) : fitted
}

/**
 * The moment from which a view has nothing left to play: its way in is over
 * and its words are in place or gone. Before it the drawing moves; from it on
 * a calm scene is drawn still, and stays so until the view changes.
 */
export function quietAt(view: View, poems: readonly Poem[]): number {
  const wayIn =
    view.phase === 'work'
      ? JUMP_PLAYS
      : view.phase === 'dock'
        ? view.from === 'cruise'
          ? 2.8
          : 0
        : view.from === 'work'
          ? 3.2
          : view.from === 'dock'
            ? 2.6
            : view.fromLevel !== view.level
              ? 2.4
              : 0
  let at = view.at + wayIn * 1000
  const poem = view.poem === null ? undefined : poems[view.poem]
  if (poem !== undefined) {
    const count = verseCount(poem)
    // Under way a poem stays up until the next one: quiet once it is all in.
    // Elsewhere it drifts off again, and that is part of the playing.
    const plays = view.phase === 'work' ? 1.2 + count * 0.09 + 2.4 : 1.2 + driftSpan(count, HOLD)
    at = Math.max(at, view.poemAt + plays * 1000)
  }
  if (view.progressAt > 0 && view.phase === 'cruise') {
    at = Math.max(at, view.progressAt + driftSpan(12, 10) * 1000)
  }
  return at
}

/**
 * The drawing with nothing left in it that moves. Every layer's own style is
 * already where it ends up, so what remains is the finished picture of the
 * state, as the app's own still version is.
 */
function becalm(svg: string): string {
  return svg
    .replace(/@keyframes [\w-]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    .replace(/animation[\w-]*:[^;}"]*;?/g, '')
    .replace(/<style><\/style>/g, '')
}

function draw(view: View, now: number, o: SceneOptions): string {
  const since = Math.max(0, (now - view.at) / 1000)
  const flame = ZOOM[view.level] ?? 0
  const { voyage, motion } = o
  // The keyframes give where the camera starts; the layer's style, where it ends.
  const cameraFrom = (zoom: number, opacity: number, at: { x: number; y: number }): string =>
    `<style>@keyframes cam{from{transform:${camera(zoom, at)};opacity:${opacity}}}</style>`
  const cameraAt = (zoom: number, opacity: number, at: { x: number; y: number }): string => `transform:${camera(zoom, at)};opacity:${opacity};`
  // The ground, where the scene has one: how much of the window's foot is the
  // page's own colour. The chart and the jump are raised clear of it; the
  // harbour's world stands on it.
  const flat = Math.min(900, Math.max(0, Math.round(o.ground ?? 0)))
  const hasGround = flat > 0
  const raised = (drawing: string): string => (hasGround ? `<g transform="translate(0 ${-LIFT})">${drawing}</g>` : drawing)
  const port = (moves?: Motion): { sky: string; land: string } => harbour(voyage, now, hasGround ? flat : REST, hasGround, moves)
  /** The scene, cut to fill the window from its top. */
  let body = ''
  /** What hangs from the window's foot, in the window's own pixels. */
  let foot = ''

  if (view.phase === 'work') {
    let leaving = ''
    // The camera dives into the ship and the chart falls away; then the jump.
    if (since < 2 && view.from === 'cruise') {
      const drawn = chart(voyage, now, { flame: 1 })
      body += raised(
        cameraFrom(ZOOM[view.fromLevel] ?? 0, 1, drawn.shipAt) +
          `<g style="${cameraAt(DIVE, 0, drawn.shipAt)}${run('cam', 1.5, since, 'cubic-bezier(.5,0,.9,.4)')}">${drawn.body}</g>`,
      )
    } else if (since < 2.4 && view.from === 'dock') {
      // Out of harbour: the ship lifts off, and the small world and its sky
      // drop away beneath it. The world is the nearer thing: it passes in
      // front of the jump's first streaks as it goes.
      const left = port()
      const dropping = `transform:translateY(260px);opacity:0;${run('lift', 2.2, since, 'cubic-bezier(.5,0,.9,.5)')}`
      body += `<style>@keyframes lift{from{transform:translateY(0);opacity:1}}</style><g style="${dropping}">${left.sky}</g>`
      leaving = `<g style="${dropping}">${left.land}</g>`
    }
    // Space comes up as the jump begins; a jump drawn again part-way is there already.
    body += raised(`<g style="${view.from === 'work' ? '' : run('show', 1.6, since - 0.5)}">${space(now, motion)}</g>`)
    const breathing = loop(12, now / 1000, 2, motion, 'ease-in-out')
    if (hasGround) foot += embers(flat, 0.55, breathing) + soil(flat) + leaving
    else {
      body += `<ellipse class="breath" cx="800" cy="960" rx="640" ry="300" fill="url(#gFire)" opacity=".55" style="${breathing}"/>`
      foot += leaving
    }
  } else if (view.phase === 'dock') {
    if (view.from === 'cruise' && since < 2.4) {
      const drawn = chart(voyage, now, { flame: 0 })
      const going = `opacity:0;${run('hide', 2.2, since)}`
      body += raised(`<g style="${going}">${drawn.body}</g>`)
      if (hasGround) foot += `<g style="${going}">${soil(flat)}</g>`
    }
    // The harbour comes up as the chart goes; drawn again later, it is there already.
    const here = port(motion)
    const coming = view.from === 'cruise' ? run('show', 2.6, since) : ''
    body += `<g style="${coming}">${here.sky}</g>`
    foot += `<g style="${coming}">${here.land}</g>`
  } else {
    const arriving = view.from === 'work' && since < 3
    // The chart's small names stand where the poem is set: they wait for it
    // to drift off, then come back.
    const poem = view.poem === null ? undefined : o.poems[view.poem]
    const verseEnds = poem === undefined ? 0 : (view.poemAt - view.at) / 1000 + 1.2 + driftSpan(verseCount(poem), HOLD)
    const labels = since < verseEnds ? run('show', 1.6, since - verseEnds + 2) : arriving ? run('show', 1.2, since - 1.8) : ''
    const drawn = chart(voyage, now, { flame, motion, labels })
    let over = ''
    if (arriving) {
      // Arrival: the streaks fly out once more and the camera pulls back to the chart.
      if (since < 2) over += `<g style="opacity:0;${run('hide', 1.6, since)}">${space(now, motion, true)}</g>`
      over += cameraFrom(2, 0, drawn.shipAt)
      over += `<g style="${cameraAt(0, 1, drawn.shipAt)}${run('cam', 2.6, since, 'cubic-bezier(.2,.7,.2,1)')}">${drawn.body}</g>`
    } else if (view.from === 'dock' && since < 2.4) {
      over += cameraFrom(0, 0, drawn.shipAt)
      over += `<g style="${cameraAt(flame, 1, drawn.shipAt)}${run('cam', 2, since)}">${drawn.body}</g>`
    } else if (view.fromLevel !== view.level && since < 2.2) {
      // Typing: each level closes on the ship from where the last one stood.
      over += cameraFrom(ZOOM[view.fromLevel] ?? 0, 1, drawn.shipAt)
      over += `<g style="${cameraAt(flame, 1, drawn.shipAt)}${run('cam', 1.8, since, 'cubic-bezier(.3,0,.2,1)')}">${drawn.body}</g>`
    } else {
      over += `<g style="${cameraAt(flame, 1, drawn.shipAt)}">${drawn.body}</g>`
    }
    body += raised(over)
    if (hasGround) foot += (flame > 0 ? embers(flat, flame * 0.9) : '') + soil(flat)
    else if (flame > 0) body += `<ellipse cx="800" cy="960" rx="640" ry="300" fill="url(#gFire)" opacity="${f1(flame * 0.9)}"/>`
  }

  // The side column: the voyage line of a jump, the words, the squads.
  const gauge = view.phase === 'work' ? `<g style="${view.from === 'work' ? '' : run('show', 1.6, since - 1)}">${hudAxis(voyage, now)}</g>` : ''
  // The side column, right of the conversation, holds the words and the
  // voyage line; the squads have the sky to its left to themselves.
  const side = `<g transform="translate(${f1(o.side ?? 0)} 0)">${gauge}${words(view, now, o)}</g>`
  const squadsDrawn = afield(view.fleet ?? [], now, motion)
  if (o.mark !== undefined && o.mark !== '') body += `<text class="dbg" x="1560" y="${hasGround ? 500 : 880}" text-anchor="end">${esc(o.mark)}</text>`
  // The veil lies over the scene and under the ground, the side column and
  // the squads: the ground is the page's colour already, and small type is
  // better left sharp. One flat shape: it costs nothing.
  const veil = Math.min(0.8, Math.max(0, o.veil ?? 0))
  if (veil > 0) body += `<rect class="veil" x="-3000" y="-3000" width="7600" height="6900" opacity="${f2(veil)}"/>`
  const lab = o.lab ?? []
  if (lab.includes('flat')) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin slice">${SHEET}${DEFS}${body}</svg>`
  }
  // Four drawings in one: the scene, cut to fill the window from its top; the
  // ground, hung from the window's foot and measured in its pixels; the side
  // column, whole, hung just right of the conversation's text; and the
  // squads, in the margin to its left.
  const fill = 'width="100%" height="100%"'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ${fill}>${SHEET}${DEFS}` +
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin slice" ${fill}>${body}</svg>` +
    // A drawing with no viewBox of its own, set down at the foot of the
    // window: one unit in it is one pixel, and what it draws stands above it.
    (foot === '' ? '' : `<svg y="100%" ${fill} style="overflow:visible">${foot}</svg>`) +
    // The strip is hung from the middle of the window, its left edge a fixed
    // way out past the text: the poem nearest the conversation, the rest
    // running out toward the window's edge. Its edge is where the poem
    // begins, so it does not cut: a stroke past its cell, or the column moved
    // in by `side`, still shows.
    (lab.includes('noside')
      ? ''
      : `<svg x="50%" ${fill} style="overflow:visible"><svg x="${TEXT_HALF + VERSE_GAP}" width="600" height="100%" viewBox="${VERSE_LEFT} 0 ${STRIP} ${H}" preserveAspectRatio="xMinYMin meet" style="overflow:visible">${side}</svg></svg>`) +
    // The squads stand in the middle of the margin left of the text: halfway
    // between the window's edge and the text's, which is a quarter of the way
    // across the window less half the text's half. The conversation is
    // centred in the window, and the sidebar's edge, which no drawing is told
    // of, is not something to hang from.
    (squadsDrawn === '' || lab.includes('nosquads')
      ? ''
      : `<svg x="25%" ${fill} style="overflow:visible"><svg x="${-TEXT_HALF / 2 - 300}" width="600" height="100%" viewBox="${SQUAD_MID - STRIP / 2} 0 ${STRIP} ${H}" preserveAspectRatio="xMidYMin meet" style="overflow:visible">${squadsDrawn}</svg></svg>`) +
    `</svg>`
  )
}

/** What the scene shows, for a reader that cannot see it. */
export function describe(view: View): string {
  const squads = (view.fleet ?? []).length
  const beside = squads > 0 ? `；另有 ${squads} 支小队在别的星系` : ''
  if (view.phase === 'work') return `飞船正在星际穿梭，星光拉成长线${beside}`
  if (view.phase === 'dock') return `飞船停在一颗小星球的地平线上，头顶是一条银河${beside}`
  return (view.level > 0 ? '星图上，镜头正在靠近航线上的飞船' : '一张星图：轨道、星座，和一条通向目的地的航线') + beside
}

/**
 * How long a view's first drawing holds something that has to be cleared away,
 * in seconds: words that drift off, or a layer that fades out under the new
 * one. Past it the view can be drawn again clean; 0 when there is nothing.
 */
export function settlesAfter(view: View, poems: readonly Poem[]): number {
  const fading = view.phase === 'dock' ? (view.from === 'cruise' ? 2.6 : 0) : view.phase === 'cruise' && view.from === 'work' ? 3 : 0
  return Math.max(fading, wordsSpan(view, poems))
}
