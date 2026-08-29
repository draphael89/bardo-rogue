import { Application, Container, Graphics, RenderTexture, Sprite } from 'pixi.js'
import { tuning } from '@/tuning'
import { drawLetterboxVoid, VOID_BLACK } from './starfield'

// Everything renders into a 640x360 target (ADR 0002), then that target is drawn at an integer
// scale. The world container renders sim space at tuning.view.worldScale (1.5x); the underlay and
// hud layers are screen space. The letterbox outside the target paints the same starfield void —
// one black to the glass, never two.
export interface RenderApp {
  app: Application
  root: Container          // low-res scene root (underlay + world + hud)
  world: Container         // scaled by view.worldScale; positioned by the follow camera each frame
  frame: Container         // stage side: letterbox void + upscaled target. postfx filters THIS.
  layers: {
    underlay: Container    // screen space, behind the world: the starfield void
    floor: Container; decals: Container; shadows: Container; projectiles: Container; entities: Container
    fx: Container; light: Container; debug: Container; hud: Container
  }
  rt: RenderTexture
  screen: Sprite
  scale: number
  viewOverride: number
  resize(): void
  onViewResize?: () => void          // fired when the target's WIDTH changed and the scene must re-bake
  renderFrame(): void
}

// The target's width follows the window's aspect so the room is not letterboxed into the middle of a
// wide monitor. HEIGHT NEVER CHANGES: sprite scale, the world-render scale and every tuned distance
// stay as authored; only how much starfield you see to the sides moves. Snapped to 16 so widths stay
// tidy, floored at 640 so the HUD never has less room than it was laid out for, and recomputed on
// every resize because fullscreen changes the aspect — a wider target would cap fullscreen at the
// same integer scale as the window and make the button pointless.
// A 16:9 viewport computes to exactly 640, which is what tools/shot.ts opens, so every pinned
// evidence crop keeps its coordinates.
export function fitViewWidth(override = 0): number {
  if (override >= 640) return Math.round(override / 16) * 16
  const aspect = window.innerWidth / Math.max(1, window.innerHeight)
  return Math.max(640, Math.min(1024, Math.round((tuning.view.height * aspect) / 16) * 16))
}

export async function createRenderApp(parent: HTMLElement): Promise<RenderApp> {
  const { height } = tuning.view
  const width = tuning.view.width
  const app = new Application()
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
  // The game loop is the one frame owner. Letting Pixi auto-start its own ticker means the stage can
  // present the previous low-res texture before our RAF has updated it, adding a hidden display frame
  // and making Loop.stats() stop before the work the player actually sees.
  await app.init({ background: VOID_BLACK, antialias: false, resolution: dpr, autoDensity: true, preference: 'webgl', powerPreference: 'high-performance', autoStart: false })
  parent.appendChild(app.canvas)
  app.ticker.stop()

  const rt = RenderTexture.create({ width, height, scaleMode: 'nearest' })
  const screen = new Sprite(rt)
  const letterbox = new Graphics()
  const frame = new Container()
  frame.addChild(letterbox, screen)
  app.stage.addChild(frame)

  const root = new Container()
  const world = new Container()
  world.scale.set(tuning.view.worldScale)
  const layers = {
    underlay: new Container(),
    floor: new Container(), decals: new Container(), shadows: new Container(),
    projectiles: new Container(), entities: new Container(), fx: new Container(), light: new Container(), debug: new Container(), hud: new Container(),
  }
  layers.entities.sortableChildren = true
  // Physical arrows stay below actors so they cannot erase a traversal silhouette. Hostile caster
  // bolts retain their calibrated above-light FX plane and fade locally during a dodge overlap.
  world.addChild(layers.floor, layers.decals, layers.shadows, layers.projectiles, layers.entities, layers.light, layers.fx, layers.debug)
  root.addChild(layers.underlay, world, layers.hud)

  const ra: RenderApp = {
    app, root, world, frame, layers, rt, screen, scale: 1, viewOverride: 0,
    resize() {
      // The target may need to get wider or narrower before we fit it: fullscreen changes the aspect.
      const wantW = fitViewWidth(ra.viewOverride)
      if (wantW !== tuning.view.width) {
        tuning.view.width = wantW
        rt.resize(wantW, height)
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
      drawLetterboxVoid(letterbox, w, h, screen.position.x, screen.position.y, s)
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
