import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Container, Graphics } from 'pixi.js'
import { describe, expect, it } from 'vitest'

const source = (rel: string) => readFileSync(fileURLToPath(new URL(`../../src/render/${rel}`, import.meta.url)), 'utf8')

describe('transient Pixi resource lifecycle', () => {
  it('requires context teardown when recursively destroying owned Graphics', () => {
    const root = new Container()
    const graphics = new Graphics().rect(0, 0, 4, 4).fill(0xffffff)
    const context = graphics.context
    root.addChild(graphics)

    root.destroy({ children: true, context: true })

    expect(context.destroyed).toBe(true)
  })

  it('reuses both offscreen render roots instead of growing Pixi batch caches', () => {
    const presenter = source('presenter.ts')
    const particles = source('particles.ts')
    expect(presenter.match(/buildTilemap\([^\n]*this\.tileBakeRoot\)/g)).toHaveLength(2)
    expect(particles).toContain('container: this.decalClearRoot')
    expect(particles).not.toContain('container: new Container()')
  })

  it('releases child Graphics contexts on every recursive transient teardown', () => {
    expect(source('tilemap.ts')).toContain('child.destroy({ children: true, context: true })')
    expect(source('tilemap.ts')).toContain('{ children: true, context: true, ...options }')
    expect(source('reward.ts')).toContain('c.box.destroy({ children: true, context: true })')
  })
})
