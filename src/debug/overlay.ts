import { Container, Graphics, Text } from 'pixi.js'
import type { World } from '@/sim/world'
import { ARM } from '@/sim/weapons'
import { tuning } from '@/tuning'
import type { Loop } from '@/loop'

// F1 overlay: hurtboxes, active hitboxes, enemy states, frame-time graph.
export class DebugOverlay {
  g = new Graphics()
  hudG = new Graphics()
  labels: Text[] = []
  info: Text
  visible = false
  constructor(private worldLayer: Container, private hudLayer: Container) {
    worldLayer.addChild(this.g)
    hudLayer.addChild(this.hudG)
    this.info = new Text({ text: '', style: { fontFamily: 'Kenney Mini', fontSize: 8, fill: 0x9fe8ff }, resolution: 1 })
    this.info.position.set(4, tuning.view.height - 38)
    hudLayer.addChild(this.info)
    this.setVisible(false)
  }
  setVisible(v: boolean) { this.visible = v; this.g.visible = v; this.hudG.visible = v; this.info.visible = v; for (const l of this.labels) l.visible = v }
  toggle() { this.setVisible(!this.visible) }

  update(world: World, loop: Loop) {
    if (!this.visible) return
    const g = this.g
    g.clear()
    const p = world.player
    g.circle(p.x, p.y, p.radius).stroke({ color: p.iframes > 0 || p.state === 'dodge' ? 0x40ff80 : 0x40c0ff, width: 1 })
    if (p.state === 'attack') {
      if (p.arm === ARM.bow) {
        const drawing = p.stateTick < tuning.bow.draw
        const ca = Math.cos(p.swingAngle), sa = Math.sin(p.swingAngle)
        g.moveTo(p.x, p.y).lineTo(p.x + ca * 80, p.y + sa * 80).stroke({ color: drawing ? 0xffc040 : 0x80ff80, width: 1, alpha: drawing ? 1 : 0.45 })
      } else {
        const s = tuning.player.attack.swings[p.swingIndex]
        const active = p.stateTick > s.startup && p.stateTick <= s.startup + s.active
        const half = s.arcDeg * Math.PI / 360
        g.moveTo(p.x, p.y).arc(p.x, p.y, s.radius, p.swingAngle - half, p.swingAngle + half).lineTo(p.x, p.y).stroke({ color: active ? 0xff4040 : 0xffa040, width: 1, alpha: active ? 1 : 0.5 })
      }
    }
    let li = 0
    for (const e of world.enemies) {
      if (!e.active) continue
      const col = e.state === 'windup' || e.state === 'freeze' || e.state === 'aim' ? 0xffe040 : e.state === 'attack' || e.state === 'dash' ? 0xff4040 : e.state === 'recover' || e.state === 'stagger' ? 0x60ff60 : 0xff80ff
      g.circle(e.x, e.y, e.radius).stroke({ color: col, width: 1 })
      if (e.kind === 'brute' && e.state === 'attack') {
        const B = tuning.brute, half = B.hitArcDeg * Math.PI / 360
        g.moveTo(e.x, e.y).arc(e.x, e.y, B.hitRadius, e.aimAngle - half, e.aimAngle + half).lineTo(e.x, e.y).stroke({ color: 0xff4040, width: 1 })
      }
      if (e.kind === 'warden' && (e.state === 'windup' || e.state === 'attack')) {
        g.circle(e.x, e.y, tuning.warden.slamRadius).stroke({ color: e.state === 'attack' ? 0xff4040 : 0xffe040, width: 1 })
      }
      let l = this.labels[li]
      if (!l) { l = new Text({ text: '', style: { fontFamily: 'Kenney Mini', fontSize: 8, fill: 0xffffff }, resolution: 1 }); l.anchor.set(0.5, 1); this.worldLayer.addChild(l); this.labels.push(l) }
      l.visible = true; l.text = `${e.kind[0]}${e.id} ${e.state}:${e.stateTick} hp${e.hp}`; l.position.set(Math.round(e.x), Math.round(e.y - e.radius - 12))
      li++
    }
    for (let i = li; i < this.labels.length; i++) this.labels[i].visible = false
    for (const b of world.projectiles) if (b.active) g.circle(b.x, b.y, b.radius).stroke({ color: b.team === 1 ? 0xffc040 : 0xff40ff, width: 1 })

    // frame-time graph
    const h = this.hudG
    h.clear()
    const x0 = 4, y0 = tuning.view.height - 4, gw = 120, gh = 24
    h.rect(x0, y0 - gh, gw, gh).fill({ color: 0x000000, alpha: 0.5 })
    h.moveTo(x0, y0 - gh * (16.7 / 33)).lineTo(x0 + gw, y0 - gh * (16.7 / 33)).stroke({ color: 0x40ff80, width: 1, alpha: 0.5 })
    const ft = loop.frameTimes
    for (let i = 0; i < Math.min(gw, ft.length); i++) {
      const v = ft[ft.length - 1 - i]
      const bh = Math.min(gh, v / 33 * gh)
      h.rect(x0 + gw - 1 - i, y0 - bh, 1, bh).fill({ color: v > 16.7 ? 0xff5050 : 0x80c0ff })
    }
    const st = loop.stats()
    this.info.text = `present p95 ${st.render.p95} sim ${st.sim.p95} total ${st.p95} ms long ${st.longPct}% | tick ${world.tick} freeze ${world.freeze} | p ${p.state}:${p.stateTick} hp${p.hp} | enemies ${world.aliveEnemies()} bolts ${world.projectiles.filter(b => b.active).length}`
  }
}
