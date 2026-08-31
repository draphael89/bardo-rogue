import { Filter, GlProgram, UniformGroup } from 'pixi.js'
import type { RenderApp } from './app'
import { tuning, TICK_MS } from '@/tuning'

// Pixi v8 default filter vertex shader, copied verbatim from pixi.js/lib/filters/defaults/defaultFilter.vert.
const vertex = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`

// Red samples shifted one way, blue the other. uOffset is in input pixels; uInputSize.zw is 1/size.
const fragment = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec2 uOffset;

void main(void)
{
    vec2 d = uOffset * uInputSize.zw;
    vec4 c = texture(uTexture, vTextureCoord);
    float r = texture(uTexture, clamp(vTextureCoord + d, uInputClamp.xy, uInputClamp.zw)).r;
    float b = texture(uTexture, clamp(vTextureCoord - d, uInputClamp.xy, uInputClamp.zw)).b;
    finalColor = vec4(r, c.g, b, c.a);
}
`

const gradeFragment = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uStrength;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uContrast;
uniform float uSat;
uniform float uShadowLift;
uniform float uShadowFloor;

void main(void)
{
    vec4 src = texture(uTexture, vTextureCoord);
    vec3 c = src.rgb;
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // Lift shadows toward the indigo tint, weighted by darkness. A flat 0.70 mix here applied the
    // pull at every luma, so the brightest colour the art bible allows (#ECF0F6, L240) rendered at
    // L173 and no lane could emit a bright event. Shadows still get the full lift.
    float sw = uShadowLift * (1.0 - smoothstep(0.0, 0.45, luma));
    c = mix(uShadowTint * max(luma, 0.02), c, 1.0 - sw);
    float hi = smoothstep(0.72, 0.96, luma);
    c = mix(c, c * uHighlightTint, hi * 0.38);
    c = (c - 0.5) * uContrast + 0.5;
    c = mix(vec3(luma), c, uSat);
    // The shadow floor. The lift above targets uShadowTint * luma, which is zero at zero, so the
    // darkest pixels had nothing to be lifted TOWARD -- and then the contrast term, pivoting on 0.5,
    // crushed what little was left: the authored void (#08070E, already a blue-violet) rendered at
    // rgb(1,1,4). Measured over the darkest half of the opening frame: mean blue 4, against 13-26
    // on the concept boards. This adds the floor back as a constant, after contrast and saturation
    // so neither can take it away again, and only under the darkest values so it cannot wash the
    // room. It is a FLOOR, not a lift: the dark stays dark, it just stops being neutral black.
    c += uShadowTint * uShadowFloor * (1.0 - smoothstep(0.0, 0.22, luma));
    // Clamped to the palette's ends here once. That was wrong and two blind critics caught it
    // independently: it left impact nowhere to go ("no pixel in ANY of our rendered frames exceeds
    // (236,240,246)"). ART_DIRECTION.md 1.3.4 governs AUTHORED ART -- its acceptance test in 5 says
    // "static-art pixels" -- not a transient additive spark. The palette is the art's job; the grade
    // must leave the top and bottom of the range free for events.
    c = mix(src.rgb, clamp(c, 0.0, 1.0), uStrength);
    finalColor = vec4(c, src.a);
}
`

// Color grade is always on the upscaled quad. Aberration stacks on top only while a pulse runs.
export class PostFx {
  private filter: Filter
  private uniforms: UniformGroup
  private gradeUniforms: UniformGroup
  private grade: Filter
  private left = 0
  private total = 1
  private strength = 0
  private aberrated = false
  private reducedEffects = false

  constructor(private ra: RenderApp) {
    // Both of these run on the UPSCALED quad, and Pixi allocates a filter's intermediate buffer at
    // the filter's own resolution, which defaults to 1 -- CSS pixels. app.ts is careful to pick a
    // scale that is a whole number of PHYSICAL pixels, which on a 2x display legitimately means a
    // fractional CSS scale (a 16-inch MBP at default scaling lands on 3.5). Resolved into a
    // CSS-resolution buffer, that 3.5 becomes alternating 3px and 4px columns and every one-pixel
    // stem in the game comes out uneven. Allocating at the renderer's resolution keeps the whole
    // chain on the integer physical grid app.ts went to the trouble of finding.
    const resolution = ra.app.renderer.resolution
    this.uniforms = new UniformGroup({ uOffset: { value: new Float32Array([0, 0]), type: 'vec2<f32>' } })
    this.filter = new Filter({
      glProgram: GlProgram.from({ vertex, fragment, name: 'aberration-filter' }),
      resources: { aberrationUniforms: this.uniforms },
      resolution,
    })
    const G = tuning.juice.grade
    const gradeUniforms = new UniformGroup({
      uStrength: { value: G.strength, type: 'f32' },
      uShadowTint: { value: new Float32Array([G.shadowR, G.shadowG, G.shadowB]), type: 'vec3<f32>' },
      uHighlightTint: { value: new Float32Array([G.highlightR, G.highlightG, G.highlightB]), type: 'vec3<f32>' },
      uContrast: { value: G.contrast, type: 'f32' },
      uSat: { value: G.sat, type: 'f32' },
      uShadowLift: { value: G.shadowLift, type: 'f32' },
      uShadowFloor: { value: G.shadowFloor, type: 'f32' },
    })
    this.gradeUniforms = gradeUniforms
    this.grade = new Filter({
      glProgram: GlProgram.from({ vertex, fragment: gradeFragment, name: 'grade-filter' }),
      resources: { gradeUniforms },
      resolution,
    })
    // On `frame`, not `screen`: the letterbox paints the same starfield void as the target, and a
    // grade applied to only one of them would split the sky into two blacks at the frame edge.
    this.ra.frame.filters = [this.grade]
  }

  setReducedEffects(reduced: boolean) {
    this.reducedEffects = reduced
    if (reduced) {
      this.left = 0
      this.strength = 0
      if (this.aberrated) this.syncFilters(false)
    }
  }

  pulse(strength = tuning.juice.aberrationStrength, ticks = tuning.juice.aberrationTicks) {
    if (this.reducedEffects) return
    const duration = ticks * TICK_MS / 1000
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(strength) || strength <= 0) return
    if (this.left <= 0) {
      this.total = duration
      this.left = duration
    } else {
      this.left = Math.max(this.left, duration)
      this.total = Math.max(this.total, this.left)
    }
    this.strength = Math.max(this.strength, strength)
  }

  private syncFilters(aberrate: boolean) {
    this.ra.frame.filters = aberrate ? [this.grade, this.filter] : [this.grade]
    this.aberrated = aberrate
  }

  /**
   * `tuning.juice.grade` used to be uploaded ONCE, in the constructor, while `juice.light` is
   * re-read every frame. A tuner editing the grade live saw nothing happen and concluded the knob
   * was dead. This re-upload runs BEFORE the aberration early-out below on purpose: behind it, the
   * grade would only follow the tuning during an aberration pulse.
   */
  private syncGrade() {
    const G = tuning.juice.grade
    const u = this.gradeUniforms.uniforms
    ;(u.uStrength as number) = G.strength
    const sh = u.uShadowTint as Float32Array
    sh[0] = G.shadowR; sh[1] = G.shadowG; sh[2] = G.shadowB
    const hi = u.uHighlightTint as Float32Array
    hi[0] = G.highlightR; hi[1] = G.highlightG; hi[2] = G.highlightB
    ;(u.uContrast as number) = G.contrast
    ;(u.uSat as number) = G.sat
    ;(u.uShadowLift as number) = G.shadowLift
    ;(u.uShadowFloor as number) = G.shadowFloor
    this.gradeUniforms.update()
  }

  update(dtSec: number) {
    this.syncGrade()
    if (this.left <= 0) {
      if (this.aberrated) { this.syncFilters(false); this.strength = 0 }
      return
    }
    this.left -= dtSec
    const k = Math.max(0, Math.min(1, this.left / this.total))
    // §6.8: this filter runs on the UPSCALED frame, so a raw offset lands between target pixels and
    // reads as soft full-res gloss over hard pixels. Quantise to whole target pixels first, then
    // convert to the filter's input pixels (physical: CSS scale x renderer resolution).
    const px = this.ra.scale * this.ra.app.renderer.resolution
    const off = this.uniforms.uniforms.uOffset as Float32Array
    off[0] = Math.round(this.strength * k) * px; off[1] = Math.round(this.strength * k * 0.35) * px
    this.uniforms.update()
    if (!this.aberrated) this.syncFilters(true)
  }
}
