// One frame of player intent. The input layer builds this; the sim only reads it.
export interface InputFrame {
  moveX: number; moveY: number      // -1..1, normalized by the input layer
  aimX: number; aimY: number        // unit vector from the player toward the aim target
  aimSoft: boolean                  // true when aim comes from movement (gamepad w/o right stick): sim applies aim assist
  attack: boolean                   // pressed this tick (edge)
  dodge: boolean                    // pressed this tick (edge)
  restart: boolean
}

export function emptyInput(): InputFrame {
  return { moveX: 0, moveY: 0, aimX: 1, aimY: 0, aimSoft: false, attack: false, dodge: false, restart: false }
}
