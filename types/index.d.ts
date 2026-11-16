/** What the ship is doing: charting a course, under way, or laid up in harbour. */
export type Phase = 'cruise' | 'work' | 'dock'

/**
 * What another session is doing: under way, waiting for its person, laid up in
 * harbour, or held until its person answers it.
 */
export type SquadStatus = 'work' | 'wait' | 'dock' | 'need'

/** Another session, as this one's backdrop shows it. */
export type Squad = { name: string; status: SquadStatus }

/** Everything the backdrop draws from. Times are `$.clock.now()` milliseconds. */
export type View = {
  phase: Phase
  /** How close the camera stands to the ship while the person types: 0 to 3. */
  level: number
  /** What was on screen before this, so the new drawing can start from it. */
  from: Phase
  fromLevel: number
  /** When this view began. */
  at: number
  /** The poem on show, by its index, and when it began; `null` for none. */
  poem: number | null
  poemAt: number
  /** When the progress line began; 0 for none. */
  progressAt: number
  /** The other sessions running beside this one, in the order they are listed. */
  fleet: readonly Squad[]
}

declare module 'claude-code' {
  interface PluginState {
    'star-voyage': { view: Shaped<View> }
  }
}
