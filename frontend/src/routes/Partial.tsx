import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import TerrainViewer, {
  type AstronautPosition,
  type CameraMode,
} from './../components/TerrainViewer'
import SidePanel from './../components/SidePanel'
import Loading from './../components/Loading'
import discIcon from './../assets/disc-outline.svg'
import AIOverlay, {
  type AIActionResult,
  type AIResult,
} from './../components/AIOverlay'
import { getPoi } from './../data/pois'
import {
  getRouteDurationSeconds,
  getRouteLengthMeters,
  parseResultExample,
  type RouteData,
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
import { demPixelToGeo } from './../utils/pathy'
import './../App.css'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const ROUTE_COLORS = ['#ff0000', '#ffff00', '#00ff00']

type Location = {
  name: string
  lat: number
  lon: number
  height: number
  zone: string
}

function formatErrorDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => {
      if (item && typeof item === 'object' && 'msg' in item) {
        const msg = (item as { msg?: unknown }).msg
        return typeof msg === 'string' ? msg : String(msg)
      }
      return formatErrorDetail(item)
    })
    return messages.filter(Boolean).join(', ')
  }
  if (detail && typeof detail === 'object') {
    const msg = (detail as { msg?: unknown }).msg
    if (typeof msg === 'string') return msg
    try {
      return JSON.stringify(detail)
    } catch {
      return String(detail)
    }
  }
  return String(detail ?? 'Error desconocido')
}

async function readError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => null)) as
    | { detail?: unknown }
    | null
  if (data?.detail != null) return formatErrorDetail(data.detail)
  return `Error en servidor (${response.status})`
}

function normalizeRoutes(raw: unknown): RouteData[] {
  if (Array.isArray(raw)) return raw as RouteData[]
  if (!raw || typeof raw !== 'object') return []

  const payload = raw as {
    routes?: RouteData[]
    path?: RouteData['path']
    heights?: number[]
  }
  if (Array.isArray(payload.routes)) return payload.routes
  if (Array.isArray(payload.path)) {
    return [{ path: payload.path, heights: payload.heights }]
  }
  return []
}

function getRouteLabel(route: RouteData, index: number): string {
  const multiplier = route.height_multiplier
  if (multiplier == null) return `Route ${index + 1}`
  if (multiplier <= 1) return 'Dangerous'
  if (multiplier <= 5) return 'Medium'
  return 'Slow'
}

export default function Partial() {
  const { poiId } = useParams()
  const poi = getPoi(poiId)
  const [data, setData] = useState<TerrainData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const exaggeration = 3.5
  const autoRotate = false
  const wireframe = false
  const cameraMode: CameraMode = 'perspective'
  const [resetSignal, setResetSignal] = useState(0)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [astronaut, setAstronaut] = useState<AstronautPosition | null>(null)
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number | null>(null)
  const [selectedRoverId, setSelectedRoverId] = useState<string | null>(DEFAULT_ROVER_ID)
  const [routeData, setRouteData] = useState<RouteData[]>([])
  const [routeDestination, setRouteDestination] = useState<string | null>(null)
  const [routeStart, setRouteStart] = useState<AstronautPosition | null>(null)
  const [routeEnd, setRouteEnd] = useState<{ name: string; lat: number; lon: number } | null>(null)
  const [routeChosen, setRouteChosen] = useState(false)
  const [focusTarget, setFocusTarget] = useState<{ lat: number; lon: number } | null>(null)
  const [zoneLocations, setZoneLocations] = useState<Location[]>([])
  const selectedRover = useMemo(() => getRover(selectedRoverId), [selectedRoverId])

  useEffect(() => {
    setAstronaut(null)
    setSelectedRouteIndex(null)
    setRouteChosen(false)
    setRouteEnd(null)
    setRouteData([])
    setRouteDestination(null)
    setRouteStart(null)
    setZoneLocations([])
  }, [poi.id])

  useEffect(() => {
    let cancelled = false
    const loadLocations = async () => {
      try {
        const response = await fetch(`${API_URL}/locations/${encodeURIComponent(poi.id)}`)
        if (!response.ok) return
        const payload = (await response.json()) as { locations?: Location[] }
        if (!cancelled && Array.isArray(payload.locations)) {
          setZoneLocations(payload.locations)
        }
      } catch {
        // ignore
      }
    }
    void loadLocations()
    return () => {
      cancelled = true
    }
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

  const routePaths = useMemo(
    () => routeData.map((route) => route.path),
    [routeData],
  )
  const recalculateRoutes = useCallback(
    async (
      rover: ReturnType<typeof getRover>,
      start: AstronautPosition | null = routeStart,
      end: { name: string; lat: number; lon: number } | null = routeEnd,
    ) => {
      if (!data || !model || !start || !end || !rover) return
      try {
        const pixelSize =
          typeof data.meta.sourcePixelSizeMeters === 'number'
            ? data.meta.sourcePixelSizeMeters
            : data.meta.sourcePixelSizeMeters?.x
        const maxHeightDiff =
          pixelSize != null && Number.isFinite(pixelSize) && pixelSize > 0
            ? rover.maxHeightDiffPerMeter * pixelSize
            : rover.maxHeightDiffPerMeter
        const pathSource =
          (data.meta.sourceFile || poi.id).split(/[\\/]/).pop() ?? poi.id
        const pathZone = pathSource.replace(/\.tiff?$/i, '')
        const pathResponse = await fetch(`${API_URL}/path`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            zone: pathZone,
            start: { lat: start.lat, lon: start.lon },
            end: { lat: end.lat, lon: end.lon },
            max_height_diff: maxHeightDiff,
            multipliers: [1, 5, 50],
          }),
        })
        if (!pathResponse.ok) return
        const routes = normalizeRoutes(await pathResponse.json())
        if (routes.length === 0) return
        setRouteData(routes)
        setSelectedRouteIndex(null)
        setRouteChosen(false)
      } catch {
        // ignore
      }
    },
    [data, model, routeStart, routeEnd, poi.id],
  )

  const handleDestinationChange = useCallback(
    (name: string) => {
      const destination = zoneLocations.find((location) => location.name === name)
      if (!destination) return
      const newEnd = { name: destination.name, lat: destination.lat, lon: destination.lon }
      const start = routeStart ?? astronaut
      setRouteEnd(newEnd)
      setRouteDestination(destination.name)
      if (start) {
        void recalculateRoutes(selectedRover, start, newEnd)
      }
    },
    [zoneLocations, routeStart, astronaut, recalculateRoutes, selectedRover],
  )

  useEffect(() => {
    const rover = getRover(selectedRoverId)
    if (rover && routeEnd && routeStart) {
      void recalculateRoutes(rover)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoverId])

  const executeAIAction = useCallback(
    async (
      ai: AIResult,
      signal: AbortSignal,
    ): Promise<AIActionResult> => {
      const action = (ai.action || '').toLowerCase()
      const isPathAction =
        action === 'navigate_to' ||
        action.includes('path') ||
        action.includes('route') ||
        action.includes('ruta')

      if (!isPathAction) {
        return {
          ok: true,
          message: 'La IA no ha solicitado calcular una ruta.',
        }
      }

      if (!data || !model) {
        return { ok: false, message: 'El terreno aún no está cargado.' }
      }

      if (!astronaut) {
        return {
          ok: false,
          message:
            'Coloca primero el astronauta haciendo clic sobre el terreno.',
        }
      }

      const endName =
        typeof ai.options?.end === 'string' ? ai.options.end : null
      if (!endName) {
        return {
          ok: false,
          message: 'La IA no ha identificado un destino válido.',
        }
      }

      const roverId =
        typeof ai.options?.rover === 'string' ? ai.options.rover : null
      const rover = getRover(roverId) ?? selectedRover
      if (!rover) {
        return {
          ok: false,
          message: 'No hay un rover disponible para calcular la ruta.',
        }
      }
      setSelectedRoverId(rover.id)

      try {
        const fetchLocations = async (path: string): Promise<Location[]> => {
          const response = await fetch(`${API_URL}${path}`, { signal })
          if (!response.ok) return []
          const payload = (await response.json()) as {
            locations?: Location[]
          }
          return Array.isArray(payload.locations) ? payload.locations : []
        }

        const findLocation = (locations: Location[]) =>
          locations.find(
            (location) =>
              location.name.trim().toLowerCase() ===
              endName.trim().toLowerCase(),
          )

        let locations = await fetchLocations(
          `/locations/${encodeURIComponent(poi.id)}`,
        )
        let end = findLocation(locations)

        if (!end) {
          locations = await fetchLocations('/locations')
          end = findLocation(locations)
        }

        if (!end) {
          return {
            ok: false,
            message: `No se encontraron coordenadas para "${endName}" en la zona ${poi.id}.`,
          }
        }
        const destination = end
        const bounds = data.meta.bounds
        if (
          destination.lat < bounds.latMin ||
          destination.lat > bounds.latMax ||
          destination.lon < bounds.lonMin ||
          destination.lon > bounds.lonMax
        ) {
          return {
            ok: false,
            message: `Las coordenadas de "${destination.name}" no están dentro de ${poi.name}. Revisa data/locations.csv.`,
          }
        }

        const pixelSize =
          typeof data.meta.sourcePixelSizeMeters === 'number'
            ? data.meta.sourcePixelSizeMeters
            : data.meta.sourcePixelSizeMeters?.x
        const maxHeightDiff =
          pixelSize != null && Number.isFinite(pixelSize) && pixelSize > 0
            ? rover.maxHeightDiffPerMeter * pixelSize
            : rover.maxHeightDiffPerMeter
        const pathSource =
          (data.meta.sourceFile || poi.id).split(/[\\/]/).pop() ?? poi.id
        const pathZone = pathSource.replace(/\.tiff?$/i, '')

        const pathResponse = await fetch(`${API_URL}/path`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            zone: pathZone,
            start: { lat: astronaut.lat, lon: astronaut.lon },
            end: { lat: destination.lat, lon: destination.lon },
            max_height_diff: maxHeightDiff,
            multipliers: [1, 5, 50],
          }),
          signal,
        })
        if (!pathResponse.ok) {
          return { ok: false, message: await readError(pathResponse) }
        }

        const routes = normalizeRoutes(await pathResponse.json())
        if (routes.length === 0) {
          return {
            ok: false,
            message: 'El servidor no devolvió ninguna ruta.',
          }
        }

        setRouteData(routes)
        setSelectedRouteIndex(null)
        setRouteChosen(false)
        setRouteDestination(destination.name)
        setRouteStart({ ...astronaut })
        setRouteEnd({ name: destination.name, lat: destination.lat, lon: destination.lon })
        return {
          ok: true,
          message: `Ruta generada correctamente. ${routes.length} rutas calculadas.`,
        }
      } catch (cause) {
        if (
          typeof cause === 'object' &&
          cause !== null &&
          (cause as { name?: string }).name === 'AbortError'
        ) {
          return { ok: false, message: 'Operación cancelada.' }
        }
        return {
          ok: false,
          message:
            cause instanceof Error
              ? cause.message
              : 'Error al calcular la ruta.',
        }
      }
    },
    [astronaut, data, model, poi.id, poi.name, selectedRover],
  )

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
            routes={routePaths}
            routeColors={ROUTE_COLORS}
            selectedRouteIndex={selectedRouteIndex}
            focusTarget={focusTarget}
            pins={zoneLocations}
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
              top: '1rem',
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
              title="Panel"
              open={panelOpen}
              onBack={() => setPanelOpen(false)}
              className="side-panel--terrain"
            >
              <div style={{ display: 'grid', gap: '1rem' }}>
                {astronaut && (
                  <section>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--acento)', marginBottom: '0.25rem' }}>
                      Posición seleccionada
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--texto)' }}>
                      {formatCoord(astronaut.lat, 'N', 'S')} · {formatCoord(astronaut.lon, 'E', 'W')}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--texto)' }}>
                      Elevación: {formatMeters(astronaut.elevation)}
                    </div>
                  </section>
                )}

                {routeData.length > 0 && (
                  <section style={{ display: 'grid', gap: '0.6rem' }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--acento)', textTransform: 'uppercase' }}>Inicio</div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--texto)' }}>Your position</div>
                      {routeStart && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--texto)' }}>
                          {formatCoord(routeStart.lat, 'N', 'S')} · {formatCoord(routeStart.lon, 'E', 'W')}
                        </div>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--acento)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Destino</div>
                      {routeChosen || zoneLocations.length === 0 ? (
                        <div style={{ fontSize: '0.82rem', color: 'var(--texto)' }}>{routeDestination ?? '—'}</div>
                      ) : (
                        <select
                          value={routeEnd?.name ?? routeDestination ?? ''}
                          onChange={(e) => handleDestinationChange(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '0.45rem 0.5rem',
                            borderRadius: '8px',
                            border: '2px solid var(--burnt-rose-2)',
                            background: 'var(--superficie)',
                            color: 'var(--texto)',
                            font: 'inherit',
                          }}
                        >
                          {routeEnd && !zoneLocations.some((location) => location.name === routeEnd.name) && (
                            <option value={routeEnd.name}>{routeEnd.name}</option>
                          )}
                          {zoneLocations.map((location) => (
                            <option key={location.name} value={location.name}>
                              {location.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    {!routeChosen && (
                      <div>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--acento)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                          Vehículo
                        </div>
                        <select
                          value={selectedRoverId ?? ''}
                          onChange={(e) => setSelectedRoverId(e.target.value || null)}
                          style={{
                            width: '100%',
                            padding: '0.45rem 0.5rem',
                            borderRadius: '8px',
                            border: '2px solid var(--burnt-rose-2)',
                            background: 'var(--superficie)',
                            color: 'var(--texto)',
                            font: 'inherit',
                          }}
                        >
                          {ROVERS.map((rover) => (
                            <option key={rover.id} value={rover.id}>
                              {rover.name} — {rover.velocityMps} m/s
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </section>
                )}

                {(() => {
                  if (routeData.length === 0) {
                    if (!astronaut) {
                      return (
                        <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.45, color: 'var(--texto)' }}>
                          Selecciona un punto en el mapa o usa el asistente de voz para calcular una ruta.
                        </p>
                      )
                    }
                    return null
                  }

                  const allHeights = routeData.flatMap((r) => r.heights ?? [])
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
                          {routeData.map((route, index) => {
                            if (routeChosen && selectedRouteIndex !== index) return null
                            const heights = route.heights ?? []
                            if (heights.length < 2) return null
                            const color = ROUTE_COLORS[index] ?? '#38bdf8'
                            const isSelected = selectedRouteIndex === index
                            const pts = heights.map((h, i) => `${toX(i, heights.length)},${toY(h)}`).join(' ')
                            const area = `${pts} ${W},${H} 0,${H}`
                            return (
                              <g key={index} opacity={1}>
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
                        {routeData
                          .filter((_, index) => (routeChosen ? selectedRouteIndex === index : true))
                          .map((route) => {
                            const index = routeData.indexOf(route)
                            const color = ROUTE_COLORS[index] ?? '#38bdf8'
                            const isSelected = selectedRouteIndex === index
                            const lengthMeters = model ? getRouteLengthMeters(model, route.path) : 0
                            const durationSeconds = selectedRover
                              ? getRouteDurationSeconds(lengthMeters, selectedRover.velocityMps)
                              : NaN
                            const name = getRouteLabel(route, index)
                            return (
                              <div key={index} style={{ display: 'grid', gap: '0.35rem' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (routeChosen) return
                                    setSelectedRouteIndex(isSelected ? null : index)
                                  }}
                                  className={`btn${isSelected ? ' btn--active' : ''}`}
                                  style={{
                                    display: 'grid',
                                    gap: '0.2rem',
                                    textAlign: 'left',
                                    padding: '0.55rem 0.7rem',
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    cursor: routeChosen ? 'default' : 'pointer',
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
                              </div>
                            )
                          })}
                        {!routeChosen && selectedRouteIndex != null && (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              setRouteChosen(true)
                              let start = routeStart ?? astronaut
                              if (!start && model && selectedRouteIndex != null) {
                                const p = routeData[selectedRouteIndex]?.path?.[0]
                                if (p) {
                                  const geo = demPixelToGeo(model, p[0], p[1])
                                  if (geo) start = { lat: geo.lat, lon: geo.lon, elevation: 0 }
                                }
                              }
                              if (start) setFocusTarget({ lat: start.lat, lon: start.lon })
                            }}
                            style={{ marginTop: '0.25rem' }}
                          >
                            Select this route
                          </button>
                        )}
                        {routeChosen && (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setRouteChosen(false)}
                            style={{ marginTop: '0.25rem' }}
                          >
                            Change route
                          </button>
                        )}
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


        </>
      )}

      <AIOverlay zone={poi.id} onAction={executeAIAction} />
    </main>
  )
}
