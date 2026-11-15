import { useCallback, useRef, useState } from 'react'
import logoMaya from '../assets/logomaya-limpio.svg'
import { useSpeechToText } from '../hooks/useSpeechToText'

type AIResult = {
  action: string
  options: Record<string, any>
}

type RouteResult = {
  ok: boolean
  message: string
  distance?: number
  points?: number
}

type OverlayState = 'idle' | 'listening' | 'analyzing' | 'routing' | 'done' | 'error'

function formatValue(value: any): string {
  if (value == null) return '—'
  if (typeof value === 'object') {
    if ('lat' in value && 'lon' in value) return `${value.lat}, ${value.lon}`
    if ('row' in value && 'col' in value) return `fila ${value.row}, col ${value.col}`
    const entries = Object.entries(value)
      .map(([k, v]) => `${k}: ${formatValue(v)}`)
      .join(', ')
    return entries || '—'
  }
  return String(value)
}

function formatActionLabel(action: string): string {
  const map: Record<string, string> = {
    navigate_to: 'Generar ruta',
    find_path: 'Buscar ruta',
    calculate_route: 'Calcular ruta',
  }
  return map[action] || action.replace(/_/g, ' ')
}

type AIOverlayProps = {
  zone?: string
}

export default function AIOverlay({ zone }: AIOverlayProps) {
  const [overlayState, setOverlayState] = useState<OverlayState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [finalTranscript, setFinalTranscript] = useState('')
  const [aiResult, setAiResult] = useState<AIResult | null>(null)
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const processInstruction = useCallback(async (instruction: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setFinalTranscript(instruction)
    setAiResult(null)
    setRouteResult(null)
    setError(null)
    setOverlayState('analyzing')

    try {
      const response = await fetch('http://localhost:8000/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, zone }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const errData = await response.json().catch(() => null)
        throw new Error(errData?.detail || `Error en servidor (${response.status})`)
      }
      const data: AIResult = await response.json()
      if (controller.signal.aborted) return
      setAiResult(data)

      const action = (data.action || '').toLowerCase()
      const opts = data.options || {}
      const isPathAction = action.includes('path') || action.includes('route') || action.includes('ruta')

      if (isPathAction) {
        setOverlayState('routing')
        const hasCoords =
          opts.start && opts.end &&
          (('lat' in opts.start && 'lon' in opts.start) || ('row' in opts.start && 'col' in opts.start))
        if (hasCoords && opts.start.lat != null && opts.start.lon != null && opts.end.lat != null && opts.end.lon != null) {
          try {
            const pathRes = await fetch('http://localhost:8000/path', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                zone: opts.zone || 'default',
                start: { lat: Number(opts.start.lat), lon: Number(opts.start.lon) },
                end: { lat: Number(opts.end.lat), lon: Number(opts.end.lon) },
                multipliers: Array.isArray(opts.multipliers) ? opts.multipliers : [1, 1, 1],
                max_height_diff: opts.max_height_diff ?? undefined,
              }),
              signal: controller.signal,
            })
            if (!pathRes.ok) {
              const errData = await pathRes.json().catch(() => null)
              throw new Error(errData?.detail || `Error al generar ruta (${pathRes.status})`)
            }
            const pathData = await pathRes.json()
            if (controller.signal.aborted) return
            const points = Array.isArray(pathData?.path) ? pathData.path.length : Array.isArray(pathData?.points) ? pathData.points.length : undefined
            const distance = typeof pathData?.distance === 'number' ? pathData.distance : typeof pathData?.cost === 'number' ? pathData.cost : undefined
            setRouteResult({ ok: true, message: 'Ruta generada correctamente.', distance, points })
          } catch (e: any) {
            if (e?.name === 'AbortError') return
            setRouteResult({ ok: false, message: e?.message || 'No se pudo generar la ruta.' })
          }
        } else {
          setRouteResult({
            ok: true,
            message: 'Ruta solicitada con los parámetros indicados.',
          })
        }
      }

      if (!controller.signal.aborted) setOverlayState('done')
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setError(e?.message || 'Error al comunicarse con la IA.')
      setOverlayState('error')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [zone])

  const { status: speechStatus, transcript, interim, error: speechError, supported, toggle, reset: resetSpeech } =
    useSpeechToText({
      onFinal: (text) => {
        void processInstruction(text)
      },
    })

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    resetSpeech()
    setOverlayState('idle')
    setError(null)
    setFinalTranscript('')
    setAiResult(null)
    setRouteResult(null)
  }, [resetSpeech])

  const listening = speechStatus === 'listening'
  const busy = overlayState === 'analyzing' || overlayState === 'routing'
  const combinedError = speechError || error
  const showTranscript = listening || transcript.length > 0 || interim.length > 0 || finalTranscript.length > 0
  const showPanel = showTranscript || busy || Boolean(aiResult) || Boolean(routeResult) || Boolean(combinedError)

  const statusLabel =
    overlayState === 'listening' || listening
      ? 'Escuchando…'
      : overlayState === 'analyzing'
        ? 'Analizando instrucción...'
        : overlayState === 'routing'
          ? 'Generando ruta...'
          : overlayState === 'done'
            ? 'Proceso completado'
            : overlayState === 'error'
              ? 'Error'
              : 'Asistente de voz'

  const displayTranscript = finalTranscript || transcript

  return (
    <div className="ai-overlay">
      {showPanel && (
        <div className={`ai-overlay__panel${combinedError ? ' is-error' : ''}`} role="status" aria-live="polite">
          <div className="ai-overlay__header">
            <p className="ai-overlay__state">{statusLabel}</p>
          </div>

          {combinedError && <p className="ai-overlay__error">{combinedError}</p>}

          <div className="ai-overlay__steps">
            {(showTranscript || finalTranscript) && (
              <div className={`ai-overlay__step ${displayTranscript || interim ? 'is-done' : ''}`}>
                <div className="ai-overlay__step-title">Texto transcrito</div>
                <p className="ai-overlay__step-body ai-overlay__transcript">
                  {displayTranscript && <span>{displayTranscript} </span>}
                  {interim && <span className="ai-overlay__interim">{interim}</span>}
                  {listening && !displayTranscript && !interim && (
                    <span className="ai-overlay__placeholder">Habla ahora…</span>
                  )}
                  {listening && <span className="ai-overlay__caret" aria-hidden="true" />}
                </p>
              </div>
            )}

            {aiResult && (
              <div className="ai-overlay__step is-done">
                <div className="ai-overlay__step-title">Interpretación de la IA</div>
                <div className="ai-overlay__step-body">
                  <div className="ai-overlay__action">
                    <span className="ai-overlay__badge">Acción</span>
                    <strong>{formatActionLabel(aiResult.action)}</strong>
                  </div>
                  {aiResult.options && Object.keys(aiResult.options).length > 0 && (
                    <dl className="ai-overlay__params">
                      {Object.entries(aiResult.options).map(([key, value]) => (
                        <div key={key} className="ai-overlay__param">
                          <dt>{key}</dt>
                          <dd>{formatValue(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </div>
            )}

            {routeResult && (
              <div className={`ai-overlay__step ${routeResult.ok ? 'is-done' : 'is-error'}`}>
                <div className="ai-overlay__step-title">Ruta</div>
                <div className="ai-overlay__step-body">
                  <p className="ai-overlay__confirm">
                    {routeResult.ok ? '✓ ' : '✕ '}
                    {routeResult.message}
                  </p>
                  {(routeResult.points != null || routeResult.distance != null) && (
                    <p className="ai-overlay__meta">
                      {routeResult.points != null && <span>{routeResult.points} puntos</span>}
                      {routeResult.points != null && routeResult.distance != null && <span> · </span>}
                      {routeResult.distance != null && <span>coste {routeResult.distance}</span>}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        className={`ai-overlay__button${listening ? ' is-listening' : ''}${busy ? ' is-busy' : ''}`}
        onClick={() => {
          if (listening) {
            toggle()
          } else if (showPanel) {
            reset()
          } else {
            toggle()
          }
        }}
        disabled={!supported || busy}
        aria-pressed={listening}
        aria-label={listening ? 'Detener dictado por voz' : 'Abrir asistente de voz'}
        title={supported ? 'Asistente de voz' : 'Tu navegador no soporta reconocimiento de voz'}
      >
        {listening && <span className="ai-overlay__pulse" aria-hidden="true" />}
        <img className="ai-overlay__icon" src={logoMaya} alt="" aria-hidden="true" />
      </button>
    </div>
  )
}
