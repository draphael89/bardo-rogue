import { Texture } from 'pixi.js'
import type { Graphics } from 'pixi.js'
import type { Player } from '@/sim/world'
import { tuning } from '@/tuning'
import { lerp, clamp01, easeOutCubic, easeInCubic } from '../anim'
import { EntityView, HALF_PI } from './shared'

// Authored 16 px bow in the player's five-colour palette plus wood and string.
// Rest hangs on the back. Draw and loose face +x; rotation carries aim.
const BOW_COLORS: Record<string, string> = {
  k: '#3f2631', w: '#8a5a32', h: '#c49058', s: '#bd6c4a', g: '#d4b060', l: '#e8e0d0',
}
const BOW_ART: Record<string, string[]> = {
  rest: [
    '................',
    '......kk........',
    '.....kwwk.......',
    '.....khwk.......',
    '.....kwwk.......',
    '.....kwsk.......',
    '.....kssk.......',
    '.....kssk.......',
    '.....kwsk.......',
    '.....kwwk.......',
    '.....khwk.......',
    '.....kwwk.......',
    '......kk........',
    '................',
    '................',
    '................',
  ],
  draw: [
    '................',
    '...kk...........',
    '..kwwk..........',
    '..khwkk.........',
    '..kwwk.k........',
    '..kwsk..k.......',
    '..kssk...k......',
    '.gggggggllk.....',
    '..kssk...k......',
    '..kwsk..k.......',
    '..kwwk.k........',
    '..khwkk.........',
    '..kwwk..........',
    '...kk...........',
    '................',
    '................',
  ],
  loose: [
    '................',
    '...kk...........',
    '..kwwk..........',
    '..khwk..........',
    '..kwwk..........',
    '..kwsk..........',
    '..kssk.k........',
    '..ksskkk........',
    '..kssk.k........',
    '..kwsk..........',
    '..kwwk..........',
    '..khwk..........',
    '..kwwk..........',
    '...kk...........',
    '................',
    '................',
  ],
}

let bowTextures: Record<string, Texture> | null = null
function bowTexture(key: string): Texture {
  if (!bowTextures) {
    bowTextures = {}
    for (const name in BOW_ART) {
      const rows = BOW_ART[name]
      const c = document.createElement('canvas'); c.width = 16; c.height = 16
      const ctx = c.getContext('2d')!
      for (let y = 0; y < rows.length; y++) for (let x = 0; x < 16; x++) {
        const col = BOW_COLORS[rows[y][x]]
        if (col) { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1) }
      }
      const t = Texture.from(c); t.source.scaleMode = 'nearest'
      bowTextures[name] = t
    }
  }
  return bowTextures[key]!
}

const savedSword = new WeakMap<EntityView, Texture>()

export function updateBow(v: EntityView, p: Player, x: number, y: number, alpha: number, time: number): void {
  const w = v.weapon!
  if (!savedSword.has(v)) savedSword.set(v, w.texture)
  const B = tuning.bow
  const f = p.facing
  const aim = p.state === 'attack' ? p.swingAngle : p.aimAngle
  let key = 'rest'
  let wx = x - f * 5
  let wy = y - 2 + Math.sin(time * 4) * 0.5
  let angle = 0
  let inFront = false
  let ws = 1
  w.anchor.set(0.5, 0.5)

  if (p.state === 'attack') {
    const tk = p.stateTick + alpha
    if (tk < B.draw + 4) {
      // the procedural D is the weapon on these ticks; a second 16 px tile is a brown smear
      w.visible = false
      return
    } else {
      key = tk < B.draw + 4 ? 'loose' : 'rest'
      const u = easeOutCubic(Math.min(1, (tk - B.draw) / B.recover))
      const reach = lerp(8, 4, u)
      wx = x + Math.cos(aim) * reach * (1 - u) + (x - f * 5) * u
      wy = y + Math.sin(aim) * reach * 0.8 * (1 - u) + (y - 2) * u
      angle = lerp(aim, 0, u)
      inFront = u < 0.55
      ws = lerp(1.12, 1, Math.min(1, (tk - B.draw) / 3))
    }
  } else if (p.state === 'dodge') {
    const d = tuning.player.dodge
    const tk = p.stateTick + alpha
    const roll = Math.atan2(p.dodgeDirY, p.dodgeDirX)
    if (tk < d.travel) {
      const pull = clamp01(tk / 3)
      wx = x - Math.cos(roll) * (1 + 2 * pull)
      wy = y + pull
      angle = lerp(0, HALF_PI * 0.4 * f, pull)
      inFront = false
      ws = lerp(1, 0.82, pull)
    } else {
      const u = easeOutCubic((tk - d.travel) / (d.total - d.travel))
      wx = lerp(x - Math.cos(roll) * 3, x - f * 5, u)
      wy = lerp(y + 1, y - 2, u)
      angle = lerp(HALF_PI * 0.4 * f, 0, u)
      inFront = false
      ws = lerp(0.82, 1, u)
    }
  } else if (p.state === 'dead') {
    w.texture = bowTexture('rest')
    w.visible = true
    w.position.set(Math.round(x + f * 6), Math.round(y + 6))
    w.rotation = HALF_PI + 0.3
    w.zIndex = y - 1
    w.scale.set(1)
    w.tint = 0xffffff
    return
  }

  w.texture = bowTexture(key)
  w.visible = true
  w.position.set(Math.round(wx), Math.round(wy))
  w.rotation = key === 'rest' ? angle : angle
  w.zIndex = y + p.radius + 1 + (inFront ? 0.5 : -0.5)
  w.scale.set(ws)
  w.tint = 0xffffff
}

export function restoreSword(v: EntityView): void {
  const tex = savedSword.get(v)
  const w = v.weapon
  if (!tex || !w) return
  w.texture = tex
  w.anchor.set(0.5, 0.85)
  w.tint = 0xffffff
}

// The shot's own silhouette: a D of whole pixels, a taut string, a nocked shaft.
// A rotated 16 px tile dies on the floor; this is the read.
export function drawBowAim(g: Graphics, p: Player, alpha: number): void {
  if (p.state !== 'attack') return
  const B = tuning.bow
  const tk = p.stateTick + alpha
  const a = p.swingAngle
  const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha)
  const ca = Math.cos(a), sa = Math.sin(a)
  const nx = -sa, ny = ca
  const flat = 0.8
  const pix = (px: number, py: number, color: number): void => {
    g.rect(Math.round(px), Math.round(py), 1, 1).fill({ color, alpha: 1 })
  }
  if (tk < B.draw) {
    const u = tk / B.draw
    const grip = 8
    const limb = 8
    const pull = Math.round(lerp(2, 6, u))
    const gx = x + ca * grip, gy = y + sa * grip * flat
    const nockX = gx - ca * pull, nockY = gy - sa * pull * flat
    // two thick wood limbs, 2px, curving back toward the string. Wood only — gold is the string.
    for (const side of [1, -1]) {
      for (let i = 0; i <= limb; i++) {
        const t = i / limb
        const bend = t * (1 - t) * 4
        const lx = gx + nx * side * i - ca * bend
        const ly = gy + ny * side * i * flat - sa * bend * flat
        pix(lx, ly + 1, 0x3f2631)
        pix(lx + nx * side * 0.6, ly + ny * side * 0.5, 0x3f2631)
        pix(lx, ly, i < 2 ? 0xbd6c4a : 0x8a5a32)
        pix(lx + nx * side * 0.6, ly + ny * side * 0.5, 0xc49058)
      }
    }
    // string: one gold pixel wide, tip → nock → tip
    for (const side of [1, -1]) {
      const tx = gx + nx * side * limb - ca * 1.2
      const ty = gy + ny * side * limb * flat - sa * 1.2 * flat
      const n = Math.max(1, Math.round(Math.hypot(nockX - tx, (nockY - ty) / flat)))
      for (let i = 0; i <= n; i++) {
        const t = i / n
        pix(tx + (nockX - tx) * t, ty + (nockY - ty) * t, 0xe8d080)
      }
    }
    // nocked shaft: leather fletch, wood body, bone tip. Crosses the grip.
    const tip = 7
    for (let s = -pull; s <= tip; s++) {
      const px = gx + ca * s, py = gy + sa * s * flat
      if (s >= tip - 1) pix(px, py, 0xffffff)
      else if (s >= tip - 2) pix(px, py, 0xe8e0d0)
      else if (s <= -pull + 1) {
        pix(px + nx, py + ny * flat, 0xbd6c4a)
        pix(px - nx, py - ny * flat, 0xbd6c4a)
        pix(px, py, 0x6a3a22)
      } else pix(px, py, 0x8a5a32)
    }
    // aim ticks start well past the tip so they cannot be read as a second HUD
    for (let s = 22; s <= 40; s += 4) pix(x + ca * s, y + sa * s * flat, 0xc4a060)
    return
  }
  if (tk < B.draw + 5) {
    const fade = 1 - (tk - B.draw) / 5
    const grip = 8
    const gx = x + ca * grip, gy = y + sa * grip * flat
    for (const side of [1, -1]) {
      for (let i = 0; i <= 8; i++) {
        const t = i / 8
        const bend = t * (1 - t) * 1.2
        const lx = gx + nx * side * i + ca * bend
        const ly = gy + ny * side * i * flat + sa * bend * flat
        if (fade > 0.25) pix(lx, ly, t < 0.15 ? 0xbd6c4a : 0x8a5a32)
      }
    }
    // the snap: a hot lobe thrown down the line, then two falling ticks
    const step = Math.min(2, Math.floor(tk - B.draw))
    const span = step === 0 ? 14 : step === 1 ? 10 : 6
    const half = step === 0 ? 2 : 1
    for (let s = 2; s <= span; s++) {
      const hx = gx + ca * s, hy = gy + sa * s * flat
      for (let k = -half; k <= half; k++) {
        const px = hx + nx * k, py = hy + ny * k * flat
        if (step === 0 && s < 6 && Math.abs(k) === 0) pix(px, py, 0xffffff)
        else if (s < span - 2) pix(px, py, 0xffe090)
        else pix(px, py, 0xc49058)
      }
    }
  }
}
