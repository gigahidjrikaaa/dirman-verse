import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useGalaxy } from '../state/useGalaxy'
import { flatLinks, getEntity } from '../data/links'
import { audio } from '../audio/audio'

interface Row {
  id: string
  name: string
  system: string
  sector: string
  sectorId: string
  hue: number
  desc?: string
}

/** the full list, in march order (sector by sector, core → rim) */
const ALL: Row[] = flatLinks.map((l) => ({
  id: l.id,
  name: l.name,
  system: l.system,
  sector: l.sector,
  sectorId: l.sectorId,
  hue: getEntity(l.id)?.sectorHue ?? 46,
  desc: getEntity(l.id)?.description,
}))

/**
 * List-based chooser: opens showing every destination grouped by cluster,
 * typing filters the list. Pick with arrows + Enter — no need to know
 * what to search beforehand.
 */
export function CommandPalette() {
  const open = useGalaxy((s) => s.paletteOpen)
  const setOpen = useGalaxy((s) => s.setPaletteOpen)
  const select = useGalaxy((s) => s.select)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ALL
    return ALL.filter((r) =>
      [r.name, r.system, r.sector, r.desc ?? ''].some((t) => t.toLowerCase().includes(q)),
    )
  }, [query])

  // clamp the active row when the list shrinks
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, rows.length - 1)))
  }, [rows.length])

  // keep the active row visible while arrowing through a long list
  useEffect(() => {
    listRef.current
      ?.querySelector('.palette-item.active')
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, rows])

  if (!open) return null

  const choose = (r: Row) => {
    select(r.id)
    setOpen(false)
    audio.blip()
  }

  return (
    <div className="palette-backdrop" onClick={() => setOpen(false)}>
      <div
        className="palette glass"
        role="dialog"
        aria-label="Browse and search the galaxy"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder="Filter destinations — names, clusters, systems…"
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, rows.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter' && rows[active]) {
              choose(rows[active])
            }
          }}
          aria-label="Filter destinations"
        />
        <ul className="palette-results" role="listbox" ref={listRef}>
          {rows.map((r, i) => {
            const newGroup = i === 0 || rows[i - 1].sectorId !== r.sectorId
            return (
              <Fragment key={r.id}>
                {newGroup && (
                  <li className="palette-group" role="presentation">
                    <span
                      className="palette-group-dot"
                      style={{ background: `hsl(${r.hue} 65% 65%)` }}
                    />
                    {r.sector}
                  </li>
                )}
                <li>
                  <button
                    role="option"
                    aria-selected={i === active}
                    data-active={i === active}
                    className={`palette-item ${i === active ? 'active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(r)}
                  >
                    <span className="palette-dot" style={{ background: `hsl(${r.hue} 65% 65%)` }} />
                    <span className="palette-name">{r.name}</span>
                    <span className="palette-sub">{r.system}</span>
                  </button>
                </li>
              </Fragment>
            )
          })}
          {rows.length === 0 && (
            <li className="palette-empty">No destinations match “{query}”</li>
          )}
        </ul>
        <div className="palette-foot">
          <span>{rows.length} of {ALL.length} destinations</span>
          <span>↑↓ choose · Enter warp · Esc close</span>
        </div>
      </div>
    </div>
  )
}
