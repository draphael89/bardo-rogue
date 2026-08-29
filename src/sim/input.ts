// One frame of player intent. The input layer builds this; the sim only reads it.
export interface InputFrame {
  moveX: number; moveY: number      // -1..1, normalized by the input layer
  aimX: number; aimY: number        // unit vector from the player toward the aim target
  aimSoft: boolean                  // coarse/contextual aim (movement, arrows, retained): sim may apply assist; Q lock is exact
  attack: boolean                   // pressed this tick (edge / discrete bot request)
  attackHeld: boolean               // physically held; sustains combo flow but is never queued after release
  // The committed swing, as its own verb. It is edge-only and never held: a heavy you did not
  // deliberately ask for is a heavy you resent. It opens from neutral, finishes a chain early, and
  // launches out of a roll — the three places a player wants to spend the commitment.
  heavy: boolean
  dodge: boolean                    // pressed this tick (edge)
  restart: boolean
  choiceDelta?: -1 | 0 | 1        // reward focus, edge-triggered
  confirm?: boolean               // common modal/summary confirmation edge
  reroll?: boolean                // offer only: reforge the three cards, once per run
}

export function emptyInput(): InputFrame {
  return { moveX: 0, moveY: 0, aimX: 1, aimY: 0, aimSoft: false, attack: false, attackHeld: false, heavy: false, dodge: false, restart: false }
}
