import type { Graphics } from 'pixi.js'
import type { Deity } from '@/sim/boons'

// The gods are drawn, not sprited: one authored 24x24 mask each, painted at an integer scale from a
// five-tone ramp, exactly like every other pixel in this game.
//
// They are MASKS rather than faces on purpose. A rendered portrait at 24 px is mush, and a mask is
// what the Greeks actually put on a god — votive, theatrical, worn rather than owned. It also lets
// each one be built out of its own iconography instead of a generic head:
//
//   THE KINDLY ONE wears serpents for hair, the Erinys's oldest attribute, over an unmoving face with
//   two ember slits and a single line of blood. Nothing about her is symmetrical below the eyes.
//   HECATE is three-formed and shows it: a full face flanked by two half-profiles looking away down
//   the other two roads, under a pair of torches. She is the only figure here with her own light.
//
// '.' transparent · 'd' shadow · 'm' mass · 'l' bone · 'a' accent · 'h' hot accent
export const MASK_W = 24
export const MASK_H = 24

// Serpents rise, converge into a crown, and the mask hangs beneath them: a dark face lit only at the
// brow, with two ember slits and one line of blood that never dries. The mass is the subject here —
// bone appears as a highlight and nowhere else, because a pale face at this size reads as an egg.
const FURY = [
  '...ah.......a.......ha..',
  '...ha......aha......ah..',
  '....a......a.a......a...',
  '.....aa...aa.aa...aa....',
  '......aa.aa...aa.aa.....',
  '......aaaaaaaaaaaa......',
  '.....mmmmmmmmmmmmmm.....',
  '....mmmmmmmmmmmmmmmm....',
  '....mmllmmmmmmmmllmm....',
  '....mmlmmmmmmmmmmlmm....',
  '....mmmmmmmmmmmmmmmm....',
  '....mmhhhhmmmmhhhhmm....',
  '....mmhaahmmmmhaahmm....',
  '....mmmmmmmmmmmmmmmm....',
  '....mmmrmmmmmmmmmmmm....',
  '.....mmrmmmmmmmmmmm.....',
  '.....mmrmmmmmmmmmmm.....',
  '......mmmmmmmmmmmm......',
  '.......mmmmmmmmmm.......',
  '........mmmmmmmm........',
  '.........mmmmmm.........',
  '..........mmmm..........',
  '...........mm...........',
  '........................',
]

// Three faces at once, which is how she was actually worshipped: the road ahead in bone, and the two
// roads you did not take turned away into the dark on either side. Each of the three has its own eye.
// The torches are the only light source in any of these portraits.
const HECATE = [
  '...h................h...',
  '..hah..............hah..',
  '..aha..............aha..',
  '...a................a...',
  '...a................a...',
  '...a................a...',
  '....mmmmmllllllmmmmm....',
  '....mmmmmllllllmmmmm....',
  '....mmmmmllllllmmmmm....',
  '....mmmmmllllllmmmmm....',
  '....mammmlhllhlmmmam....',
  '....mammmlhllhlmmmam....',
  '....mmmmmllllllmmmmm....',
  '....mmmmmllllllmmmmm....',
  '....mmmmmlallalmmmmm....',
  '....mmmmmllllllmmmmm....',
  '.....mmmmllllllmmmm.....',
  '.....mmmmllllllmmmm.....',
  '......mmmllllllmmm......',
  '.......mmllllllmm.......',
  '........mllllllm........',
  '.........llllll.........',
  '..........llll..........',
  '...........ll...........',
]

export interface MaskPalette { d: number; m: number; l: number; a: number; h: number }

export const DEITY_MASK: Record<Deity, { rows: string[]; palette: MaskPalette }> = {
  fury: {
    rows: FURY,
    // Wine and ash, lit from inside. Her accent is the ember the whole blade family already wears.
    palette: { d: 0x140a10, m: 0x4a2130, l: 0xc9b9a4, a: 0xff7a30, h: 0xffc46a },
  },
  hecate: {
    rows: HECATE,
    // Colder and one step brighter: she carries the only light in the room she stands in.
    palette: { d: 0x0d0d1c, m: 0x2e2a52, l: 0xcfc7e0, a: 0xa878ff, h: 0xffe6a8 },
  },
}

// One extra colour the maps use sparingly and share: the Kindly One's single line of blood.
const BLOOD = 0x9e4658

/** Paint a mask into `g` with its top-left at (x, y), each authored pixel `scale` screen px square. */
export function drawDeityMask(g: Graphics, deity: Deity, x: number, y: number, scale: number): void {
  const { rows, palette } = DEITY_MASK[deity]
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    // Runs of the same tone become one rect: at scale 2 a 24x24 mask is 576 potential quads, and the
    // HUD is redrawn from scratch whenever the offer changes.
    let c = 0
    while (c < row.length) {
      const ch = row[c]
      let end = c
      while (end + 1 < row.length && row[end + 1] === ch) end++
      const span = end - c + 1
      const color = toneOf(ch, palette)
      if (color >= 0) g.rect(x + c * scale, y + r * scale, span * scale, scale).fill(color)
      c = end + 1
    }
  }
}

function toneOf(ch: string, p: MaskPalette): number {
  switch (ch) {
    case 'd': return p.d
    case 'm': return p.m
    case 'l': return p.l
    case 'a': return p.a
    case 'h': return p.h
    case 'r': return BLOOD
    default: return -1
  }
}
