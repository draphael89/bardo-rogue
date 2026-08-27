import { Container, Sprite, Text } from 'pixi.js'
import type { Atlas } from './atlas'
import type { World } from '@/sim/world'
import { tuning } from '@/tuning'

// HUD lives inside the low-res target so pixel fonts stay crisp.
export class Hud {
  hearts: Sprite[] = []
  waveText: Text
  banner: Text
  sub: Text
  place: Text
  hint: Text
  private bannerTimer = 0
  private hintTimer = 4.2
  constructor(private atlas: Atlas, private layer: Container) {
    for (let i = 0; i < tuning.player.hp; i++) {
      const s = new Sprite(atlas.micro(102)); s.scale.set(2); s.position.set(8 + i * 18, 6); layer.addChild(s); this.hearts.push(s)
    }
    this.waveText = new Text({ text: '', style: { fontFamily: 'Kenney Pixel', fontSize: 16, fill: 0xf0e0c0 }, resolution: 1 })
    this.waveText.anchor.set(1, 0); this.waveText.position.set(tuning.view.width - 8, 4)
    this.banner = new Text({ text: '', style: { fontFamily: 'Kenney Blocks', fontSize: 24, fill: 0xfff0d0, stroke: { color: 0x2a1010, width: 3 } }, resolution: 1 })
    this.banner.anchor.set(0.5); this.banner.position.set(tuning.view.width / 2, 30)
    this.sub = new Text({ text: '', style: { fontFamily: 'Kenney Pixel', fontSize: 16, fill: 0xf0e0c0 }, resolution: 1 })
    this.sub.anchor.set(0.5); this.sub.position.set(tuning.view.width / 2, 49)
    this.place = new Text({
      text: 'THE THRESHOLD',
      style: { fontFamily: 'Kenney Mini', fontSize: 10, fill: 0xb8c0a0, letterSpacing: 3 },
      resolution: 1,
    })
    this.place.anchor.set(0.5, 1)
    this.place.position.set(tuning.view.width / 2, tuning.view.height - 5)
    this.place.alpha = 0.72
    this.hint = new Text({
      text: 'WASD  ·  mouse  ·  click  ·  space',
      style: { fontFamily: 'Kenney Pixel', fontSize: 8, fill: 0x8a8490 },
      resolution: 1,
    })
    this.hint.anchor.set(0.5, 1)
    this.hint.position.set(tuning.view.width / 2, tuning.view.height - 16)
    this.hint.alpha = 0
    layer.addChild(this.waveText, this.banner, this.sub, this.place, this.hint)
  }
  showBanner(text: string, sub = '', seconds = 1.6) { this.banner.text = text; this.sub.text = sub; this.bannerTimer = seconds; this.banner.scale.set(1.4) }
  clearBanner() { this.bannerTimer = 0; this.banner.visible = this.sub.visible = false }
  update(world: World, dtSec: number) {
    const p = world.player
    for (let i = 0; i < this.hearts.length; i++) this.hearts[i].texture = this.atlas.micro(i < p.hp ? 102 : 100)
    const w = world.wave
    this.waveText.text = w.state === 'active' || w.state === 'pending' ? `WAVE ${Math.max(1, w.index + 1)} / ${w.total}` : ''
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dtSec
      const s = this.banner.scale.x + (1 - this.banner.scale.x) * 0.25
      this.banner.scale.set(s)
      this.banner.visible = this.sub.visible = true
    } else if (p.state === 'dead') {
      this.banner.text = 'YOU DIED'; this.sub.text = 'press R'; this.banner.visible = this.sub.visible = true; this.banner.scale.set(1)
    } else if (w.state === 'done') {
      this.banner.text = 'ROOM CLEARED'; this.sub.text = 'press R to run it again'; this.banner.visible = this.sub.visible = true; this.banner.scale.set(1)
    } else this.banner.visible = this.sub.visible = false

    if (this.hintTimer > 0) {
      this.hintTimer -= dtSec
      this.hint.alpha = this.hintTimer > 1.2 ? 0.55 : Math.max(0, this.hintTimer / 1.2) * 0.55
    } else this.hint.alpha = 0
    this.place.alpha = p.state === 'dead' ? 0.25 : 0.72
  }
}
