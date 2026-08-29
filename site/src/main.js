/* Star drift for the hero and threshold sections.
   Pixel-aligned squares, subtle twinkle, gentle diagonal drift.
   Reduced motion => a single static render. Offscreen/hidden => paused. */
(() => {
  'use strict'

  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const canvases = [...document.querySelectorAll('canvas.stars')]
  if (canvases.length === 0) return

  const COLD = '#B0C4FF' // canon: star
  const WARM = '#FFE2A0' // canon: goldStar

  const fields = canvases.map((canvas) => ({
    canvas,
    ctx: canvas.getContext('2d'),
    stars: [],
    w: 0,
    h: 0,
    visible: false,
  }))

  const seed = (field) => {
    const { canvas } = field
    const rect = canvas.getBoundingClientRect()
    field.w = Math.max(1, Math.round(rect.width))
    field.h = Math.max(1, Math.round(rect.height))
    const dpr = Math.min(devicePixelRatio || 1, 2)
    canvas.width = field.w * dpr
    canvas.height = field.h * dpr
    field.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // stars live in the upper band, where the art is open void
    const count = Math.round((field.w * field.h) / 32000)
    field.stars = Array.from({ length: count }, () => ({
      x: Math.random() * field.w,
      y: Math.random() * field.h * 0.55,
      size: Math.random() < 0.75 ? 1 : 2,
      warm: Math.random() < 0.33,
      base: 0.25 + Math.random() * 0.4,
      amp: Math.random() * 0.25,
      phase: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.7,
    }))
  }

  const draw = (field, t) => {
    const { ctx, stars, w, h } = field
    ctx.clearRect(0, 0, w, h)
    for (const s of stars) {
      // ~4px/min drift, wrapped; alpha twinkle on a slow sine
      const x = (s.x + t * 0.000065 * s.speed * w) % (w + 4)
      const y = s.y + Math.sin(t * 0.00006 * s.speed) * 2
      ctx.globalAlpha = s.base + s.amp * Math.sin(t * 0.0011 * s.speed + s.phase)
      ctx.fillStyle = s.warm ? WARM : COLD
      ctx.fillRect(Math.round(x), Math.round(y), s.size, s.size)
    }
    ctx.globalAlpha = 1
  }

  let rafId = 0
  const tick = (t) => {
    rafId = 0
    let anyVisible = false
    for (const field of fields) {
      if (!field.visible) continue
      anyVisible = true
      draw(field, t)
    }
    if (anyVisible && !reduced.matches && !document.hidden) {
      rafId = requestAnimationFrame(tick)
    }
  }
  const wake = () => {
    if (!rafId && !reduced.matches && !document.hidden) rafId = requestAnimationFrame(tick)
  }

  const renderStatic = () => fields.forEach((f) => draw(f, 1e6 * Math.random()))

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const field = fields.find((f) => f.canvas === e.target)
        if (field) field.visible = e.isIntersecting
      }
      wake()
    },
    { rootMargin: '80px' },
  )

  for (const field of fields) {
    seed(field)
    io.observe(field.canvas)
    new ResizeObserver(() => {
      seed(field)
      if (reduced.matches) draw(field, 0)
      wake()
    }).observe(field.canvas.parentElement)
  }

  if (reduced.matches) renderStatic()
  else wake()

  reduced.addEventListener('change', () => {
    if (reduced.matches) {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = 0
      renderStatic()
    } else wake()
  })
  document.addEventListener('visibilitychange', wake)
})()
