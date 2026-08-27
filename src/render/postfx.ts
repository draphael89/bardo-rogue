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
    c = mix(uShadowTint * max(luma, 0.02), c, 0.70);
    float hi = smoothstep(0.72, 0.96, luma);
    c = mix(c, c * uHighlightTint, hi * 0.38);
    c = (c - 0.5) * uContrast + 0.5;
    c = mix(vec3(luma), c, uSat);
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

  constructor(private ra: RenderApp) {
    this.uniforms = new UniformGroup({ uOffset: { value: new Float32Array([0, 0]), type: 'vec2<f32>' } })
    this.filter = new Filter({
      glProgram: GlProgram.from({ vertex, fragment, name: 'aberration-filter' }),
      resources: { aberrationUniforms: this.uniforms },
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
    })
    this.ra.screen.filters = [this.grade]
  }

  pulse(strength = tuning.juice.aberrationStrength, ticks = tuning.juice.aberrationTicks) {
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
