import type { Graphics } from 'pixi.js'
import type { Deity } from '@/sim/boons'

// The powers of this realm are drawn, not sprited: one authored 24x24 portrait each, painted at an
// integer scale from a five-tone ramp, exactly like every other pixel in this game.
//
// The two gods are MASKS rather than faces on purpose. A rendered portrait at 24 px is mush, and a
// mask is what the Greeks actually put on a god — votive, theatrical, worn rather than owned. It
// also lets each one be built out of its own iconography instead of a generic head:
//
//   THE KINDLY ONE wears serpents for hair, the Erinys's oldest attribute, over an unmoving face with
//   two ember slits and a single line of blood. Nothing about her is symmetrical below the eyes.
//   HECATE is three-formed and shows it: a full face flanked by two half-profiles looking away down
//   the other two roads, under a pair of torches. She is the only figure here with her own light.
//   THE FERRYMAN is deliberately not a mask, and that difference is the point: he is not a god and
//   is not being worshipped. He is a working body — hood, pole, matted beard, two coins for eyes —
//   and he is the only figure here with shoulders.
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

// The pole first, standing beside him, then a hood lit down one edge by a lamp he is not carrying,
// then a beard that goes on too long. The beard is MASS with a few wet strands through it, not a
// pale bib: at this size anything bone-coloured and wide reads as an egg, which is the same lesson
// the Kindly One's face is built around. His eyes are the fare — two obols, and the only bright
// thing on him. He fills the frame to the bottom edge because unlike the masks he is not hanging in
// an alcove: he is standing in front of you on his own bank, and he has shoulders.
const CHARON = [
  '..ll.....mmmmmm.........',
  '..ll...mmmmmmmmmm.......',
  '..ll..lmmmmmmmmmmm......',
  '..ll..lmmdddddddmmm.....',
  '..ll.lmmdddddddddmm.....',
  '..ll.lmddddddddddmm.....',
  '..ll.lmddahdddhaddm.....',
  '..ll.lmdddaddddaddm.....',
  '..ll.lmddddddddddm......',
  '..ll..lmddddddddmm......',
  '..ll..mmdlllllldmm......',
  '..ll...mdlllllldm.......',
  '..ll....dlllllld........',
  '..ll....dlllllld........',
  '..ll.....dlllld.........',
  '..ll.....dlllld.........',
  '..ll......dllld.........',
  '..ll......dlld..........',
  '..ll..mmmmdlldmmmm......',
  '..llmmmmmmdlldmmmmmm....',
  '.mmmmmmmmmdlldmmmmmmm...',
  '.mmmmmmmmmmdldmmmmmmm...',
  '.mmmmmmmmmmmmmmmmmmmm...',
  '.mmmmmmmmmmmmmmmmmmmm...',
]

// No pole, no fare. A hood and a mouth that has been open too long. The eyes are sockets, not coins:
// he could not pay, and that is the whole of him.
const UNBURIED = [
  '.........mmmmmm.........',
  '.......mmmmmmmmmm.......',
  '......mmmmmmmmmmmm......',
  '.....mmddddddddddmm.....',
  '....mmddddddddddddmm....',
  '....mddddddddddddddm....',
  '....mdddmmddddmmdddm....',
  '....mdddlhldddlhlddm....',
  '....mddddddddddddddm....',
  '....mmddddddddddddmm....',
  '.....mddllllllllldm.....',
  '.....mddllllllllldm.....',
  '......mdllllllllld......',
  '......mdllaalllld.......',
  '.......ddlllllld........',
  '.......ddlllllld........',
  '........dllllld.........',
  '........ddllldd.........',
  '......mmmdddddmmm.......',
  '....mmmmmddddmmmmm......',
  '...mmmmmmddddmmmmmm.....',
  '...mmmmmmmddmmmmmmm.....',
  '...mmmmmmmmmmmmmmmm.....',
  '...mmmmmmmmmmmmmmmm.....',
]

export interface MaskPalette { d: number; m: number; l: number; a: number; h: number }

/** Everyone who can stand on the speaker plate. Only two of them are gods. */
export type PortraitId = Deity | 'charon' | 'unburied'

export const PORTRAIT: Record<PortraitId, { rows: string[]; palette: MaskPalette }> = {
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
  charon: {
    rows: CHARON,
    // River-drowned green over wet grey, and one gold that is not a god's colour but a coin's. The
    // mass has to sit a clear step above the niche behind it or the whole silhouette disappears,
    // and the beard a clear step above the mass or it disappears into the cloak.
    palette: { d: 0x080e0d, m: 0x334440, l: 0x8a9488, a: 0xd4b060, h: 0xffe8b0 },
  },
  unburied: {
    rows: UNBURIED,
    // No fare in the eyes. River-silt and bone, the face of someone who has been waiting.
    palette: { d: 0x0a0c10, m: 0x3a4048, l: 0xb8b0a4, a: 0x8c806f, h: 0xd0c0a8 },
  },
}

// One extra colour the maps use sparingly and share: the Kindly One's single line of blood.
const BLOOD = 0x9e4658

/** Paint a portrait into `g` with its top-left at (x, y), each authored pixel `scale` screen px square. */
export function drawPortrait(g: Graphics, who: PortraitId, x: number, y: number, scale: number): void {
  const { rows, palette } = PORTRAIT[who]
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
