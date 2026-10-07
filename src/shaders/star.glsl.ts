/**
 * Per-star rendering: every link gets a celestial archetype (via aStyle)
 * plus a procedural seed (aSeed), so no two bodies look alike. All bodies
 * stay in ONE instanced draw call; discovery/selection rings and the
 * fly-through fade apply uniformly on top of every style.
 */

export const starVertexShader = /* glsl */ `
uniform float uTime;
uniform float uHoverIndex;
uniform float uSelectedIndex;

attribute vec3 aCenter;
attribute vec3 aColor;
attribute float aSize;
attribute float aPhase;
attribute float aKind;
attribute float aCharted;
attribute float aIndex;
attribute float aStyle;
attribute float aSeed;

varying vec2 vUv;
varying vec3 vColor;
varying float vKind;
varying float vCharted;
varying float vSelected;
varying float vFade;
varying float vStyle;
varying float vSeed;

void main() {
  vUv = uv;
  vColor = aColor;
  vKind = aKind;
  vCharted = aCharted;
  vStyle = aStyle;
  vSeed = aSeed;
  vSelected = step(abs(aIndex - uSelectedIndex), 0.5);

  vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);

  float twinkle = 1.0 + 0.16 * sin(uTime * (1.2 + aPhase) + aPhase * 11.0);
  float sunBreath = mix(1.0, 1.0 + 0.07 * sin(uTime * 0.9 + aPhase * 5.0), aKind);
  float isHover = step(abs(aIndex - uHoverIndex), 0.5);
  float hoverPop = isHover * (0.12 + 0.1 * sin(uTime * 7.0));
  float selectedPop = vSelected * 0.18;

  float s = aSize * twinkle * sunBreath * (1.0 + hoverPop + selectedPop);

  // fade out only when the camera is about to fly through the body
  vFade = smoothstep(s * 0.9, s * 1.8, -mv.z);

  mv.xy += position.xy * s;
  gl_Position = projectionMatrix * mv;
}
`

export const starFragmentShader = /* glsl */ `
uniform float uTime;

varying vec2 vUv;
varying vec3 vColor;
varying float vKind;
varying float vCharted;
varying float vSelected;
varying float vFade;
varying float vStyle;
varying float vSeed;

const vec3 GOLD = vec3(1.0, 0.8, 0.38);
const vec3 WHITE = vec3(1.0, 0.95, 0.8);

// seeded per-star pseudo random
float rnd(float n) { return fract(sin(n * 91.3458 + vSeed * 437.2543) * 4713.1419); }
vec2 rot2(vec2 p, float a) {
  float c = cos(a); float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float d = length(p);
  float theta = atan(p.y, p.x);

  float core = 0.0;
  float halo = 0.0;

  if (vKind > 0.5) {
    // ================= suns =================
    if (vStyle < 1.5) {
      // classic: the original blazing core + corona
      core = pow(max(0.0, 1.0 - d), 2.2) * 1.5 + smoothstep(0.2, 0.0, d) * 1.1;
      halo = pow(max(0.0, 1.0 - d), 1.05) * 0.38;
    } else if (vStyle < 2.5) {
      // giant: wide, soft, layered corona
      core = pow(max(0.0, 1.0 - d), 1.6) * 1.1 + smoothstep(0.3, 0.0, d) * 0.85;
      halo = pow(max(0.0, 1.0 - d), 0.85) * 0.55;
      halo += smoothstep(0.5, 0.25, d) * 0.18;
    } else if (vStyle < 3.5) {
      // flame: a flaring limb that breathes
      float flare = 1.0
        + 0.2 * sin(theta * 9.0 + vSeed * 21.0 + uTime * 1.5)
        + 0.11 * sin(theta * 5.0 - uTime * 1.1);
      float rr = d / flare;
      core = pow(max(0.0, 1.0 - rr), 2.0) * 1.35 + smoothstep(0.22, 0.0, rr) * 1.0;
      halo = pow(max(0.0, 1.0 - rr), 1.1) * 0.42;
    } else if (vStyle < 4.5) {
      // pulse: tight core with strobing energy rings
      core = pow(max(0.0, 1.0 - d), 3.0) * 1.7 + smoothstep(0.12, 0.0, d) * 1.3;
      float strobe = 0.5 + 0.5 * sin(uTime * 3.0 + vSeed * 12.0);
      halo  = smoothstep(0.09, 0.0, abs(d - 0.45)) * (0.3 + 0.5 * strobe);
      halo += smoothstep(0.07, 0.0, abs(d - 0.78)) * (0.2 + 0.45 * strobe);
      halo += pow(max(0.0, 1.0 - d), 1.4) * 0.12;
    } else {
      // binary: twin cores on a seeded axis
      vec2 bp = rot2(p, vSeed * 6.2831);
      float d1 = length(bp - vec2(0.17, 0.0));
      float d2 = length(bp + vec2(0.17, 0.0));
      core = pow(max(0.0, 1.0 - d1), 2.4) * 1.15 + smoothstep(0.18, 0.0, d1) * 0.85
           + pow(max(0.0, 1.0 - d2), 2.4) * 0.95 + smoothstep(0.18, 0.0, d2) * 0.75;
      halo = pow(max(0.0, 1.0 - min(d1, d2)), 1.1) * 0.32;
    }
  } else {
    // ================= planets & moons =================
    float body = 1.0 - smoothstep(0.4, 0.5, d);
    float bodyShade = mix(0.75, 1.45, smoothstep(0.45, 0.05, d));
    float rim = (1.0 - smoothstep(0.0, 0.09, abs(d - 0.44))) * 0.3;
    float surface = 0.0;

    if (vStyle < 10.5) {
      // terran: seeded continent blobs
      vec2 rp = rot2(p, vSeed * 6.2831);
      float blob = 0.0;
      blob += smoothstep(0.3, 0.06, length(rp - vec2(rnd(1.0) - 0.5, rnd(2.0) - 0.5) * 0.8));
      blob += smoothstep(0.26, 0.06, length(rp - vec2(rnd(3.0) - 0.5, rnd(4.0) - 0.5) * 0.8));
      blob += smoothstep(0.22, 0.06, length(rp - vec2(rnd(5.0) - 0.5, rnd(6.0) - 0.5) * 0.8));
      surface = clamp(blob, 0.0, 1.0) * 0.5;
    } else if (vStyle < 11.5) {
      // gas: latitude bands with a swirl offset
      float bands = sin(p.y * (7.0 + rnd(1.0) * 5.0) + vSeed * 12.0 + sin(p.x * 2.0 + vSeed * 6.0) * 0.6);
      surface = bands * 0.3;
    } else if (vStyle < 12.5) {
      // ice: pale disc with polar caps
      float cap = smoothstep(0.24, 0.4, abs(p.y));
      surface = cap * 0.6 + 0.2;
      bodyShade = mix(0.95, 1.5, smoothstep(0.45, 0.05, d));
    } else if (vStyle < 13.5) {
      // lava: dark crust, glowing crack veins
      float crack = pow(1.0 - abs(sin(p.x * 7.0 + vSeed * 9.0) * cos(p.y * 6.0 - vSeed * 5.0)), 5.0);
      surface = -0.55;
      core += crack * body * 1.7;
      bodyShade = mix(0.55, 0.95, smoothstep(0.45, 0.05, d));
    } else if (vStyle < 14.5) {
      // ringed: disc with a seeded-tilt ellipse
      vec2 rp = rot2(p, vSeed * 3.1416);
      float rd = abs(length(rp * vec2(1.0, 2.4)) - 0.6);
      core += (1.0 - smoothstep(0.0, 0.06, rd)) * step(0.3, d) * 0.9;
      surface = 0.1;
    } else {
      // rock: crater fields
      vec2 rp = rot2(p, vSeed * 6.2831);
      float cr = 0.0;
      cr += smoothstep(0.12, 0.03, length(rp - vec2(rnd(1.0) - 0.5, rnd(2.0) - 0.5) * 0.7));
      cr += smoothstep(0.08, 0.02, length(rp - vec2(rnd(3.0) - 0.5, rnd(4.0) - 0.5) * 0.7));
      cr += smoothstep(0.06, 0.02, length(rp - vec2(rnd(5.0) - 0.5, rnd(6.0) - 0.5) * 0.7));
      surface = -cr * 0.5;
    }

    core += body * bodyShade * (1.0 + surface) + rim;
    halo = pow(max(0.0, 1.0 - d), 2.6) * 0.32;
  }

  float glow = core + halo;

  // discovery / selection rings — drawn outside every body style
  float ringMask = smoothstep(0.085, 0.0, abs(d - 0.7));
  vec3 ringColor = mix(GOLD, WHITE, vSelected);
  float ring = ringMask * max(vCharted, vSelected) * (0.85 + 0.25 * vSelected);

  float alpha = (glow + ring) * vFade;
  if (alpha < 0.003) discard;
  vec3 color = vColor + ringColor * ring * 0.9;
  gl_FragColor = vec4(color, alpha);
}
`
