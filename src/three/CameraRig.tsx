import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useGalaxy } from '../state/useGalaxy'
import { getEntity, entityWorldPos, type Entity } from '../data/links'
import { input, pick } from './input'
import { galaxyClock, fx, cometBridge } from './runtime'
import { audio } from '../audio/audio'

const FOV_BASE = 58
const OVERVIEW_RADIUS = 92
const MIN_RADIUS = 7
const MAX_RADIUS = 175

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
function easeOutQuad(t: number) {
  return 1 - (1 - t) * (1 - t)
}

/** how far the camera frames a body on arrival (shared by warp + focus so the handoff is exact) */
function frameDistance(entity: Entity) {
  return entity.kind === 'sun'
    ? Math.max(entity.size * 4.2, 5)
    : THREE.MathUtils.clamp(entity.size * 6, 3, 26)
}

/**
 * Owns the camera state machine and all canvas pointer input.
 *
 * explore — damped spherical orbit around the galaxy core, wheel dolly,
 *           idle drift and mouse parallax
 * warp    — quadratic-bezier flight to the selected body with an FOV punch
 * focus   — damped chase-orbit around the (still orbiting) body
 * fly     — free-flight WASD mode toggled with F
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)

  const sph = useRef({ theta: 0.6, phi: 1.08, radius: OVERVIEW_RADIUS })
  const sphTarget = useRef({ theta: 0.6, phi: 1.08, radius: OVERVIEW_RADIUS })
  const curLook = useRef(new THREE.Vector3())
  const par = useRef({ x: 0, y: 0 })

  const warp = useRef({
    active: false,
    t: 0,
    dur: 2.1,
    fromPos: new THREE.Vector3(),
    ctrl: new THREE.Vector3(),
    entity: null as Entity | null,
    offsetDir: new THREE.Vector3(),
    dist: 6,
    fromLook: new THREE.Vector3(),
  })

  const focus = useRef({ theta: 0, phi: 1.2, radius: 7 })
  /** the explore pitch to restore when leaving a body */
  const returnPhi = useRef(1.08)
  const fly = useRef({
    active: false,
    yaw: 0,
    pitch: 0,
    vel: new THREE.Vector3(),
  })
  const keys = useRef(new Set<string>())
  const firstWarp = useRef(true)

  const reduced = useGalaxy((s) => s.settings.reducedMotion)
  const selectedId = useGalaxy((s) => s.selectedId)
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  // dev-only camera debug handle
  useEffect(() => {
    if (import.meta.env.DEV) {
      const v = new THREE.Vector3()
      ;(window as unknown as Record<string, unknown>).__camDebug = () => ({
        pos: camera.position.toArray().map((x) => +x.toFixed(2)),
        look: curLook.current.toArray().map((x) => +x.toFixed(2)),
        fov: +camera.fov.toFixed(1),
      })
      ;(window as unknown as Record<string, unknown>).__project = (x: number, y: number, z: number) => {
        v.set(x, y, z).project(camera)
        return [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)]
      }
      ;(window as unknown as Record<string, unknown>).__renderInfo = () => {
        const i = gl.info.render
        return { calls: i.calls, points: i.points, triangles: i.triangles }
      }
      ;(window as unknown as Record<string, unknown>).__infoAutoReset = (off: boolean) => {
        gl.info.autoReset = !off
        if (off) gl.info.reset()
        return 'ok'
      }
    }
  }, [camera, gl])

  /* ------------------------------------------------------------------ */
  /* intro: when the preloader lifts, glide down into the overview       */
  /* ------------------------------------------------------------------ */
  const introStarted = useGalaxy((s) => s.introStarted)
  useEffect(() => {
    if (!introStarted) return
    const st = useGalaxy.getState()
    // a deep link is already flying to its star — don't yank the camera home
    if (st.selectedId) return
    if (reducedRef.current) return
    sph.current = { theta: 0.45, phi: 0.48, radius: 235 }
    sphTarget.current = { theta: 0.85, phi: 1.08, radius: OVERVIEW_RADIUS }
    curLook.current.set(0, 0, 0)
    camera.fov = 66
    camera.updateProjectionMatrix()
  }, [introStarted, camera])

  /* ------------------------------------------------------------------ */
  /* selection → warp                                                    */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const id = useGalaxy.getState().selectedId
    const st = useGalaxy.getState()
    if (id) {
      const entity = getEntity(id)
      if (!entity) return
      // remember the overview state so "back" can restore it
      if (st.mode === 'explore') {
        const p = camera.position
        const r = p.length()
        sph.current = {
          theta: Math.atan2(p.z, p.x),
          phi: Math.acos(THREE.MathUtils.clamp(p.y / Math.max(r, 0.001), -1, 1)),
          radius: r,
        }
        returnPhi.current = sph.current.phi
      }
      const w = warp.current
      w.active = true
      w.t = 0
      w.dur = reducedRef.current ? 0.05 : firstWarp.current ? 1.1 : 2.1
      firstWarp.current = false
      w.fromPos.copy(camera.position)
      w.fromLook.copy(curLook.current)
      w.entity = entity

      const bodyPos = entityWorldPos(entity, galaxyClock.t, new THREE.Vector3())
      w.offsetDir.copy(camera.position).sub(bodyPos).normalize()
      if (w.offsetDir.lengthSq() < 0.5) w.offsetDir.set(0.4, 0.35, 0.84).normalize()
      w.dist = frameDistance(entity)
      w.ctrl
        .copy(w.fromPos)
        .add(bodyPos)
        .multiplyScalar(0.5)
        .add(new THREE.Vector3(0, 10, 0))
      fly.current.active = false
      st.setMode('warp')
      st.setWarpEnergy?.(0)
      fx.warp = 0
      audio.whoosh()
    } else if (warp.current.active || st.mode === 'focus') {
      // selection cleared → glide home
      warp.current.active = false
      fx.warp = 0
      // seed the orbit sphere from exactly where the camera is NOW — reusing
      // the stale pre-warp sphere would teleport the camera for one frame
      const p = camera.position
      const r = p.length()
      sph.current = {
        theta: Math.atan2(p.z, p.x),
        phi: THREE.MathUtils.clamp(
          Math.acos(THREE.MathUtils.clamp(p.y / Math.max(r, 0.001), -1, 1)),
          0.15,
          Math.PI - 0.4,
        ),
        radius: THREE.MathUtils.clamp(r, MIN_RADIUS, MAX_RADIUS),
      }
      sphTarget.current = {
        theta: sph.current.theta,
        phi: returnPhi.current,
        radius: OVERVIEW_RADIUS,
      }
      st.setMode('explore')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  /* ------------------------------------------------------------------ */
  /* pointer input (orbit / zoom / pick)                                 */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const el = gl.domElement
    const pointers = new Map<number, { x: number; y: number }>()
    let pinchDist = 0

    const setPointerNDC = (x: number, y: number) => {
      input.nx = (x / el.clientWidth) * 2 - 1
      input.ny = -((y / el.clientHeight) * 2 - 1)
    }

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture?.(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      }
      input.pointerDown = true
      input.moved = 0
      input.lastX = e.clientX
      input.lastY = e.clientY
      input.idleFor = 0
    }

    const onMove = (e: PointerEvent) => {
      setPointerNDC(e.clientX, e.clientY)
      input.idleFor = 0

      const prev = pointers.get(e.pointerId)
      if (!input.pointerDown) return
      if (prev) {
        prev.x = e.clientX
        prev.y = e.clientY
      }

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDist > 0) zoomBy(pinchDist / Math.max(d, 1))
        pinchDist = d
        input.moved += 10
        return
      }

      const dx = e.clientX - input.lastX
      const dy = e.clientY - input.lastY
      input.lastX = e.clientX
      input.lastY = e.clientY
      input.moved += Math.abs(dx) + Math.abs(dy)

      const st = useGalaxy.getState()
      if (st.mode === 'fly') {
        fly.current.yaw -= dx * 0.0032
        fly.current.pitch = THREE.MathUtils.clamp(
          fly.current.pitch - dy * 0.0032,
          -Math.PI / 2 + 0.05,
          Math.PI / 2 - 0.05,
        )
      } else if (st.mode === 'focus') {
        focus.current.theta -= dx * 0.006
        focus.current.phi = THREE.MathUtils.clamp(
          focus.current.phi - dy * 0.004,
          0.15,
          Math.PI - 0.15,
        )
      } else {
        sphTarget.current.theta -= dx * 0.005
        sphTarget.current.phi = THREE.MathUtils.clamp(
          sphTarget.current.phi - dy * 0.004,
          0.12,
          Math.PI - 0.35,
        )
      }
    }

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinchDist = 0
      if (pointers.size === 0) input.pointerDown = false

      const wasClick = input.moved < 7
      if (wasClick) {
        const st = useGalaxy.getState()
        const rect = el.getBoundingClientRect()
        const hit = pick(e.clientX - rect.left, e.clientY - rect.top)
        if (hit?.comet) {
          cometBridge.onClick?.()
        } else if (hit?.entity) {
          if (st.mode === 'focus' && st.selectedId === hit.entity.id) {
            // second click on the same body opens the link
            if (hit.entity.url) window.open(hit.entity.url, '_blank', 'noopener,noreferrer')
          } else {
            st.select(hit.entity.id)
            audio.blip()
          }
        } else if (st.selectedId) {
          st.select(null)
        }
      }
    }

    const zoomBy = (factor: number) => {
      const st = useGalaxy.getState()
      if (st.mode === 'focus') {
        focus.current.radius = THREE.MathUtils.clamp(focus.current.radius * factor, 2.4, 40)
      } else if (st.mode === 'explore') {
        sphTarget.current.radius = THREE.MathUtils.clamp(
          sphTarget.current.radius * factor,
          MIN_RADIUS,
          MAX_RADIUS,
        )
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      input.idleFor = 0
      zoomBy(Math.exp(e.deltaY * 0.0011))
    }

    const onLeave = () => {
      input.pointerDown = false
      pointers.clear()
      useGalaxy.getState().setHovered(null)
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl])

  /* ------------------------------------------------------------------ */
  /* hover picking on pointer move (cheap: runs on the same events)       */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const el = gl.domElement
    const onMove = (e: PointerEvent) => {
      if (input.pointerDown && input.moved >= 7) return
      const st = useGalaxy.getState()
      if (st.paletteOpen || st.settingsOpen) return
      const rect = el.getBoundingClientRect()
      const hit = pick(e.clientX - rect.left, e.clientY - rect.top)
      st.setHovered(hit?.entity?.id ?? null)
    }
    el.addEventListener('pointermove', onMove)
    return () => el.removeEventListener('pointermove', onMove)
  }, [gl])

  /* ------------------------------------------------------------------ */
  /* fly mode keys                                                       */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current.add(e.code)
      if (e.code === 'KeyF' && !e.metaKey && !e.ctrlKey) {
        const st = useGalaxy.getState()
        if (st.mode === 'fly') {
          const p = camera.position
          sphTarget.current = {
            theta: Math.atan2(p.z, p.x),
            phi: 1.08,
            radius: THREE.MathUtils.clamp(p.length(), MIN_RADIUS, MAX_RADIUS),
          }
          st.setMode('explore')
        } else if (st.mode === 'explore') {
          fly.current.active = true
          fly.current.vel.set(0, 0, 0)
          const dir = new THREE.Vector3()
          camera.getWorldDirection(dir)
          fly.current.yaw = Math.atan2(-dir.x, -dir.z)
          fly.current.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))
          st.setMode('fly')
        }
      }
    }
    const up = (e: KeyboardEvent) => keys.current.delete(e.code)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [camera])

  /* ------------------------------------------------------------------ */
  /* frame update                                                        */
  /* ------------------------------------------------------------------ */
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const tmp2 = useMemo(() => new THREE.Vector3(), [])
  const desired = useMemo(() => new THREE.Vector3(), [])
  // dedicated vectors for the warp path — the body position must survive the
  // bezier math below untouched, or the camera looks at the wrong point
  const wBody = useMemo(() => new THREE.Vector3(), [])
  const wA = useMemo(() => new THREE.Vector3(), [])
  const wB = useMemo(() => new THREE.Vector3(), [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    input.idleFor += dt
    const st = useGalaxy.getState()
    const cam = camera

    if (st.mode === 'warp' && warp.current.active) {
      const w = warp.current
      w.t = Math.min(1, w.t + dt / w.dur)
      const e = easeInOutCubic(w.t)
      const entity = w.entity
      if (entity) {
        const bodyPos = entityWorldPos(entity, galaxyClock.t, wBody)
        desired
          .copy(bodyPos)
          .add(tmp.copy(w.offsetDir).multiplyScalar(w.dist))

        // quadratic bezier with a control point arcing above the plane
        w.ctrl.copy(w.fromPos).add(bodyPos).multiplyScalar(0.5)
        w.ctrl.y += 9 + w.fromPos.length() * 0.06

        wA.copy(w.fromPos).lerp(w.ctrl, e)
        wB.copy(w.ctrl).lerp(desired, e)
        cam.position.copy(wA).lerp(wB, e)

        // ease-out: most of the turn happens early, the end of the flight is calm
        curLook.current.copy(w.fromLook).lerp(bodyPos, easeOutQuad(e))
        cam.lookAt(curLook.current)
      }
      const punch = Math.sin(Math.PI * e)
      fx.warp = punch
      cam.fov = FOV_BASE + 16 * punch
      cam.updateProjectionMatrix()
      if (w.t >= 1) {
        w.active = false
        fx.warp = 0
        st.setMode('focus')
        // continue seamlessly from the approach direction: the focus anchor
        // reproduces the exact arrival position, so there is no correction swing
        const entity = w.entity
        if (entity) {
          focus.current.theta = Math.atan2(w.offsetDir.z, w.offsetDir.x)
          focus.current.phi = Math.acos(THREE.MathUtils.clamp(w.offsetDir.y, -1, 1))
          focus.current.radius = w.dist
        }
        // fov glides 58 → 52 through dampFov in focus mode — no snap
      }
      return
    }

    if (st.mode === 'focus') {
      const entity = st.selectedId ? getEntity(st.selectedId) : null
      if (!entity) return
      const bodyPos = entityWorldPos(entity, galaxyClock.t, tmp)
      if (!reducedRef.current && !input.pointerDown) focus.current.theta += dt * 0.04
      const f = focus.current
      desired.set(
        bodyPos.x + f.radius * Math.sin(f.phi) * Math.cos(f.theta),
        bodyPos.y + f.radius * Math.cos(f.phi),
        bodyPos.z + f.radius * Math.sin(f.phi) * Math.sin(f.theta),
      )
      damp3(cam.position, desired, 3.2, dt)
      damp3(curLook.current, bodyPos, 5, dt)
      cam.lookAt(curLook.current)
      dampFov(cam, 52, dt)
      return
    }

    if (st.mode === 'fly' && fly.current.active) {
      const f = fly.current
      const euler = new THREE.Euler(f.pitch, f.yaw, 0, 'YXZ')
      cam.quaternion.setFromEuler(euler)
      const speed = (keys.current.has('ShiftLeft') || keys.current.has('ShiftRight') ? 42 : 16)
      const fwd = tmp.set(0, 0, -1).applyQuaternion(cam.quaternion)
      const right = tmp2.set(1, 0, 0).applyQuaternion(cam.quaternion)
      const acc = desired.set(0, 0, 0)
      if (keys.current.has('KeyW')) acc.add(fwd)
      if (keys.current.has('KeyS')) acc.sub(fwd)
      if (keys.current.has('KeyD')) acc.add(right)
      if (keys.current.has('KeyA')) acc.sub(right)
      if (acc.lengthSq() > 0) acc.normalize().multiplyScalar(speed)
      damp3(f.vel, acc, 3.5, dt)
      cam.position.addScaledVector(f.vel, dt)
      // keep the pilot inside the galaxy neighbourhood
      const len = cam.position.length()
      if (len > MAX_RADIUS * 1.6) cam.position.multiplyScalar((MAX_RADIUS * 1.6) / len)
      return
    }

    // ---- explore ----
    if (!reducedRef.current && input.idleFor > 6 && !input.pointerDown) {
      sphTarget.current.theta += dt * 0.014
    }
    dampSph(sph.current, 'theta', sphTarget.current.theta, 4.5, dt)
    dampSph(sph.current, 'phi', sphTarget.current.phi, 4.5, dt)
    dampSph(sph.current, 'radius', sphTarget.current.radius, 3.5, dt)
    const s = sph.current
    cam.position.set(
      s.radius * Math.sin(s.phi) * Math.cos(s.theta),
      s.radius * Math.cos(s.phi),
      s.radius * Math.sin(s.phi) * Math.sin(s.theta),
    )
    if (!reducedRef.current) {
      par.current.x += (input.nx * 2.2 - par.current.x) * Math.min(1, dt * 2.5)
      par.current.y += (input.ny * 1.4 - par.current.y) * Math.min(1, dt * 2.5)
      cam.position.x += par.current.x
      cam.position.y += par.current.y
    }
    damp3(curLook.current, tmp.set(0, 0, 0), 4, dt)
    cam.lookAt(curLook.current)
    dampFov(cam, FOV_BASE, dt)
  })

  return null
}

type Sph = { theta: number; phi: number; radius: number }
function dampSph(obj: Sph, key: keyof Sph, target: number, lambda: number, dt: number) {
  obj[key] = THREE.MathUtils.damp(obj[key], target, lambda, dt)
}

const _d = new THREE.Vector3()
function damp3(v: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number) {
  _d.copy(target).sub(v).multiplyScalar(1 - Math.exp(-lambda * dt))
  v.add(_d)
}

function dampFov(cam: THREE.PerspectiveCamera, target: number, dt: number) {
  const next = THREE.MathUtils.damp(cam.fov, target, 4, dt)
  if (Math.abs(next - cam.fov) > 0.001) {
    cam.fov = next
    cam.updateProjectionMatrix()
  }
}
