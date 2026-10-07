/**
 * True when WebGL is running on a software rasterizer (SwiftShader, llvmpipe).
 * Those machines get the low quality tier from the first frame instead of
 * stumbling through the adaptive governor.
 */
export function detectSoftwareGPU(): boolean {
  try {
    const c = document.createElement('canvas')
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGL2RenderingContext | null
    if (!gl) return true
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
      : ''
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer)
  } catch {
    return true
  }
}

/**
 * Starting quality tier from the device itself, so phones and weak laptops
 * never see the expensive settings before the governor can react.
 *   phones (touch + small screen)            → low
 *   software rasterizer                      → low
 *   few cores / little memory / coarse input → medium
 *   everything else                          → high
 */
export function detectDeviceTier(): 'high' | 'medium' | 'low' {
  if (detectSoftwareGPU()) return 'low'
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const smallScreen = Math.min(window.screen.width, window.screen.height) < 820
    if (coarse && smallScreen) return 'low' // phones
    const cores = navigator.hardwareConcurrency ?? 8
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8
    if (coarse || cores <= 4 || mem <= 4) return 'medium'
  } catch {
    return 'low'
  }
  return 'high'
}
