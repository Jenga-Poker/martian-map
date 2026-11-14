import { useSpeechToText } from '../hooks/useSpeechToText'
import logoMaya from '../assets/logomaya-limpio.svg'

export default function SpeechToText() {
  const { status, transcript, interim, error, supported, aiResult, toggle, reset } =
    useSpeechToText()

  const listening = status === 'listening'
  const thinking = status === 'thinking'
  const hasText = transcript.length > 0 || interim.length > 0
  const showPanel = listening || thinking || hasText || Boolean(error) || Boolean(aiResult)

  const label = error
    ? 'Dictation Error'
    : listening
      ? 'Listening…'
      : thinking
        ? 'Processing with AI…'
        : aiResult
          ? 'AI Interpretation'
          : 'Voice Dictation'

  return (
    <div className="speech-dictation">
      {showPanel && (
        <div
          className={`speech-dictation__panel${error ? ' is-error' : ''}`}
          role="status"
          aria-live="polite"
        >
          <div className="speech-dictation__header">
            <p className="speech-dictation__label">{label}</p>
            {status === 'idle' && (
              <button
                type="button"
                className="speech-dictation__close"
                onClick={reset}
                aria-label="Dismiss"
                title="Dismiss"
              >
                ✕
              </button>
            )}
          </div>

          {error ? (
            <p className="speech-dictation__error">{error}</p>
          ) : (
            <>
              {hasText && (
                <p className="speech-dictation__text">
                  {transcript && <span>{transcript} </span>}
                  {interim && (
                    <span className="speech-dictation__interim">{interim}</span>
                  )}
                  {listening && (
                    <span className="speech-dictation__caret" aria-hidden="true" />
                  )}
                </p>
              )}
              {listening && !hasText && (
                <p className="speech-dictation__text">
                  <span className="speech-dictation__placeholder">
                    Speak now…
                  </span>
                </p>
              )}
            </>
          )}

          {thinking && (
            <div className="speech-dictation__thinking-container">
              <div className="speech-dictation__thinking" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <span className="speech-dictation__thinking-hint">Analyzing actions & options...</span>
            </div>
          )}

          {aiResult && !thinking && (
            <div className="speech-dictation__result">
              <div className="speech-dictation__result-item">
                <span className="speech-dictation__result-tag">Action</span>
                <span className="speech-dictation__result-action">{aiResult.action}</span>
              </div>
              <div className="speech-dictation__result-options">
                <span className="speech-dictation__result-tag">Options</span>
                <pre className="speech-dictation__result-json">
                  {JSON.stringify(aiResult.options, null, 2)}
                </pre>
              </div>
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
        aria-label={listening ? 'Stop voice dictation' : 'Start voice dictation'}
        title={
          supported
            ? 'Voice dictation'
            : 'Your browser does not support speech recognition'
        }
      >
        {listening && <span className="speech-dictation__pulse" aria-hidden="true" />}
        <img className="speech-dictation__icon" src={logoMaya} alt="" aria-hidden="true" />
      </button>
    </div>
  )
}
