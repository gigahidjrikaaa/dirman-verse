import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { allEntities, galaxy } from '../data/links'

/**
 * Semi-transparent cluster names floating above each sector's centroid.
 * The label DOM is built imperatively (a React portal inside the Canvas
 * would push div/span through the THREE reconciler and crash), positioned
 * by projecting the centroid every frame. Click-transparent by default.
 */
export function SectorLabels() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const labels = useMemo(() => {
    return galaxy.sectors.map((sector, si) => {
      const suns = allEntities.filter((e) => e.kind === 'sun' && e.sectorId === sector.id)
      const pos = new THREE.Vector3()
      suns.forEach((s) => pos.add(s.center))
      pos.divideScalar(Math.max(suns.length, 1))
      // float above the cluster; inner clusters sit lower on the route so
      // stagger their heights to keep labels from stacking at most angles
      pos.y += 5.5 + si * 1.6
      pos.x += pos.x * 0.045 // tilted outward from the core
      pos.z += pos.z * 0.045
      return { id: sector.id, name: sector.name, hue: sector.hue, pos }
    })
  }, [])

  // built in an effect (not useMemo) so StrictMode's double render can't
  // leak a second container
  const els = useRef<{ container: HTMLDivElement; nodes: HTMLDivElement[] } | null>(null)

  useEffect(() => {
    const container = document.createElement('div')
    container.className = 'sector-labels'
    const nodes = labels.map((l) => {
      const el = document.createElement('div')
      el.className = 'sector-label'
      el.style.color = `hsl(${l.hue} 65% 74%)`
      const star = document.createElement('span')
      star.className = 'sector-label-star'
      star.textContent = '✦'
      const text = document.createElement('span')
      text.textContent = l.name
      el.append(star, text)
      container.appendChild(el)
      return el
    })
    document.body.appendChild(container)
    els.current = { container, nodes }
    return () => {
      container.remove()
      els.current = null
    }
    // galaxy data is static for the lifetime of the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tmp = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    if (!els.current) return
    for (let i = 0; i < els.current.nodes.length; i++) {
      const el = els.current.nodes[i]
      const dist = labels[i].pos.distanceTo(camera.position)
      tmp.copy(labels[i].pos).project(camera)
      const behind = tmp.z > 1
      const x = (tmp.x * 0.5 + 0.5) * size.width
      const y = (-tmp.y * 0.5 + 0.5) * size.height
      const scale = THREE.MathUtils.clamp(130 / dist, 0.45, 1.35)
      el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`
      el.style.opacity = behind ? '0' : String(THREE.MathUtils.clamp(scale - 0.1, 0, 0.55))
    }
  })

  return null
}
