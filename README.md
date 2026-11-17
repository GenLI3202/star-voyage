# star-voyage · 星空远征

[简体中文](README.zh-CN.md)

A skin (mod) for the Claude desktop app: a ship flying toward a day you choose — a graduation, a launch, a race, any date worth counting down to.

- **Cruise**: a star chart with the ship at your current progress along the route; planets turn slowly on their orbits. Each time the chart comes back, the side column shows your progress for ten seconds, then it drifts away.
- **Typing**: when you pause, the camera closes in on the ship in three steps by draft length, and the engine glows brighter.
- **Send**: the camera dives into the ship and cuts to a first-person warp, with a vertical progress axis in the side column. When the turn ends it pulls back to the chart and a line of poetry appears.
- **New conversation**: a conversation with no messages yet lies in harbour; the first message lifts it off.
- **Harbour**: after the prompt cache goes cold (60 minutes idle by default) the ship rests on the horizon of a small planet under the Milky Way. Typing sets off again.
- **Poems**: classical Chinese verse about stars and journeys, brushed vertically in the Long Cang typeface, right to left, with the source in small type like a seal.
- **Squads**: your other open conversations appear as squads working in other star systems — a small star, an orbit, a lamp and a name.
- **Day and night**: deep-space colours at night, Claude's warm paper colours by day, following the system's light/dark mode.
- **Two sounds**: one to depart, one to arrive.
- **Light on memory**: by default it animates only while something is happening, and keeps the app's glass panels off. Both were measured; see *Memory*.

The skin's own text (status, commands' answers, poems) is in Chinese.

## Install

In a Claude Code session in a terminal:

```text
/plugin install star-voyage --marketplace GenLI3202/star-voyage
```

Answer `y` to `Add marketplace?`, then pick a scope (user scope is first; press Enter).

Or from a shell:

```bash
claude plugin install star-voyage --marketplace GenLI3202/star-voyage
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `GenLI3202/star-voyage`, then **Add plugin**.

Open conversations pick the skin up once they are idle. `/voyage off` turns it off at any time.

## Set your own voyage

Out of the box the voyage starts on the day you install it and arrives a year later, with no harbours on the way. Make it yours:

```text
/voyage from 2024-09-01             departure
/voyage to 2028-06-30 毕业           arrival, and what it is called (shown as "距毕业还有 N 天", N days to go)
/voyage port 2025-06-01 开题         add a harbour on the route
/voyage port remove 开题             remove one
/voyage port clear                  remove all
/voyage from reset                  departure back to the install day
/voyage to reset                    arrival back to one year later
```

Dates are `YYYY-MM-DD`. The destination name takes up to 6 characters; up to 8 harbours of up to 8 characters each. Only harbours between departure and arrival are drawn. Like every setting, the voyage is shared by all conversations: change it in one and the others follow within ten seconds. `/voyage` on its own shows the current voyage.

## Other commands

- `/voyage` — status: voyage, squads seen, how this conversation is reported.
- `/voyage dock` — into harbour now; `/voyage poem` — a poem now.
- `/voyage motion low|full|calm|still` — animation. `calm` (default) moves only while something happens; `low` redraws a few times a second; `full` is smooth; `still` never moves.
- `/voyage ground <px>` — how much of the window's foot is given to the message box; see *The ground*. Default 120.
- `/voyage glass off` (default) or `/voyage glass <blur 0–64> <opacity 0–1>` — the app's glass panels. `/voyage veil <0–0.8>` sets the scene's own veil.
- `/voyage side <offset>` — move the side column, which stands just right of the conversation's text, further out (up to 200) or a little in (down to −10). With the left sidebar open the text moves right and can run under the poem: `/voyage side 90` clears it.
- `/voyage fleet on|off` — squads; `/voyage warm <minutes>` — how long after its last activity a conversation still shows as a squad.
- `/voyage cool <minutes>` — idle time before harbour; `/voyage sound on|off`.
- `/voyage off` / `/voyage on`.

## The ground

With the glass off, the app lays an opaque slab of the page colour behind the message box, from its top edge to the bottom of the window. It grows with the box (cards above it, a pasted image, several lines), and the skin is told neither that it is there nor how tall it is. Over a planet or a glow it looks like a black box cut out of the picture.

So the skin paints the bottom of the window in that same colour, and the slab vanishes into it. The default, 120 px, covers a one-line message box and the status line. If you often paste images or have cards above the box, raise it to 250–380. `/voyage ground 0` leaves no ground. With the glass on there is no slab and this setting does nothing.

## Squads

- Lamp colours: **green** working (breathing), **blue** waiting for you, **dim blue** idle in harbour, **red** calling you (a question, a plan to approve, a permission request, or a turn that stopped on an error).
- A squad is named after the conversation's title, or its first line, or its folder.
- Only conversations you have sent a message in count, and they show for 60 minutes after their last activity.
- Conversations talk through one folder on this machine, `~/.claude/star-voyage/fleet/`: one small file each (id, display name, status, last activity). Files untouched for a day are removed. Nothing leaves the machine. `/voyage fleet off` stops a conversation showing others and reporting itself.

## Changing the poems

The poems are in `hooks/poems.ts`. They are drawn in Long Cang, carried as glyph outlines in `hooks/glyphs.ts`. After adding lines, regenerate the outlines, or new characters fall back to the system's script face:

```bash
uv run --no-project --with fonttools python3 -I tools/glyphs.py tools/LongCang-Regular.ttf hooks/poems.ts hooks/glyphs.ts
```

## Memory

Measured on a 5K window, reading the app's graphics process (±0.1 GB):

| State | Graphics process |
| --- | --- |
| Skin off | ~1.0 GB |
| Still backdrop, glass off | ~1.05–1.2 GB |
| Animating, glass off | harbour ~1.2 GB, warp ~1.6 GB |
| Still backdrop, glass on | ~1.65–1.8 GB |

- **The glass costs, not the art.** With glass on, even an empty backdrop costs ~0.5 GB more than no skin, and there is no cheap setting: blur 0 and fully transparent costs the same. Hence glass off by default.
- **A still picture is nearly free; animation costs only while it plays.** Hence `calm` by default.
- **Only the conversation on screen draws its backdrop**, however many are open.

For the richer look: `/voyage glass 0 0.2` and `/voyage motion low`.

`/voyage lab <flags>` takes the scene apart for measuring: `scene=cruise|dock|work|verse|workverse|jump`, `motion=…`, `bare`, `colors`, `noglass`, `nostars`, `noglow`, `noside`, `nosquads`, `flat`; `/voyage lab off` to stop.

**An old conversation shows no backdrop at all?** Usually not the skin: the app caps live engine processes (RAM ÷ 3 GB, at least 6), and a conversation only opened for a look gets none over the cap, so no mod loads there. Send a message and it comes back.

## How the desktop app draws it (read before changing the scene)

1. **The app first draws a still version with every animation removed**, so each layer's own style must be its final look; animations only bring things in.
2. **Only SVG that passes a strict check may move**, played as an image: `@media` only for colour scheme and reduced motion, a short list of CSS functions, no `vector-effect`, `shape-rendering`, viewport units or `data:`, `url()` only as `url(#id)`, a single SVG. While playing, the app times each frame and watches for flashing; too costly or too flashy and it falls back to still. `tests/voyage.test.tsx` checks every state against these rules.
3. **With the glass off there is the slab behind the message box** (`data-docked-column-backing`). Anything that must keep clear of it is drawn in a layer hung from the window's bottom edge (`<svg y="100%" style="overflow:visible">`, one unit per pixel, negative y upward).

Squad names are other people's titles; one disallowed character would stop the whole backdrop moving, so names are reduced to letters, digits and plain punctuation before they are drawn.

With the app's background animation setting off, the system's reduce-motion on, or no GPU acceleration, only the still version is drawn.

## Development

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .      # start a session with the skin from this folder
```

## License

Code: MIT, see `LICENSE`. Long Cang glyph outlines © 2018 The Long Cang Project Authors, SIL Open Font License 1.1, see `LICENSE-LongCang.txt`. The poems are classical Chinese texts.
