
import { useCallback, useEffect, useRef, useState } from 'react'
import logoMaya from '../assets/logomaya-limpio.svg'
import { useSpeechToText } from '../hooks/useSpeechToText'
import { getRover } from '../utils/rovy'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export type AIResult = {
  action: string
  options?: {
    rover?: string | null
    end?: string | null
    [key: string]: unknown
  }
}

export type AIActionResult = {
  ok: boolean
  message: string
  points?: number
  distance?: number
}

type AIOverlayProps = {
  zone?: string
  onAction?: (
    result: AIResult,
    signal: AbortSignal,
  ) => Promise<AIActionResult>
}

type OverlayState = 'idle' | 'analyzing' | 'routing' | 'done' | 'error'

const ACTION_LABELS: Record<string, string> = {
  navigate_to: 'Calculate route',
  find_path: 'Find route',
  calculate_route: 'Calculate route',
  add_location: 'Add location',
  distance_to_earth: 'Distance to Earth',
}

const OPTION_LABELS: Record<string, string> = {
  rover: 'Rover',
  end: 'Destination',
  zone: 'Zone',
  multipliers: 'Multipliers',
  max_height_diff: 'Max height difference',
}

function formatActionLabel(action: string): string {
  if (!action) return 'Not specified'
  return ACTION_LABELS[action] || action.replace(/_/g, ' ')
}

function formatOptionLabel(key: string): string {
  return OPTION_LABELS[key] || key.replace(/_/g, ' ')
}

function formatOptionValue(key: string, value: unknown): string {
  if (key === 'rover' && typeof value === 'string') {
    return getRover(value)?.name ?? value.replace(/_/g, ' ')
  }

  if (Array.isArray(value)) {
    return value.map(formatValue).join(', ')
  }

  if (typeof value === 'object' && value !== null) {
    return Object.entries(value)
      .map(([childKey, childValue]) => {
        return `${formatOptionLabel(childKey)}: ${formatValue(childValue)}`
      })
      .join(', ')
  }

  return formatValue(value)
}

function formatValue(value: unknown): string {
  if (value == null) return '—'

  if (Array.isArray(value)) {
    return value.map(formatValue).join(', ')
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, childValue]) => {
        return `${formatOptionLabel(key)}: ${formatValue(childValue)}`
      })
      .join(', ')
  }

  return String(value)
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

export default function AIOverlay({ zone, onAction }: AIOverlayProps) {
  const [overlayState, setOverlayState] = useState<OverlayState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [finalTranscript, setFinalTranscript] = useState('')
  const [aiResult, setAiResult] = useState<AIResult | null>(null)
  const [actionResult, setActionResult] = useState<AIActionResult | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const processingRef = useRef(false)

  // Avoid updates after the component unmounts.
  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  // Processing of the locally recognized instruction.
  const processInstruction = useCallback(
    async (instruction: string) => {
      const normalizedInstruction = instruction.trim()

      if (!normalizedInstruction || processingRef.current) {
        return
      }

      processingRef.current = true

      abortRef.current?.abort()

      const controller = new AbortController()
      abortRef.current = controller

      setFinalTranscript(normalizedInstruction)
      setAiResult(null)
      setActionResult(null)
      setError(null)
      setOverlayState('analyzing')

      try {
        const response = await fetch(`${API_URL}/ai`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            instruction: normalizedInstruction,
            zone,
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as
            | { detail?: unknown }
            | null

          throw new Error(
            data?.detail != null
              ? formatErrorDetail(data.detail)
              : `Server error (${response.status})`,
          )
        }

        const data = (await response.json()) as AIResult

        if (controller.signal.aborted || !mountedRef.current) return

        setAiResult(data)

        const action = (data.action || '').toLowerCase()

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

        if (!onAction) {
          setActionResult({
            ok: false,
            message: 'No action handler is available.',
          })

          setOverlayState('error')
          return
        }

        if (
          !isPathAction &&
          !isAddLocationAction &&
          !isDistanceToEarthAction
        ) {
          setActionResult({
            ok: true,
            message: 'Action completed.',
          })

          setOverlayState('done')
          return
        }

        setOverlayState(
          isDistanceToEarthAction ? 'analyzing' : 'routing',
        )

        const result = await onAction(data, controller.signal)

        if (controller.signal.aborted || !mountedRef.current) return

        setActionResult(result)
        setOverlayState(result.ok ? 'done' : 'error')
      } catch (cause) {
        if (
          typeof cause === 'object' &&
          cause !== null &&
          (cause as { name?: string }).name === 'AbortError'
        ) {
          return
        }

        if (!mountedRef.current) return

        setError(
          cause instanceof Error
            ? cause.message
            : 'Error communicating with the AI.',
        )

        setOverlayState('error')
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
        }

        processingRef.current = false
      }
    },
    [onAction, zone],
  )

  // Web Speech API: exclusively local recognition.
  const {
    status: speechStatus,
    transcript,
    interim,
    error: speechError,
    supported,
    modelReady,
    installing,
    toggle,
    reset: resetSpeech,
  } = useSpeechToText({
    onFinal: (text) => {
      void processInstruction(text)
    },
  })

  // Full reset of the assistant.
  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null

    processingRef.current = false

    resetSpeech()

    setOverlayState('idle')
    setError(null)
    setFinalTranscript('')
    setAiResult(null)
    setActionResult(null)
  }, [resetSpeech])

  const listening = speechStatus === 'listening'

  const busy =
    installing ||
    overlayState === 'analyzing' ||
    overlayState === 'routing'

  const combinedError = speechError || error

  const showTranscript =
    listening ||
    transcript.length > 0 ||
    interim.length > 0 ||
    finalTranscript.length > 0

  const showPanel =
    installing ||
    showTranscript ||
    busy ||
    Boolean(aiResult) ||
    Boolean(actionResult) ||
    Boolean(combinedError)

  const displayTranscript = finalTranscript || transcript

  const statusLabel = installing
    ? 'Preparing local speech model…'
    : listening
      ? 'Listening locally…'
      : overlayState === 'analyzing'
        ? 'Analyzing instruction…'
        : overlayState === 'routing'
          ? 'Calculating route…'
          : overlayState === 'done'
            ? 'Process completed'
            : overlayState === 'error'
              ? 'Error'
              : 'Voice assistant'

  const optionEntries = aiResult?.options
    ? Object.entries(aiResult.options).filter(([, value]) => {
        return value != null && value !== ''
      })
    : []

  return (
    <div className="ai-overlay">
      {showPanel && (
        <div
          className={`ai-overlay__panel${combinedError ? ' is-error' : ''}`}
          role="status"
          aria-live="polite"
        >
          <div className="ai-overlay__header">
            <p className="ai-overlay__state">
              {statusLabel}
            </p>

            <p className="ai-overlay__speech-mode">
              {modelReady
                ? 'en-US · Local recognition'
                : installing
                  ? 'Installing en-US model'
                  : supported
                    ? 'Local model not ready'
                    : 'Speech recognition unavailable'}
            </p>
          </div>

          {combinedError && (
            <p className="ai-overlay__error">
              {combinedError}
            </p>
          )}

          <div className="ai-overlay__steps">
            {showTranscript && (
              <div
                className={`ai-overlay__step ${
                  displayTranscript || interim ? 'is-done' : ''
                }`}
              >
                <div className="ai-overlay__step-title">
                  Transcribed text
                </div>

                <p className="ai-overlay__step-body ai-overlay__transcript">
                  {displayTranscript && (
                    <span>{displayTranscript} </span>
                  )}

                  {interim && (
                    <span className="ai-overlay__interim">
                      {interim}
                    </span>
                  )}

                  {listening && !displayTranscript && !interim && (
                    <span className="ai-overlay__placeholder">
                      Speak now…
                    </span>
                  )}

                  {listening && (
                    <span
                      className="ai-overlay__caret"
                      aria-hidden="true"
                    />
                  )}
                </p>
              </div>
            )}

            {aiResult && (
              <div className="ai-overlay__step is-done">
                <div className="ai-overlay__step-title">
                  AI interpretation
                </div>

                <div className="ai-overlay__step-body">
                  <div className="ai-overlay__action">
                    <span className="ai-overlay__badge">
                      Action
                    </span>

                    <strong>
                      {formatActionLabel(aiResult.action)}
                    </strong>
                  </div>

                  {optionEntries.length > 0 && (
                    <dl className="ai-overlay__params">
                      {optionEntries.map(([key, value]) => (
                        <div
                          key={key}
                          className="ai-overlay__param"
                        >
                          <dt>{formatOptionLabel(key)}</dt>
                          <dd>{formatOptionValue(key, value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </div>
            )}

            {actionResult && (
              <div
                className={`ai-overlay__step ${
                  actionResult.ok ? 'is-done' : 'is-error'
                }`}
              >
                <div className="ai-overlay__step-title">
                  Result
                </div>

                <div className="ai-overlay__step-body">
                  <p className="ai-overlay__confirm">
                    {actionResult.ok ? '✓ ' : '✕ '}
                    {actionResult.message}
                  </p>

                  {(actionResult.points != null ||
                    actionResult.distance != null) && (
                    <p className="ai-overlay__meta">
                      {actionResult.points != null && (
                        <span>
                          {actionResult.points} points
                        </span>
                      )}

                      {actionResult.points != null &&
                        actionResult.distance != null && (
                          <span> · </span>
                        )}

                      {actionResult.distance != null && (
                        <span>
                          cost {actionResult.distance}
                        </span>
                      )}
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
        className={`ai-overlay__button${
          listening ? ' is-listening' : ''
        }${busy ? ' is-busy' : ''}`}
        onClick={() => {
          if (listening) {
            toggle()
          } else if (showPanel && !busy) {
            reset()
          } else if (!busy) {
            toggle()
          }
        }}
        disabled={!supported || busy}
        aria-pressed={listening}
        aria-label={
          listening
            ? 'Stop voice dictation'
            : 'Open voice assistant'
        }
        title={
          !supported
            ? 'Your browser does not support local speech recognition'
            : installing
              ? 'Preparing local speech model'
              : 'Voice assistant · en-US local'
        }
      >
        {listening && (
          <span
            className="ai-overlay__pulse"
            aria-hidden="true"
          />
        )}

        <img
          className="ai-overlay__icon"
          src={logoMaya}
          alt=""
          aria-hidden="true"
        />
      </button>
    </div>
  )
}
