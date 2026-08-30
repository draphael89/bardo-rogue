import { Filter, GlProgram } from 'pixi.js'

// Pixi rasterises Text through canvas2d fillText/strokeText, and canvas2d ALWAYS anti-aliases: there
// is no flag to turn it off. At resolution 1 inside the render target that is invisible on its own,
// but the target is then magnified by an integer scale, so every grey anti-aliased pixel
// becomes an NxN grey block and the pixel font reads as blurred. Measured on the death card
// before this filter: the title row held 49 distinct colours with 41% of its pixels at intermediate
// values, most of them from the 2px text stroke.
//
// Thresholding alpha snaps every glyph edge back onto the pixel grid. Textures arrive premultiplied,
// so the colour has to be divided out before the new alpha is applied and multiplied back in;
// skipping that step fringes every glyph with a darker halo.
//
// NOT for text with a drop shadow. A shadow is a second, offset, semi-transparent copy of the glyph,
// so most of its pixels sit at partial alpha and ANY threshold shreds them: at 0.65 the death card's
// subtitle broke into fragments, and at 0.35-0.50 its counters filled and its ink went from 2.4% of
// the row to 12.2%. Text drawn without a shadow is close to fully covered and is unaffected at every
// cut, which is why the caller skips shadowed labels rather than tuning the number.
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

const fragment = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);
    vec3 rgb = c.a > 0.004 ? c.rgb / c.a : vec3(0.0);   // un-premultiply before touching alpha
    float a = step(0.5, c.a);                            // the edge is either on the grid or it is not
    finalColor = vec4(rgb * a, a);
}
`

// One shared instance: a filter costs a render pass per filtered object, and every HUD label wants
// exactly the same treatment, so there is no reason for more than one program on the GPU.
export const crispText = new Filter({
  glProgram: GlProgram.from({ vertex, fragment, name: 'crisp-text' }),
  resources: {},
})
