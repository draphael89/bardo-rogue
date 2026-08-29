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

void main(void)
{
    vec4 src = texture(uTexture, vTextureCoord);
    vec3 c = src.rgb;
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // Lift shadows toward the indigo tint, weighted by darkness. A flat 0.70 mix here applied the
    // pull at every luma, so the brightest colour the art bible allows (#ECF0F6, L240) rendered at
    // L173 and no lane could emit a bright event. Shadows still get the full lift.
    float sw = 0.30 * (1.0 - smoothstep(0.0, 0.45, luma));
    c = mix(uShadowTint * max(luma, 0.02), c, 1.0 - sw);
    float hi = smoothstep(0.72, 0.96, luma);
    c = mix(c, c * uHighlightTint, hi * 0.38);
    c = (c - 0.5) * uContrast + 0.5;
    c = mix(vec3(luma), c, uSat);
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
    })
    this.grade = new Filter({
      glProgram: GlProgram.from({ vertex, fragment: gradeFragment, name: 'grade-filter' }),
      resources: { gradeUniforms },
      resolution,
    })
    this.ra.screen.filters = [this.grade]
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
    this.total = ticks * TICK_MS / 1000
    this.left = Math.max(this.left, this.total)
    this.strength = Math.max(this.strength, strength)
  }

  private syncFilters(aberrate: boolean) {
    this.ra.screen.filters = aberrate ? [this.grade, this.filter] : [this.grade]
    this.aberrated = aberrate
  }

  update(dtSec: number) {
    if (this.left <= 0) {
      if (this.aberrated) { this.syncFilters(false); this.strength = 0 }
      return
    }
    this.left -= dtSec
    const k = Math.max(0, this.left / this.total)
    const off = this.uniforms.uniforms.uOffset as Float32Array
    off[0] = this.strength * k; off[1] = this.strength * k * 0.35
    this.uniforms.update()
    if (!this.aberrated) this.syncFilters(true)
  }
}
