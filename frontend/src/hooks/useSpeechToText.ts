import { useCallback, useEffect, useRef, useState } from 'react'

export type SpeechStatus = 'idle' | 'listening' | 'thinking'

const THINKING_MS = 2400

type SpeechAlternative = {
  transcript: string
  confidence: number
}

type SpeechResult = {
  isFinal: boolean
  length: number
  [index: number]: SpeechAlternative
}

type SpeechResultList = {
  length: number
  [index: number]: SpeechResult
}

type SpeechResultEvent = {
  resultIndex: number
  results: SpeechResultList
}

type SpeechErrorEvent = {
  error: string
  message: string
}

type SpeechRecognitionInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onstart: (() => void) | null
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Permiso de micrófono denegado.',
  'service-not-allowed': 'El servicio de voz no está disponible.',
  'audio-capture': 'No se encontró un micrófono.',
  network: 'Sin conexión con el servicio de voz.',
  'no-speech': 'No se detectó voz. Inténtalo de nuevo.',
  'language-not-supported': 'Idioma no compatible con el dictado.',
}

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const speechWindow = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

export function useSpeechToText() {
  const [status, setStatus] = useState<SpeechStatus>('idle')
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [supported, setSupported] = useState(false)

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const statusRef = useRef<SpeechStatus>('idle')
  const finalRef = useRef('')
  const interimRef = useRef('')
  const timerRef = useRef<number | null>(null)

  const updateStatus = useCallback((next: SpeechStatus) => {
    statusRef.current = next
    setStatus(next)
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    setSupported(getRecognitionConstructor() !== null)
    return () => {
      clearTimer()
      const recognition = recognitionRef.current
      if (!recognition) return
      recognition.onstart = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      try {
        recognition.abort()
      } catch {
        // Ignorar fallos al abortar un reconocimiento ya detenido.
      }
      recognitionRef.current = null
    }
  }, [clearTimer])

  const start = useCallback(() => {
    const Recognition = getRecognitionConstructor()
    if (!Recognition) {
      setSupported(false)
      return
    }

    clearTimer()
    const recognition = new Recognition()
    recognition.lang = 'en-US'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    finalRef.current = ''
    interimRef.current = ''
    setTranscript('')
    setInterim('')
    setError(null)

    recognition.onstart = () => {
      updateStatus('listening')
    }

    recognition.onresult = (event) => {
      let finalText = ''
      let interimText = ''
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) finalText += text
        else interimText += text
      }
      finalRef.current = finalText.trim()
      interimRef.current = interimText.trim()
      setTranscript(finalRef.current)
      setInterim(interimRef.current)
    }

    recognition.onerror = (event) => {
      const message = ERROR_MESSAGES[event.error]
      if (message) setError(message)
      updateStatus('idle')
    }

    recognition.onend = () => {
      recognitionRef.current = null
      if (statusRef.current !== 'listening') {
        setInterim('')
        interimRef.current = ''
        return
      }

      const spoken = `${finalRef.current} ${interimRef.current}`.trim()
      interimRef.current = ''
      setInterim('')
      setTranscript(spoken)

      if (!spoken) {
        updateStatus('idle')
        return
      }

      updateStatus('thinking')
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        updateStatus('idle')
      }, THINKING_MS)
    }

    recognitionRef.current = recognition
    updateStatus('listening')
    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      updateStatus('idle')
      setError('No se pudo iniciar el dictado.')
    }
  }, [clearTimer, updateStatus])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const toggle = useCallback(() => {
    if (statusRef.current === 'idle') start()
    else if (statusRef.current === 'listening') stop()
  }, [start, stop])

  return { status, transcript, interim, error, supported, toggle }
}
