import { Application, Container, RenderTexture, Sprite } from 'pixi.js'
import { tuning } from '@/tuning'

// Everything renders into a 480x270 target, then that target is drawn at an integer scale.
export interface RenderApp {
  app: Application
  root: Container          // low-res scene root (world + hud)
  world: Container         // offset by camera/shake
  layers: {
    floor: Container; decals: Container; shadows: Container; projectiles: Container; entities: Container
    fx: Container; light: Container; debug: Container; hud: Container
  }
  rt: RenderTexture
  screen: Sprite
  scale: number
  viewOverride: number
  arenaOffset: { x: number; y: number }
  resize(): void
  onViewResize?: () => void          // fired when the target's WIDTH changed and the scene must re-bake
  renderFrame(): void
}

// The target's width follows the window's aspect so the room is not letterboxed into the middle of a
// wide monitor. HEIGHT NEVER CHANGES: sprite scale, the 16px grid and every tuned distance stay as
// authored; only how much starfield you see to the sides moves. Snapped to 16 so the tile grid still
// lands on whole tiles, floored at 480 so the HUD never has less room than it was laid out for, and
// recomputed on every resize because fullscreen changes the aspect -- a 576-wide target would cap
// fullscreen at the same integer scale as the window and make the button pointless.
// A 16:9 viewport computes to exactly 480, which is what tools/shot.ts opens, so every pinned
// evidence crop keeps its coordinates.
export function fitViewWidth(override = 0): number {
  if (override >= 480) return Math.round(override / 16) * 16
  const aspect = window.innerWidth / Math.max(1, window.innerHeight)
  return Math.max(480, Math.min(768, Math.round((tuning.view.height * aspect) / 16) * 16))
}

export async function createRenderApp(parent: HTMLElement, arenaPx: { w: number; h: number }): Promise<RenderApp> {
  const { height } = tuning.view
  const width = tuning.view.width
  const app = new Application()
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
  // The game loop is the one frame owner. Letting Pixi auto-start its own ticker means the stage can
  // present the previous low-res texture before our RAF has updated it, adding a hidden display frame
  // and making Loop.stats() stop before the work the player actually sees.
  await app.init({ background: 0x0b0608, antialias: false, resolution: dpr, autoDensity: true, preference: 'webgl', powerPreference: 'high-performance', autoStart: false })
  parent.appendChild(app.canvas)
  app.ticker.stop()

  const rt = RenderTexture.create({ width, height, scaleMode: 'nearest' })
  const screen = new Sprite(rt)
  app.stage.addChild(screen)

  const root = new Container()
  const world = new Container()
  const layers = {
    floor: new Container(), decals: new Container(), shadows: new Container(),
    projectiles: new Container(), entities: new Container(), fx: new Container(), light: new Container(), debug: new Container(), hud: new Container(),
  }
  layers.entities.sortableChildren = true
  // Threat geometry stays visible but cannot erase the actor traversing it. Air/contact FX still
  // live above entities; projectile bodies live on their own floor-adjacent plane.
  world.addChild(layers.floor, layers.decals, layers.shadows, layers.projectiles, layers.entities, layers.light, layers.fx, layers.debug)
  root.addChild(world, layers.hud)

  const arenaOffset = { x: Math.floor((width - arenaPx.w) / 2), y: Math.floor((height - arenaPx.h) / 2) }
  world.position.set(arenaOffset.x, arenaOffset.y)

  const ra: RenderApp = {
    app, root, world, layers, rt, screen, scale: 1, arenaOffset, viewOverride: 0,
    resize() {
      // The target may need to get wider or narrower before we fit it: fullscreen changes the aspect.
      const wantW = fitViewWidth(ra.viewOverride)
      if (wantW !== tuning.view.width) {
        tuning.view.width = wantW
        rt.resize(wantW, height)
        arenaOffset.x = Math.floor((wantW - arenaPx.w) / 2)     // mutated in place: light.ts holds this object
        world.position.set(arenaOffset.x, arenaOffset.y)
        ra.onViewResize?.()                                      // re-bake the void and re-place the HUD
      }
      const width = tuning.view.width
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
      // One ordered present: build the pixel-scale scene, then immediately blit that exact texture to
      // the canvas. This call remains inside Loop's timing window, so frame stats are complete.
      app.renderer.render({ container: root, target: rt, clear: true })
      app.render()
    },
  }
  ra.resize()
  window.addEventListener('resize', () => ra.resize())
  return ra
}
