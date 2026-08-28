export interface Direction {
  x: number
  y: number
}

export interface RetainedAim extends Direction {
  soft: boolean
}

// Analog noise must not steal aim, while a deliberate cardinal-to-diagonal turn should. Keeping
// the comparison anchored to the last movement seen during explicit aim also prevents a slow stick
// arc from walking all the way around the compass without ever releasing ownership.
export const RETAINED_AIM_RELEASE_DEG = 30
const RELEASE_DOT = Math.cos(RETAINED_AIM_RELEASE_DEG * Math.PI / 180)

function direction(x: number, y: number): Direction | null {
  const length = Math.hypot(x, y)
  return length > 0.01 ? { x: x / length, y: y / length } : null
}

// Arrow/right-stick aim is an authored direction, not a momentary modifier. Releasing the explicit
// source keeps that direction while the movement already happening under it merely continues. A
// new movement direction is a fresh facing request and takes ownership back.
export class RetainedExplicitAim {
  private aim: RetainedAim | null = null
  private movementAnchor: Direction | null = null
  private explicitActive = false

  acquire(x: number, y: number, soft: boolean, moveX: number, moveY: number): RetainedAim | null {
    const explicit = direction(x, y)
    if (!explicit) return this.release(moveX, moveY)
    const movement = direction(moveX, moveY)
    if (!this.explicitActive) this.movementAnchor = movement
    else if (movement) this.movementAnchor = movement
    this.explicitActive = true
    this.aim = { ...explicit, soft }
    return this.aim
  }

  release(moveX: number, moveY: number): RetainedAim | null {
    this.explicitActive = false
    if (!this.aim) return null
    const movement = direction(moveX, moveY)
    if (movement && (!this.movementAnchor
      || movement.x * this.movementAnchor.x + movement.y * this.movementAnchor.y < RELEASE_DOT)) {
      this.clear()
    }
    return this.aim
  }

  clear(): void {
    this.aim = null
    this.movementAnchor = null
    this.explicitActive = false
  }
}

export interface ControllerRawState {
  moveActive: boolean
  aimActive: boolean
  buttons: readonly boolean[]
}

export interface ControllerAllowedState {
  move: boolean
  aim: boolean
  buttons: boolean[]
}

// Browsers do not emit controller release events on focus loss or modal changes. This state machine
// gates each stick and button independently until that physical control returns neutral, so a held
// attack cannot resume a combo and a held stick cannot walk the player out of a menu. Independent
// channels matter: releasing attack should rearm attack even if the player is still holding a stick.
export class ControllerRearm {
  private moveArmed = true
  private aimArmed = true
  private buttonArmed: boolean[]
  private lastMoveActive = false
  private lastAimActive = false
  private lastButtons: boolean[]

  constructor(buttonCount = 16) {
    this.buttonArmed = Array.from({ length: buttonCount }, () => true)
    this.lastButtons = Array.from({ length: buttonCount }, () => false)
  }

  // Focus loss has no trustworthy physical snapshot. Require every currently-held control to show
  // a neutral sample before it may drive the game again.
  disarmAll(): void {
    this.moveArmed = false
    this.aimArmed = false
    this.buttonArmed.fill(false)
  }

  // A modal boundary does have a trustworthy prior sample. Disarm only controls that were already
  // down, allowing a genuinely fresh confirm on the first menu tick.
  disarmActive(): void {
    if (this.lastMoveActive) this.moveArmed = false
    if (this.lastAimActive) this.aimArmed = false
    for (let i = 0; i < this.lastButtons.length; i++) {
      if (this.lastButtons[i]) this.buttonArmed[i] = false
    }
  }

  sample(raw: ControllerRawState): ControllerAllowedState {
    if (!this.moveArmed && !raw.moveActive) this.moveArmed = true
    if (!this.aimArmed && !raw.aimActive) this.aimArmed = true
    const buttons = Array.from({ length: this.buttonArmed.length }, (_, i) => {
      const down = !!raw.buttons[i]
      if (!this.buttonArmed[i] && !down) this.buttonArmed[i] = true
      return this.buttonArmed[i] && down
    })
    const allowed = {
      move: this.moveArmed && raw.moveActive,
      aim: this.aimArmed && raw.aimActive,
      buttons,
    }
    this.lastMoveActive = raw.moveActive
    this.lastAimActive = raw.aimActive
    for (let i = 0; i < this.lastButtons.length; i++) this.lastButtons[i] = !!raw.buttons[i]
    return allowed
  }
}
