import { useSpeechToText } from '../hooks/useSpeechToText'

export default function SpeechToText() {
  const { status, transcript, interim, error, supported, toggle } =
    useSpeechToText()

  const listening = status === 'listening'
  const thinking = status === 'thinking'
  const hasText = transcript.length > 0 || interim.length > 0
  const showPanel = listening || thinking || hasText || Boolean(error)

  const label = error
    ? 'Dictado no disponible'
    : listening
      ? 'Escuchando…'
      : thinking
        ? 'Pensando…'
        : 'Dictado'

  return (
    <div className="speech-dictation">
      {showPanel && (
        <div
          className={`speech-dictation__panel${error ? ' is-error' : ''}`}
          role="status"
          aria-live="polite"
        >
          <p className="speech-dictation__label">{label}</p>

          {error ? (
            <p className="speech-dictation__error">{error}</p>
          ) : (
            <p className="speech-dictation__text">
              {transcript && <span>{transcript} </span>}
              {interim && (
                <span className="speech-dictation__interim">{interim}</span>
              )}
              {listening && hasText && (
                <span className="speech-dictation__caret" aria-hidden="true" />
              )}
              {listening && !hasText && (
                <span className="speech-dictation__placeholder">
                  Habla ahora…
                </span>
              )}
            </p>
          )}

          {thinking && (
            <div className="speech-dictation__thinking" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className={`speech-dictation__button${listening ? ' is-listening' : ''}${thinking ? ' is-thinking' : ''}`}
        onClick={toggle}
        disabled={!supported || thinking}
        aria-pressed={listening}
        aria-label={listening ? 'Detener dictado por voz' : 'Dictar por voz'}
        title={
          supported
            ? 'Dictar por voz'
            : 'Tu navegador no admite reconocimiento de voz'
        }
      >
        {listening && <span className="speech-dictation__pulse" aria-hidden="true" />}
        <svg
          className="speech-dictation__icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3" />
          <path d="M8 21h8" />
        </svg>
      </button>
    </div>
  )
}
