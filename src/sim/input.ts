// One frame of player intent. The input layer builds this; the sim only reads it.
export interface InputFrame {
  moveX: number; moveY: number      // -1..1, normalized by the input layer
  aimX: number; aimY: number        // unit vector from the player toward the aim target
  aimSoft: boolean                  // coarse/contextual aim (movement, arrows, lock, retained): sim may apply assist
  attack: boolean                   // pressed this tick (edge / discrete bot request)
  attackHeld: boolean               // physically held; sustains combo flow but is never queued after release
  dodge: boolean                    // pressed this tick (edge)
  restart: boolean
}

export function emptyInput(): InputFrame {
  return { moveX: 0, moveY: 0, aimX: 1, aimY: 0, aimSoft: false, attack: false, attackHeld: false, dodge: false, restart: false }
}
