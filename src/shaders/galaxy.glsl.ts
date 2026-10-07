/**
 * Spiral galaxy backdrop — the "Galaxy Generator" technique:
 * particles distributed along twisted spiral arms with random scatter,
 * rotated differentially in the vertex shader (inner particles orbit faster).
 */

export const galaxyVertexShader = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;
uniform vec3 uClear[9];

attribute float aScale;
attribute vec3 aColor;

varying vec3 vColor;
varying float vDim;

void main() {
  vec3 pos = position;

  // the galaxy keeps its shape (the route is static); life comes from a
  // slow shimmering wave rolling through the disk
  float angle = atan(pos.x, pos.z);
  pos.y += sin(uTime * 0.35 + angle * 2.0) * 0.3;

  // clear a darker pocket around each clickable system so it pops
  float minD = 1e4;
  for (int i = 0; i < 9; i++) {
    minD = min(minD, distance(pos, uClear[i]));
  }
  vDim = mix(0.25, 1.0, smoothstep(2.5, 8.0, minD));

  vec4 modelViewPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * modelViewPosition;

  gl_PointSize = uSize * aScale * uPixelRatio;
  gl_PointSize *= (1.0 / -modelViewPosition.z);
  gl_PointSize = min(gl_PointSize, 10.0 * uPixelRatio);

  vColor = aColor;
}
`

export const galaxyFragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vDim;

void main() {
  float d = distance(gl_PointCoord, vec2(0.5));
  float strength = pow(max(0.0, 1.0 - d * 2.0), 1.8);
  gl_FragColor = vec4(vColor, strength * vDim);
}
`
