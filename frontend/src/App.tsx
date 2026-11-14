import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import TerrainViewer, { type CameraMode } from './components/TerrainViewer'
import {
  MARS_PALETTE,
  formatCoord,
  formatMeters,
  loadTerrain,
  type HoverInfo,
  type TerrainData,
} from './terrain'
import { createTerrainModel, type GeoPoint } from './terrainModel'
import { parseRouteInput } from './routeInput'
import type {
  RouteResult,
  RoutingInMessage,
  RoutingOutMessage,
} from './routing'
import './App.css'

const legendGradient = `linear-gradient(to top, ${MARS_PALETTE.join(', ')})`

function formatKm(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2).replace('.', ',')} km`
  }
  return formatMeters(meters)
}

function formatSlope(ratio: number): string {
  return `${(ratio * 100).toFixed(0)} %`
}

function parseCoordinate(value: string): number {
  return Number(value.trim().replace(',', '.'))
}

export default function App() {
  const [data, setData] = useState<TerrainData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exaggeration, setExaggeration] = useState(3.5)
  const [autoRotate, setAutoRotate] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [cameraMode, setCameraMode] = useState<CameraMode>('perspective')
  const [resetSignal, setResetSignal] = useState(0)
  const [hover, setHover] = useState<HoverInfo | null>(null)

  const [startLat, setStartLat] = useState('18.4535')
  const [startLon, setStartLon] = useState('77.4417')
  const [endLat, setEndLat] = useState('18.4680')
  const [endLon, setEndLon] = useState('77.4220')
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [routing, setRouting] = useState(false)
  const [workerReady, setWorkerReady] = useState(false)

  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const pendingIdRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    loadTerrain()
      .then((terrain) => {
        if (!cancelled) setData(terrain)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(
          cause instanceof Error
            ? cause.message
            : 'No se pudo cargar el modelo de elevación.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [])

  const model = useMemo(
    () => (data ? createTerrainModel(data) : null),
    [data],
  )

  useEffect(() => {
    if (!data) return
    const worker = new Worker(new URL('./routing.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    setWorkerReady(false)

    worker.onmessage = (event: MessageEvent<RoutingOutMessage>) => {
      const message = event.data
      if (message.type === 'ready') {
        setWorkerReady(true)
        return
      }
      if (message.id !== pendingIdRef.current) return
      pendingIdRef.current = null
      setRouting(false)
      if (message.type === 'result') {
        setRoute(message.result)
        setRouteError(null)
      } else {
        setRoute(null)
        setRouteError(message.message)
      }
    }

    worker.onerror = () => {
      pendingIdRef.current = null
      setRouting(false)
      setRouteError('El motor de rutas no pudo iniciarse.')
    }

    const init: RoutingInMessage = {
      type: 'init',
      meta: data.meta,
      heights: data.heights,
    }
    worker.postMessage(init)

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [data])

  const meta = data?.meta
  const area = useMemo(() => {
    if (!meta) return null
    return {
      width: (meta.widthMeters / 1000).toFixed(1).replace('.', ','),
      height: (meta.heightMeters / 1000).toFixed(1).replace('.', ','),
    }
  }, [meta])

  const midElevation = meta ? (meta.minElevation + meta.maxElevation) / 2 : 0

  const calculateRoute = (start: GeoPoint, end: GeoPoint) => {
    const worker = workerRef.current
    if (!worker) {
      setRouteError('El motor de rutas todavía no está disponible.')
      return
    }
    if (!workerReady) {
      setRouteError('El terreno aún se está preparando. Espera un momento.')
      return
    }
    const id = requestIdRef.current + 1
    requestIdRef.current = id
    pendingIdRef.current = id
    setRouting(true)
    setRouteError(null)
    const message: RoutingInMessage = { type: 'route', id, start, end }
    worker.postMessage(message)
  }

  const handleCalculate = () => {
    const start = {
      lat: parseCoordinate(startLat),
      lon: parseCoordinate(startLon),
    }
    const end = {
      lat: parseCoordinate(endLat),
      lon: parseCoordinate(endLon),
    }

    if (
      !Number.isFinite(start.lat) ||
      !Number.isFinite(start.lon) ||
      !Number.isFinite(end.lat) ||
      !Number.isFinite(end.lon)
    ) {
      setRouteError('Introduce coordenadas numéricas válidas para inicio y fin.')
      return
    }

    calculateRoute(start, end)
  }

  const handleClearRoute = () => {
    pendingIdRef.current = null
    setRoute(null)
    setRouteError(null)
    setRouting(false)
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file || !meta) return
    try {
      const text = await file.text()
      const parsed = parseRouteInput(text, file.name, meta)
      setStartLat(parsed.start.lat.toFixed(5))
      setStartLon(parsed.start.lon.toFixed(5))
      setEndLat(parsed.end.lat.toFixed(5))
      setEndLon(parsed.end.lon.toFixed(5))
      calculateRoute(parsed.start, parsed.end)
    } catch (cause) {
      setRouteError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo leer el archivo de coordenadas.',
      )
    } finally {
      input.value = ''
    }
  }

  return (
    <main className="app">
      {model && (
        <TerrainViewer
          model={model}
          route={route}
          exaggeration={exaggeration}
          autoRotate={autoRotate}
          wireframe={wireframe}
          cameraMode={cameraMode}
          resetSignal={resetSignal}
          onHover={setHover}
          onError={setError}
        />
      )}

      {!data && !error && (
        <div className="loading">
          <div className="loader-orbit" aria-hidden="true">
            <span className="loader-planet" />
            <span className="loader-moon" />
          </div>
          <p className="loading-title">Procesando el relieve de Marte</p>
          <p className="loading-sub">1024 × 1024 muestras del DEM · 1 m/px</p>
        </div>
      )}

      {error && (
        <div className="error-card" role="alert">
          <p className="error-eyebrow">No se pudo abrir el visor</p>
          <h2>{error}</h2>
          <p>
            Genera de nuevo el heightmap con{' '}
            <code>python backend/process_dem.py</code> y recarga la página.
          </p>
        </div>
      )}

      {data && meta && (
        <>
        <button
              type="button"
              className="back-button"
              onClick={() => setResetSignal((signal) => signal + 1)}
            >
              ⤺
            </button>
          <header className="hud header">
            <p className="eyebrow">
              <span className="eyebrow-dot" />
              Marte · Cráter Jezero
            </p>
            <dl className="facts">
              <div>
                <dt>Área</dt>
                <dd>
                  {area?.width} × {area?.height} km
                </dd>
              </div>
              <div>
                <dt>Elevación</dt>
                <dd>
                  {formatMeters(meta.minElevation)} / {formatMeters(meta.maxElevation)}
                </dd>
              </div>
              <div>
                <dt>Centro</dt>
                <dd>
                  {formatCoord(meta.center.lat, 'N', 'S')} ·{' '}
                  {formatCoord(meta.center.lon, 'E', 'W')}
                </dd>
              </div>
            </dl>
          </header>

          <aside className="hud panel" aria-label="Controles del visor 3D">
            <div className="panel-head">
              <h2>Control del terreno</h2>
              <span className="chip">DEM 1 m/px</span>
            </div>

            <div className="field">
              <div className="field-label">
                <span>Exageración vertical</span>
                <output>{exaggeration.toFixed(1)}×</output>
              </div>
              <input
                type="range"
                min="1"
                max="8"
                step="0.1"
                value={exaggeration}
                aria-label="Exageración vertical"
                onChange={(event) => setExaggeration(Number(event.target.value))}
              />
              <div className="field-hint">
                <span>1×</span>
                <span>8×</span>
              </div>
            </div>

            <div className="segmented" role="group" aria-label="Tipo de cámara">
              <button
                type="button"
                className={cameraMode === 'perspective' ? 'is-active' : ''}
                aria-pressed={cameraMode === 'perspective'}
                onClick={() => setCameraMode('perspective')}
              >
                Perspectiva
              </button>
              <button
                type="button"
                className={cameraMode === 'top' ? 'is-active' : ''}
                aria-pressed={cameraMode === 'top'}
                onClick={() => setCameraMode('top')}
              >
                Cenital
              </button>
            </div>

            <div className="toggles">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={autoRotate}
                  onChange={(event) => setAutoRotate(event.target.checked)}
                />
                <span className="switch-track" aria-hidden="true">
                  <span className="switch-knob" />
                </span>
                <span>Rotación automática</span>
              </label>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={wireframe}
                  onChange={(event) => setWireframe(event.target.checked)}
                />
                <span className="switch-track" aria-hidden="true">
                  <span className="switch-knob" />
                </span>
                <span>Malla del terreno</span>
              </label>
            </div>

            <button
              type="button"
              className="reset-button"
              onClick={() => setResetSignal((signal) => signal + 1)}
            >
              Centrar vista
            </button>

            <div className="panel-divider" />

            <section className="route-section" aria-label="Cálculo de ruta">
              <div className="panel-head route-head">
                <h2>Ruta entre puntos</h2>
                {route && (
                  <span className="chip chip-route">
                    {formatKm(route.stats.distance2d)}
                  </span>
                )}
              </div>

              <div className="coord-grid">
                <span />
                <span className="coord-head">Latitud</span>
                <span className="coord-head">Longitud</span>

                <span className="coord-label">Inicio</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="coord-input"
                  value={startLat}
                  aria-label="Latitud del punto de inicio"
                  onChange={(event) => setStartLat(event.target.value)}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  className="coord-input"
                  value={startLon}
                  aria-label="Longitud del punto de inicio"
                  onChange={(event) => setStartLon(event.target.value)}
                />

                <span className="coord-label">Fin</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="coord-input"
                  value={endLat}
                  aria-label="Latitud del punto final"
                  onChange={(event) => setEndLat(event.target.value)}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  className="coord-input"
                  value={endLon}
                  aria-label="Longitud del punto final"
                  onChange={(event) => setEndLon(event.target.value)}
                />
              </div>

              <div className="route-actions">
                <button
                  type="button"
                  className="route-button"
                  onClick={handleCalculate}
                  disabled={routing || !workerReady}
                >
                  {routing
                    ? 'Calculando…'
                    : workerReady
                      ? 'Calcular ruta'
                      : 'Preparando…'}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleClearRoute}
                  disabled={!route && !routeError}
                >
                  Limpiar
                </button>
              </div>

              <label className="file-button">
                Importar JSON/CSV
                <input
                  type="file"
                  accept=".json,.csv,.txt,application/json,text/csv,text/plain"
                  onChange={handleImport}
                />
              </label>

              {routeError && (
                <p className="route-error" role="alert">
                  {routeError}
                </p>
              )}

              {route && (
                <>
                  <dl className="route-stats">
                    <div>
                      <dt>Distancia</dt>
                      <dd>{formatKm(route.stats.distance2d)}</dd>
                    </div>
                    <div>
                      <dt>Sobre el relieve</dt>
                      <dd>{formatKm(route.stats.distance3d)}</dd>
                    </div>
                    <div>
                      <dt>Ascenso</dt>
                      <dd>+{formatMeters(route.stats.ascent)}</dd>
                    </div>
                    <div>
                      <dt>Descenso</dt>
                      <dd>−{formatMeters(route.stats.descent)}</dd>
                    </div>
                    <div>
                      <dt>Pendiente máx.</dt>
                      <dd>{formatSlope(route.stats.maxSlope)}</dd>
                    </div>
                    <div>
                      <dt>Cota mín. / máx.</dt>
                      <dd>
                        {formatMeters(route.stats.minElevation)} /{' '}
                        {formatMeters(route.stats.maxElevation)}
                      </dd>
                    </div>
                  </dl>
                  <p className="route-note">
                    Ruta de {route.stats.cells} celdas del DEM evitando las
                    pendientes más pronunciadas.
                  </p>
                </>
              )}
            </section>

            <p className="panel-hint">
              Arrastra para orbitar · rueda para acercar · clic derecho para
              desplazar
            </p>
          </aside>

          <figure className="hud legend">
            <figcaption>Elevación</figcaption>
            <div className="legend-body">
              <div className="legend-bar" style={{ backgroundImage: legendGradient }} />
              <div className="legend-ticks">
                <span>{formatMeters(meta.maxElevation)}</span>
                <span>{formatMeters(midElevation)}</span>
                <span>{formatMeters(meta.minElevation)}</span>
              </div>
            </div>
          </figure>

          <div className={`hud readout ${hover ? 'is-active' : ''}`}>
            {hover ? (
              <>
                <span className="readout-dot" aria-hidden="true" />
                <strong>{formatMeters(hover.elevation)}</strong>
                <span className="readout-coords">
                  {formatCoord(hover.lat, 'N', 'S')} ·{' '}
                  {formatCoord(hover.lon, 'E', 'W')}
                </span>
              </>
            ) : (
              <span className="readout-idle">
                Pasa el cursor sobre el relieve para leer la altura
              </span>
            )}
          </div>

          <p className="hud source">
            Fuente: {meta.sourceFile} · {meta.crs}
          </p>
        </>
      )}
    </main>
  )
}
