import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import TerrainViewer, { type CameraMode } from './../components/TerrainViewer'
import SidePanel from './../components/SidePanel'
import Loading from './../components/Loading'
import Button from './../components/Button'
import AIOverlay from './../components/AIOverlay'
import { getPoi } from './../data/pois'
import {
  MARS_PALETTE,
  formatCoord,
  formatMeters,
  loadTerrain,
  type HoverInfo,
  type TerrainData,
} from './../utils/terrain'
import { createTerrainModel } from './../utils/terrainModel'
import './../App.css'

const legendGradient = `linear-gradient(to top, ${MARS_PALETTE.join(', ')})`

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
            : 'No se pudo cargar el modelo de elevación.',
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
          />
        )}
      </div>
      {!data && !error && (
        <Loading
          title="Procesando el relieve de Marte"
          subtitle={`${poi.name} · 1024 × 1024 muestras del DEM · 1 m/px`}
        />
      )}
      {error && (
        <div className="partial-error" role="alert">
          <p className="partial-error-eyebrow">No se pudo abrir el visor</p>
          <h2>{error}</h2>
          <p>
            Comprueba que el modelo exista en{' '}
            <code>frontend/public/terrain/{poi.terrainDir}</code> y recarga la
            página.
          </p>
        </div>
      )}

      {data && meta && (
        <>
          <SidePanel
            title="Control del terreno"
            open
            onClose={() => navigate('/global')}
            className="side-panel--terrain"
            actionLabel="Centrar vista"
            onGo={() => setResetSignal((signal) => signal + 1)}
          >
            <section className="terrain-section">
              <div className="terrain-field">
                <div className="terrain-field__label">
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
              </div>

              <div className="terrain-segmented" role="group" aria-label="Tipo de cámara">
                <Button
                  active={cameraMode === 'perspective'}
                  aria-pressed={cameraMode === 'perspective'}
                  onClick={() => setCameraMode('perspective')}
                >
                  Perspectiva
                </Button>
                <Button
                  active={cameraMode === 'top'}
                  aria-pressed={cameraMode === 'top'}
                  onClick={() => setCameraMode('top')}
                >
                  Cenital
                </Button>
              </div>

              {/* "Rotación automática" and "Malla del terreno" options removed when the map is shown; kept disabled */}

              <p className="terrain-hint">
                Arrastra para orbitar · rueda para acercar · clic derecho para desplazar
              </p>
            </section>
          </SidePanel>

          <header className="partial-header">
            <p className="partial-eyebrow">{poi.terrainLabel}</p>
            <dl className="partial-facts">
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

          <figure className="partial-legend">
            <figcaption>Elevación</figcaption>
            <div className="partial-legend__body">
              <div
                className="partial-legend__bar"
                style={{ backgroundImage: legendGradient }}
              />
              <div className="partial-legend__ticks">
                <span>{formatMeters(meta.maxElevation)}</span>
                <span>{formatMeters(midElevation)}</span>
                <span>{formatMeters(meta.minElevation)}</span>
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
                Pasa el cursor sobre el relieve para leer la altura
              </span>
            )}
          </div>

          <p className="partial-source">
            Fuente: {meta.sourceFile} · {meta.crs}
          </p>
        </>
      )}

      <AIOverlay />
    </main>
  )
}
