import type { Voyage } from './scene'

// 航程由 `/voyage from`、`/voyage to`、`/voyage port` 设定，存在所有对话共用的设置里，
// 不用改代码。一样都没设时：从第一次装上皮肤那天启航，一年后抵达，沿途没有港湾。

/** 设置里存的航程：日期都写成 YYYY-MM-DD，按本地时间的零点算。 */
export type Plan = {
  from?: string
  to?: string
  /** 终点叫什么，用在“距××还有 N 天”里；不设就叫“终点”。 */
  dest?: string
  ports?: readonly { date: string; name: string }[]
}

/** 终点的名字最多几个字：进度那一列是竖排的，再长就排不下了。 */
export const DEST_ROOM = 6
/** 港湾名最多几个字。 */
export const PORT_ROOM = 8
/** 港湾最多几个。 */
export const PORTS_MOST = 8

const DAY = 864e5

/** 把 YYYY-MM-DD 读成本地零点的时间；不是一个真实存在的日期时给 undefined。 */
export function parseDay(text: string): number | undefined {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim())

  if (match === null) return undefined
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])]
  const at = new Date(year, month, day)

  return at.getFullYear() === year && at.getMonth() === month && at.getDate() === day ? at.getTime() : undefined
}

/** 本地日期写成 YYYY-MM-DD。 */
export function dayOf(at: number): string {
  const d = new Date(at)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 设置里读出来的值，不合格的部分丢掉。 */
export function readPlan(value: unknown): Plan {
  if (typeof value !== 'object' || value === null) return {}
  const raw = value as Record<string, unknown>
  const day = (v: unknown): string | undefined => (typeof v === 'string' && parseDay(v) !== undefined ? v : undefined)
  const ports = Array.isArray(raw.ports)
    ? raw.ports
        .filter((p): p is { date: string; name: string } => typeof p?.name === 'string' && p.name !== '' && day(p?.date) !== undefined)
        .slice(0, PORTS_MOST)
        .map(p => ({ date: p.date, name: [...p.name].slice(0, PORT_ROOM).join('') }))
    : []

  return {
    from: day(raw.from),
    to: day(raw.to),
    dest: typeof raw.dest === 'string' && raw.dest !== '' ? [...raw.dest].slice(0, DEST_ROOM).join('') : undefined,
    ports,
  }
}

/**
 * 画面要的航程：起止时间，抵达日的标签，港湾在航线上的位置（0 是启航，1 是抵达）。
 * `since` 是皮肤第一次装上的那天，没设启航日时从这天算起。
 */
export function voyageOf(plan: Plan, since: number): Voyage {
  const start = plan.from === undefined ? parseDay(dayOf(since))! : parseDay(plan.from)!
  let end = plan.to === undefined ? start + 365 * DAY : parseDay(plan.to)!

  // 抵达日不在启航日之后：按一年算，画面不至于除以零。
  if (end <= start) end = start + 365 * DAY
  const harbors = (plan.ports ?? [])
    .map(p => ({ at: (parseDay(p.date)! - start) / (end - start), name: p.name }))
    .filter(h => h.at > 0 && h.at < 1)
    .sort((a, b) => a.at - b.at)

  return {
    start,
    end,
    endLabel: dayOf(end).replaceAll('-', '.'),
    dest: plan.dest ?? '终点',
    harbors,
  }
}

/**
 * 闲置多少分钟算“缓存凉了”，飞船入港。取的是提示缓存能保持的时间。`/voyage cool 60` 可以改。
 * 比下面的 WARM_MINUTES 小的话，入港后的对话会在别的对话那里显示成暗蓝的“休整”，直到凉了才消失。
 */
export const COOL_MINUTES = 60

/**
 * 一个对话在最后一次活动（回合、打字）之后多少分钟内，别的对话还把它当作在外的小队显示。
 * 取的是提示缓存能保持的时间：缓存还热，回去接着聊就便宜。`/voyage warm 60` 可以改。
 */
export const WARM_MINUTES = 60
