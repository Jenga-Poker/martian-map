import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import TerrainViewer, {
  type AstronautPosition,
  type CameraMode,
} from './../components/TerrainViewer'
import SidePanel from './../components/SidePanel'
import Cabecera from './../components/Cabecera'
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
  return String(detail ?? 'Unknown error')
}

async function readError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => null)) as
    | { detail?: unknown }
    | null
  if (data?.detail != null) return formatErrorDetail(data.detail)
  return `Server error (${response.status})`
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
  if (multiplier <= 100) return 'Medium'
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
  const [isAddLocationModalOpen, setIsAddLocationModalOpen] = useState(false)
  const [pendingLocationPos, setPendingLocationPos] = useState<{ lat: number; lon: number } | null>(null)
  const [newLocationName, setNewLocationName] = useState('')
  const [isSavingLocation, setIsSavingLocation] = useState(false)
  const [saveLocationError, setSaveLocationError] = useState<string | null>(null)
  const [distancePopup, setDistancePopup] = useState<{
    open: boolean
    distanceKm: number | null
    from: { lat: number; lon: number } | null
    error: string | null
  }>({ open: false, distanceKm: null, from: null, error: null })
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

  const refreshLocations = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/locations/${encodeURIComponent(poi.id)}`)
      if (!response.ok) return
      const payload = (await response.json()) as { locations?: Location[] }
      if (Array.isArray(payload.locations)) {
        setZoneLocations(payload.locations)
      }
    } catch {
      // ignore
    }
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
            multipliers: [1, 50, 500],
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

  const handleCreateLocation = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault()
      const trimmedName = newLocationName.trim()
      if (!trimmedName) {
        setSaveLocationError('Name cannot be empty.')
        return
      }
      if (!pendingLocationPos) {
        setSaveLocationError('No coordinates selected.')
        return
      }

      setIsSavingLocation(true)
      setSaveLocationError(null)

      try {
        const response = await fetch(`${API_URL}/location`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedName,
            lat: pendingLocationPos.lat,
            lon: pendingLocationPos.lon,
            zone: poi.id,
          }),
        })

        if (!response.ok) {
          throw new Error(await readError(response))
        }

        setIsAddLocationModalOpen(false)
        setNewLocationName('')
        setPendingLocationPos(null)
        await refreshLocations()
      } catch (err) {
        setSaveLocationError(
          err instanceof Error ? err.message : 'Error saving location.',
        )
      } finally {
        setIsSavingLocation(false)
      }
    },
    [newLocationName, pendingLocationPos, poi.id, refreshLocations],
  )

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

      const isAddLocationAction =
        action === 'add_location' ||
        action.includes('add_location') ||
        action.includes('location') ||
        action.includes('ubicacion')

      const isDistanceToEarthAction =
        action === 'distance_to_earth' ||
        action.includes('distance_to_earth') ||
        (action.includes('distance') && action.includes('earth'))

      if (isDistanceToEarthAction) {
        if (!data || !model) {
          return { ok: false, message: 'El terreno aún no está cargado.' }
        }

        const point = astronaut
          ? { lat: astronaut.lat, lon: astronaut.lon }
          : { lat: data.meta.center.lat, lon: data.meta.center.lon }
        const elevationMeters = astronaut
          ? astronaut.elevation
          : data.meta.minElevation + (data.meta.maxElevation - data.meta.minElevation) / 2

        try {
          const response = await fetch(`${API_URL}/distance-to-lantejuela`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              point: {
                lat: point.lat,
                lon: point.lon,
                height_km: elevationMeters / 1000,
              },
              mars_time: new Date().toISOString(),
            }),
            signal,
          })
          if (!response.ok) {
            throw new Error(await readError(response))
          }
          const payload = (await response.json()) as { distance_km?: number }
          const distanceKm =
            typeof payload.distance_km === 'number' ? payload.distance_km : null
          if (distanceKm == null || !Number.isFinite(distanceKm)) {
            throw new Error('Invalid distance response.')
          }
          setDistancePopup({ open: true, distanceKm, from: point, error: null })
          return {
            ok: true,
            message: `Distance to Lantejuela: ${distanceKm.toLocaleString('en-US', {
              maximumFractionDigits: 0,
            })} km.`,
          }
        } catch (cause) {
          if (
            typeof cause === 'object' &&
            cause !== null &&
            (cause as { name?: string }).name === 'AbortError'
          ) {
            return { ok: false, message: 'Operation cancelled.' }
          }
          const message =
            cause instanceof Error ? cause.message : 'Error calculating distance.'
          setDistancePopup({ open: true, distanceKm: null, from: point, error: message })
          return { ok: false, message }
        }
      }

      if (isAddLocationAction) {
        if (!data || !model) {
          return { ok: false, message: 'El terreno aún no está cargado.' }
        }

        const targetPos = hover
          ? { lat: hover.lat, lon: hover.lon }
          : astronaut
            ? { lat: astronaut.lat, lon: astronaut.lon }
            : null

        if (!targetPos) {
          return {
            ok: false,
            message:
              'Mueve el cursor sobre el terreno para seleccionar la posición de la nueva ubicación.',
          }
        }

        setPendingLocationPos(targetPos)
        setNewLocationName('')
        setSaveLocationError(null)
        setIsAddLocationModalOpen(true)

        return {
          ok: true,
          message: 'Enter the location name in the modal.',
        }
      }

      if (!isPathAction) {
        return {
          ok: true,
          message: 'Action not recognized.',
        }
      }

      if (!data || !model) {
        return { ok: false, message: 'Terrain is not loaded yet.' }
      }

      if (!astronaut) {
        return {
          ok: false,
          message:
            'Place the astronaut on the terrain first by clicking on it.',
        }
      }

      const endName =
        typeof ai.options?.end === 'string' ? ai.options.end : null
      if (!endName) {
        return {
          ok: false,
          message: 'The AI did not identify a valid destination.',
        }
      }

      const roverId =
        typeof ai.options?.rover === 'string' ? ai.options.rover : null
      const rover = getRover(roverId) ?? selectedRover
      if (!rover) {
        return {
          ok: false,
          message: 'No rover is available to calculate the route.',
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
            message: `No coordinates found for "${endName}" in zone ${poi.id}.`,
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
            message: `Coordinates for "${destination.name}" are outside ${poi.name}. Check data/locations.csv.`,
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
            multipliers: [1, 50, 500],
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
            message: 'The server did not return any route.',
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
          message: `Route generated successfully. ${routes.length} route(s) calculated.`,
        }
      } catch (cause) {
        if (
          typeof cause === 'object' &&
          cause !== null &&
          (cause as { name?: string }).name === 'AbortError'
        ) {
          return { ok: false, message: 'Operation cancelled.' }
        }
        return {
          ok: false,
          message:
            cause instanceof Error
              ? cause.message
              : 'Error calculating the route.',
        }
      }
    },
    [astronaut, data, hover, model, poi.id, poi.name, selectedRover],
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
      <Cabecera />
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

      {isAddLocationModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-location-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSavingLocation) {
              setIsAddLocationModalOpen(false)
            }
          }}
        >
          <div
            style={{
              background: 'var(--espresso)',
              border: '2px solid var(--burnt-rose-2)',
              borderRadius: '16px',
              padding: '1.5rem',
              width: '90%',
              maxWidth: '420px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <h2
              id="add-location-title"
              style={{
                margin: 0,
                fontSize: '1.1rem',
                color: 'var(--acento)',
                fontFamily: 'var(--fuente-titulo)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Add New Location
            </h2>

            {pendingLocationPos && (
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--texto)',
                  background: 'var(--superficie)',
                  padding: '0.6rem 0.8rem',
                  borderRadius: '8px',
                  border: '1px solid var(--burnt-rose-2)',
                }}
              >
                <div>
                  <strong>Coordinates:</strong>{' '}
                  {formatCoord(pendingLocationPos.lat, 'N', 'S')} ·{' '}
                  {formatCoord(pendingLocationPos.lon, 'E', 'W')}
                </div>
                <div style={{ marginTop: '0.2rem', color: 'var(--acento)' }}>
                  Zone: {poi.name}
                </div>
              </div>
            )}

            <form
              onSubmit={handleCreateLocation}
              style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
            >
              <div>
                <label
                  htmlFor="location-name-input"
                  style={{
                    display: 'block',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: 'var(--texto)',
                    marginBottom: '0.4rem',
                  }}
                >
                  Location Name
                </label>
                <input
                  id="location-name-input"
                  type="text"
                  autoFocus
                  required
                  value={newLocationName}
                  onChange={(e) => setNewLocationName(e.target.value)}
                  placeholder="e.g. Olympus Station"
                  disabled={isSavingLocation}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '0.6rem 0.8rem',
                    borderRadius: '8px',
                    border: '2px solid var(--burnt-rose-2)',
                    background: 'var(--superficie)',
                    color: 'var(--texto)',
                    font: 'inherit',
                    outline: 'none',
                  }}
                />
              </div>

              {saveLocationError && (
                <p
                  style={{
                    margin: 0,
                    fontSize: '0.78rem',
                    color: '#ff6b6b',
                  }}
                >
                  {saveLocationError}
                </p>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setIsAddLocationModalOpen(false)}
                  disabled={isSavingLocation}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn--active"
                  disabled={isSavingLocation || !newLocationName.trim()}
                >
                  {isSavingLocation ? 'Saving…' : 'Save Location'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {distancePopup.open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="distance-earth-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setDistancePopup((prev) => ({ ...prev, open: false }))
            }
          }}
        >
          <div
            style={{
              background: 'var(--espresso)',
              border: '2px solid var(--burnt-rose-2)',
              borderRadius: '16px',
              padding: '1.5rem',
              width: '90%',
              maxWidth: '420px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <h2
              id="distance-earth-title"
              style={{
                margin: 0,
                fontSize: '1.1rem',
                color: 'var(--acento)',
                fontFamily: 'var(--fuente-titulo)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Distance to Earth
            </h2>

            {distancePopup.error ? (
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#ff6b6b' }}>
                {distancePopup.error}
              </p>
            ) : (
              <div
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--texto)',
                  background: 'var(--superficie)',
                  padding: '0.8rem 0.9rem',
                  borderRadius: '8px',
                  border: '1px solid var(--burnt-rose-2)',
                }}
              >
                <div style={{ marginBottom: '0.35rem' }}>
                  <strong>Destination:</strong> Lantejuela, Sevilla (España)
                </div>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--acento)' }}>
                  {distancePopup.distanceKm != null
                    ? `${distancePopup.distanceKm.toLocaleString('en-US', {
                        maximumFractionDigits: 0,
                      })} km`
                    : '—'}
                </div>
                {distancePopup.from && (
                  <div style={{ marginTop: '0.4rem', fontSize: '0.78rem' }}>
                    From: {formatCoord(distancePopup.from.lat, 'N', 'S')} ·{' '}
                    {formatCoord(distancePopup.from.lon, 'E', 'W')}
                  </div>
                )}
                <div style={{ marginTop: '0.2rem', fontSize: '0.72rem', opacity: 0.85 }}>
                  Calculated for current time ({new Date().toLocaleString()}).
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
              <button
                type="button"
                className="btn btn--active"
                onClick={() => setDistancePopup((prev) => ({ ...prev, open: false }))}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
