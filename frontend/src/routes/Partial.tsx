import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import TerrainViewer, {
  type AstronautPosition,
  type CameraMode,
} from './../components/TerrainViewer'
import SidePanel from './../components/SidePanel'
import Loading from './../components/Loading'
import discIcon from './../assets/disc-outline.svg'
import Button from './../components/Button'
import AIOverlay from './../components/AIOverlay'
import { getPoi } from './../data/pois'
import {
  getRouteDurationSeconds,
  getRouteLengthMeters,
  parseResultExample,
} from './../utils/pathy'
import { DEFAULT_ROVER_ID, ROVERS, getRover } from './../utils/rovy'
import {
  formatCoord,
  formatMeters,
  loadTerrain,
  type HoverInfo,
  type TerrainData,
} from './../utils/terrain'
import { createTerrainModel } from './../utils/terrainModel'
import './../App.css'

export default function Partial() {
  const navigate = useNavigate()
  const { poiId } = useParams()
  const poi = getPoi(poiId)
  const [data, setData] = useState<TerrainData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exaggeration, setExaggeration] = useState(3.5)
  const [autoRotate, setAutoRotate] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [cameraMode, setCameraMode] = useState<CameraMode>('perspective')
  const [resetSignal, setResetSignal] = useState(0)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [astronaut, setAstronaut] = useState<AstronautPosition | null>(null)
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number | null>(null)
  const [selectedRoverId, setSelectedRoverId] = useState<string | null>(DEFAULT_ROVER_ID)
  const selectedRover = useMemo(() => getRover(selectedRoverId), [selectedRoverId])

  useEffect(() => {
    setAstronaut(null)
  }, [poi.id])

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    setHover(null)
    loadTerrain(poi.terrainDir)
      .then((terrain) => {
        if (!cancelled) setData(terrain)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not load the elevation model.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [poi])

  const model = useMemo(
    () => (data ? createTerrainModel(data) : null),
    [data],
  )

  const demoRouteData = useMemo(() => parseResultExample(), [])
  const demoRoutes = useMemo(() => demoRouteData.map((r) => r.path), [demoRouteData])
  const routeColors = ['#ff0000', '#ffff00', '#00ff00']
  const routeNames = ['Dangerous', 'Medium', 'Slow']

  const formatDuration = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '—'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.round(seconds % 60)
    if (h > 0) return `${h} h ${m} min`
    if (m > 0) return `${m} min ${s} s`
    return `${s} s`
  }

  const formatLength = (meters: number): string => {
    if (!Number.isFinite(meters)) return '—'
    if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`
    return `${Math.round(meters)} m`
  }

  const meta = data?.meta
  const area = useMemo(() => {
    if (!meta) return null
    return {
      width: (meta.widthMeters / 1000).toFixed(1),
      height: (meta.heightMeters / 1000).toFixed(1),
    }
  }, [meta])

  return (
    <main className="partial-app">
      <div className="partial-stage">
        {model && (
          <TerrainViewer
            model={model}
            exaggeration={exaggeration}
            autoRotate={autoRotate}
            wireframe={wireframe}
            cameraMode={cameraMode}
            resetSignal={resetSignal}
            onHover={setHover}
            onError={setError}
            astronaut={astronaut}
            onAstronautSelect={(position) => {
              setAstronaut(position)
            }}
            routes={demoRoutes}
            routeColors={routeColors}
            selectedRouteIndex={selectedRouteIndex}
          />
        )}
      </div>
      {!data && !error && (
        <Loading
          title="Processing Martian terrain"
          subtitle={`${poi.name} · 1024 × 1024 DEM samples · 1 m/px`}
        />
      )}
      {error && (
        <div className="partial-error" role="alert">
          <p className="partial-error-eyebrow">Could not open viewer</p>
          <h2>{error}</h2>
          <p>
            Check that the model exists in{' '}
            <code>frontend/public/terrain/{poi.terrainDir}</code> and reload the
            page.
          </p>
        </div>
      )}

      {data && meta && (
        <>
          <button
            type="button"
            onClick={() => setResetSignal((signal) => signal + 1)}
            aria-label="Reset view"
            title="Reset view"
            style={{
              position: 'absolute',
              right: '1rem',
              top: '25%',
              zIndex: 10,
              width: '3rem',
              height: '3rem',
              padding: 0,
              border: '2px solid var(--burnt-rose-2)',
              borderRadius: '50%',
              background: 'var(--espresso)',
              color: 'var(--acento)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 18px 40px rgba(0, 0, 0, 0.45)',
            }}
          >
            <img
              src={discIcon}
              alt=""
              aria-hidden="true"
              style={{
                width: '60%',
                height: '60%',
                objectFit: 'contain',
                filter:
                  'brightness(0) saturate(100%) invert(56%) sepia(63%) saturate(1052%) hue-rotate(334deg) brightness(96%) contrast(92%)',
              }}
            />
          </button>

          <div className={`partial-left-group${panelOpen ? ' partial-left-group--open' : ''}`}>
            <SidePanel
              title="Routes"
              open={panelOpen}
              onBack={() => setPanelOpen(false)}
              className="side-panel--terrain"
            >
              <div style={{ display: 'grid', gap: '1rem' }}>
                {(() => {
                  const allHeights = demoRouteData.flatMap((r) => r.heights ?? [])
                  const gMin = allHeights.length ? Math.min(...allHeights) : 0
                  const gMax = allHeights.length ? Math.max(...allHeights) : 1
                  const pad = (gMax - gMin) * 0.08 || 1
                  const minY = gMin - pad
                  const maxY = gMax + pad
                  const W = 260
                  const H = 120
                  const toX = (i: number, n: number) => (n <= 1 ? 0 : (i / (n - 1)) * W)
                  const toY = (v: number) => H - ((v - minY) / (maxY - minY || 1)) * H
                  return (
                    <>
                      <div>
                        <div
                          style={{
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            color: 'var(--tangerine-dream)',
                            marginBottom: '0.35rem',
                          }}
                        >
                          Elevation profile
                        </div>
                        <svg
                          viewBox={`0 0 ${W} ${H}`}
                          width="100%"
                          height="120"
                          role="img"
                          aria-label="Route elevation profile"
                          style={{
                            display: 'block',
                            background: 'var(--superficie)',
                            border: '2px solid var(--burnt-rose-2)',
                            borderRadius: '10px',
                          }}
                        >
                          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                            const y = H - t * H
                            return (
                              <line
                                key={t}
                                x1={0}
                                y1={y}
                                x2={W}
                                y2={y}
                                stroke="var(--burnt-rose-2)"
                                strokeWidth={1}
                                opacity={0.7}
                              />
                            )
                          })}
                          {demoRouteData.map((route, index) => {
                            const heights = route.heights ?? []
                            if (heights.length < 2) return null
                            const color = routeColors[index] ?? '#38bdf8'
                            const isSelected = selectedRouteIndex === index
                            const dimmed = selectedRouteIndex != null && !isSelected
                            const pts = heights.map((h, i) => `${toX(i, heights.length)},${toY(h)}`).join(' ')
                            const area = `${pts} ${W},${H} 0,${H}`
                            return (
                              <g key={index} opacity={dimmed ? 0.25 : 1}>
                                <polygon points={area} fill={color} opacity={isSelected ? 0.28 : 0.18} />
                                <polyline
                                  points={pts}
                                  fill="none"
                                  stroke={color}
                                  strokeWidth={isSelected ? 3 : 2}
                                  strokeLinejoin="round"
                                  strokeLinecap="round"
                                />
                              </g>
                            )
                          })}
                        </svg>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '0.7rem',
                            color: 'var(--texto)',
                            marginTop: '0.25rem',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          <span>{formatMeters(gMin)}</span>
                          <span>{formatMeters(gMax)}</span>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gap: '0.5rem' }}>
                        {demoRouteData.map((route, index) => {
                          const heights = route.heights ?? []
                          const color = routeColors[index] ?? '#38bdf8'
                          const isSelected = selectedRouteIndex === index
                          const dimmed = selectedRouteIndex != null && !isSelected
                          const lengthMeters = model ? getRouteLengthMeters(model, route.path) : 0
                          const durationSeconds = selectedRover
                            ? getRouteDurationSeconds(lengthMeters, selectedRover.velocityMps)
                            : NaN
                          const name = routeNames[index] ?? `Route ${index + 1}`
                          return (
                            <button
                              key={index}
                              type="button"
                              onClick={() => setSelectedRouteIndex(isSelected ? null : index)}
                              className={`btn${isSelected ? ' btn--active' : ''}`}
                              style={{
                                display: 'grid',
                                gap: '0.2rem',
                                textAlign: 'left',
                                padding: '0.55rem 0.7rem',
                                textTransform: 'none',
                                fontWeight: 600,
                                opacity: dimmed ? 0.45 : 1,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--acento)' }}>
                                <span
                                  aria-hidden="true"
                                  style={{
                                    width: '0.7rem',
                                    height: '0.7rem',
                                    borderRadius: '999px',
                                    background: color,
                                    border: '1px solid var(--burnt-rose-2)',
                                    display: 'inline-block',
                                    flex: 'none',
                                  }}
                                />
                                <span>{name}</span>
                              </div>
                              <div style={{ fontSize: '0.78rem', color: 'var(--texto)', fontWeight: 400 }}>
                                <div>Total length: {formatLength(lengthMeters)}</div>
                                <div>Estimated time: {formatDuration(durationSeconds)}</div>
                                {route.total_height_variation != null && (
                                  <div>Total elevation change: {formatMeters(route.total_height_variation)}</div>
                                )}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )
                })()}
              </div>
            </SidePanel>
            <header className="partial-header">
              <p className="partial-eyebrow">{poi.terrainLabel.replace('Marte ·', 'Mars ·')}</p>
              <dl className="partial-facts">
                <div>
                  <dt>Area</dt>
                  <dd>
                    {area?.width} × {area?.height} km
                  </dd>
                </div>
                <div>
                  <dt>Elevation</dt>
                  <dd>
                    {formatMeters(meta.minElevation)} / {formatMeters(meta.maxElevation)}
                  </dd>
                </div>
                <div>
                  <dt>Center</dt>
                  <dd>
                    {formatCoord(meta.center.lat, 'N', 'S')} ·{' '}
                    {formatCoord(meta.center.lon, 'E', 'W')}
                  </dd>
                </div>
              </dl>
            </header>
          </div>

          <figure
            className="partial-legend"
            style={{
              position: 'absolute',
              overflow: 'hidden',
              borderWidth: '1px',
              padding: '0.6rem',
              width: '14rem',
              height: '14rem',
            }}
          >
            {selectedRover && (
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundImage: `url(${selectedRover.photo})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  opacity: 0.18,
                }}
              />
            )}
            <div
              style={{
                position: 'relative',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <figcaption
                style={{
                  margin: 0,
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontFamily: 'var(--fuente-titulo)',
                  color: 'var(--acento)',
                }}
              >
                Rover
              </figcaption>
              <div style={{ fontSize: '0.72rem', color: 'var(--texto)', textAlign: 'right' }}>
                {selectedRover ? (
                  <>
                    <div style={{ color: 'var(--acento)', fontWeight: 700, fontSize: '0.82rem' }}>
                      {selectedRover.name}
                    </div>
                    <div style={{ color: 'var(--tangerine-dream)', fontWeight: 600, marginBottom: '0.25rem' }}>
                      {selectedRover.description}
                    </div>
                    <div>Speed: {selectedRover.velocityMps} m/s</div>
                    <div>Max height diff/m: {selectedRover.maxHeightDiffPerMeter} m/m</div>
                  </>
                ) : (
                  <div style={{ color: 'var(--texto)' }}>No rover selected</div>
                )}
              </div>
            </div>
          </figure>

          <div className={`partial-readout ${hover ? 'is-active' : ''}`}>
            {hover ? (
              <>
                <span className="partial-readout__dot" aria-hidden="true" />
                <strong>{formatMeters(hover.elevation)}</strong>
                <span className="partial-readout__coords">
                  {formatCoord(hover.lat, 'N', 'S')} · {formatCoord(hover.lon, 'E', 'W')}
                </span>
              </>
            ) : (
              <span className="partial-readout__idle">
                {astronaut
                  ? 'Hover over the terrain to read elevation'
                  : 'Click on the terrain to set the astronaut starting position'}
              </span>
            )}
          </div>

          <p className="partial-source">
            Source: {meta.sourceFile} · {meta.crs}
          </p>
        </>
      )}

      <AIOverlay />
    </main>
  )
}
