import { Application, Container, RenderTexture, Sprite } from 'pixi.js'
import { tuning } from '@/tuning'

// Everything renders into a 480x270 target, then that target is drawn at an integer scale.
export interface RenderApp {
  app: Application
  root: Container          // low-res scene root (world + hud)
  world: Container         // offset by camera/shake
  layers: {
    floor: Container; decals: Container; shadows: Container; entities: Container
    fx: Container; light: Container; debug: Container; hud: Container
  }
  rt: RenderTexture
  screen: Sprite
  scale: number
  arenaOffset: { x: number; y: number }
  resize(): void
  renderFrame(): void
}

export async function createRenderApp(parent: HTMLElement, arenaPx: { w: number; h: number }): Promise<RenderApp> {
  const { width, height } = tuning.view
  const app = new Application()
  await app.init({ background: 0x0b0608, antialias: false, resolution: 1, autoDensity: false, preference: 'webgl', powerPreference: 'high-performance' })
  parent.appendChild(app.canvas)
  app.ticker.maxFPS = 0

  const rt = RenderTexture.create({ width, height, scaleMode: 'nearest' })
  const screen = new Sprite(rt)
  app.stage.addChild(screen)

  const root = new Container()
  const world = new Container()
  const layers = {
    floor: new Container(), decals: new Container(), shadows: new Container(),
    entities: new Container(), fx: new Container(), light: new Container(), debug: new Container(), hud: new Container(),
  }
  layers.entities.sortableChildren = true
  world.addChild(layers.floor, layers.decals, layers.shadows, layers.entities, layers.fx, layers.light, layers.debug)
  root.addChild(world, layers.hud)

  const arenaOffset = { x: Math.floor((width - arenaPx.w) / 2), y: Math.floor((height - arenaPx.h) / 2) }
  world.position.set(arenaOffset.x, arenaOffset.y)

  const ra: RenderApp = {
    app, root, world, layers, rt, screen, scale: 1, arenaOffset,
    resize() {
      const w = parent.clientWidth || window.innerWidth, h = parent.clientHeight || window.innerHeight
      const s = Math.max(1, Math.floor(Math.min(w / width, h / height)))
      ra.scale = s
      app.renderer.resize(w, h)
      screen.scale.set(s)
      screen.position.set(Math.floor((w - width * s) / 2), Math.floor((h - height * s) / 2))
    },
    renderFrame() {
      app.renderer.render({ container: root, target: rt, clear: true })
    },
  }
  ra.resize()
  window.addEventListener('resize', () => ra.resize())
  return ra
}
