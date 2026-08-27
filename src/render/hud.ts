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
  private bannerTimer = 0
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
    layer.addChild(this.waveText, this.banner, this.sub)
  }
  showBanner(text: string, sub = '', seconds = 1.6) { this.banner.text = text; this.sub.text = sub; this.bannerTimer = seconds; this.banner.scale.set(1.4) }
  update(world: World, dtSec: number) {
    const p = world.player
    for (let i = 0; i < this.hearts.length; i++) this.hearts[i].texture = this.atlas.micro(i < p.hp ? 102 : 100)
    const w = world.wave
    this.waveText.text = w.state === 'active' || w.state === 'pending' ? `WAVE ${Math.max(1, w.index + 1)} / ${w.total}` : w.state === 'done' ? '' : ''
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
  }
}
