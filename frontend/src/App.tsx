import { useEffect, useMemo, useState } from 'react'
import TerrainViewer, { type CameraMode } from './components/TerrainViewer'
import {
  MARS_PALETTE,
  formatCoord,
  formatMeters,
  loadTerrain,
  type HoverInfo,
  type TerrainData,
} from './terrain'
import './App.css'

const legendGradient = `linear-gradient(to top, ${MARS_PALETTE.join(', ')})`

export default function App() {
  const [data, setData] = useState<TerrainData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exaggeration, setExaggeration] = useState(3.5)
  const [autoRotate, setAutoRotate] = useState(true)
  const [wireframe, setWireframe] = useState(false)
  const [cameraMode, setCameraMode] = useState<CameraMode>('perspective')
  const [resetSignal, setResetSignal] = useState(0)
  const [hover, setHover] = useState<HoverInfo | null>(null)

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

  const meta = data?.meta
  const area = useMemo(() => {
    if (!meta) return null
    return {
      width: (meta.widthMeters / 1000).toFixed(1).replace('.', ','),
      height: (meta.heightMeters / 1000).toFixed(1).replace('.', ','),
    }
  }, [meta])

  const midElevation = meta ? (meta.minElevation + meta.maxElevation) / 2 : 0

  return (
    <main className="app">
      {data && (
        <TerrainViewer
          data={data}
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
          <header className="hud header">
            <p className="eyebrow">
              <span className="eyebrow-dot" />
              Marte · Cráter Jezero
            </p>
            <h1>
              Jezero <span className="title-accent">en relieve</span>
            </h1>
            <p className="lede">
              Modelo digital de elevación del terreno marciano, reconstruido
              píxel a píxel a partir del DEM de 1 metro.
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
