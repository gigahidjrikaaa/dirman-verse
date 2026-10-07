/**
 * Orbit-line shader for the clickable systems: each ring carries a bright
 * comet-head sweep that travels around the orbit plus fine dust ticks, so
 * the paths of the links feel alive. aBright dims the halo twin rings.
 */

export const ringVertexShader = /* glsl */ `
attribute vec3 aColor;
attribute float aT;
attribute float aPhase;
attribute float aBright;

varying vec3 vColor;
varying float vT;
varying float vPhase;
varying float vBright;

void main() {
  vColor = aColor;
  vT = aT;
  vPhase = aPhase;
  vBright = aBright;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const ringFragmentShader = /* glsl */ `
uniform float uTime;
uniform float uFlow;

varying vec3 vColor;
varying float vT;
varying float vPhase;
varying float vBright;

void main() {
  // comet-head sweep traveling around the orbit
  float sweep = 0.5 + 0.5 * sin((vT - uTime * 0.07 * uFlow) * 6.2831 + vPhase);
  float head = pow(sweep, 3.0);
  // fine dust ticks along the line
  float ticks = 0.82 + 0.18 * sin(vT * 110.0 + vPhase * 3.0);

  float a = vBright * (0.2 + 0.8 * head) * ticks;
  if (a < 0.004) discard;
  vec3 col = vColor * (0.75 + 0.5 * head);
  gl_FragColor = vec4(col, a);
}
`
