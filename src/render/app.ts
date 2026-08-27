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
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
  await app.init({ background: 0x0b0608, antialias: false, resolution: dpr, autoDensity: true, preference: 'webgl', powerPreference: 'high-performance' })
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
  world.addChild(layers.floor, layers.decals, layers.shadows, layers.entities, layers.light, layers.fx, layers.debug)
  root.addChild(world, layers.hud)

  const arenaOffset = { x: Math.floor((width - arenaPx.w) / 2), y: Math.floor((height - arenaPx.h) / 2) }
  world.position.set(arenaOffset.x, arenaOffset.y)

  const ra: RenderApp = {
    app, root, world, layers, rt, screen, scale: 1, arenaOffset,
    resize() {
      // integer scale in PHYSICAL pixels (crisp on 2x displays); fall back to a fractional fit when the integer
      // scale would waste more than ~30% of the window
      const w = parent.clientWidth || window.innerWidth, h = parent.clientHeight || window.innerHeight
      const fit = Math.min(w * dpr / width, h * dpr / height)
      let phys = Math.max(1, Math.floor(fit))
      if (phys / fit < 0.7) phys = fit
      const s = phys / dpr
      ra.scale = s
      app.renderer.resize(w, h)
      screen.scale.set(s)
      screen.position.set(Math.floor((w - width * s) / 2 * dpr) / dpr, Math.floor((h - height * s) / 2 * dpr) / dpr)
    },
    renderFrame() {
      app.renderer.render({ container: root, target: rt, clear: true })
    },
  }
  ra.resize()
  window.addEventListener('resize', () => ra.resize())
  return ra
}
