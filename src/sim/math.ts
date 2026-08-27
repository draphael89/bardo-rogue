export const TAU = Math.PI * 2
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return d
}
export function lerpAngle(a: number, b: number, t: number): number { return a + angleDiff(a, b) * t }
export function len(x: number, y: number): number { return Math.hypot(x, y) }
export function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v }
export function deg(d: number): number { return d * Math.PI / 180 }
