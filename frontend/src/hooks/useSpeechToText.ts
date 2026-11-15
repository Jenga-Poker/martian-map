
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

export type SpeechStatus = 'idle' | 'listening'

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

type LocalAvailability =
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable'

type SpeechRecognitionInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  processLocally: boolean

  start: () => void
  stop: () => void
  abort: () => void

  onstart: (() => void) | null
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionConstructor = {
  new (): SpeechRecognitionInstance

  available?: (options: {
    langs: string[]
    processLocally: boolean
  }) => Promise<LocalAvailability>

  install?: (options: {
    langs: string[]
  }) => Promise<boolean>
}

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

const LANGUAGE = 'en-US'

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Permiso de micrófono denegado.',
  'service-not-allowed': 'Servicio de reconocimiento no permitido.',
  'audio-capture': 'No se encontró un micrófono.',
  network: 'Error de red o descarga del modelo local.',
  'no-speech': 'No se detectó voz.',
  'language-not-supported':
    'El modelo local en-US no está disponible.',
  aborted: 'Reconocimiento cancelado.',
  'bad-grammar': 'Error en la configuración del reconocimiento.',
}

function getRecognitionConstructor():
  SpeechRecognitionConstructor | null {

  if (typeof window === 'undefined') return null

  const speechWindow = window as SpeechWindow

  return (
    speechWindow.SpeechRecognition ??
    speechWindow.webkitSpeechRecognition ??
    null
  )
}

async function ensureLocalModel(
  Recognition: SpeechRecognitionConstructor
): Promise<void> {

  if (!Recognition.available || !Recognition.install) {
    throw new Error(
      'El navegador no implementa la API de reconocimiento local.'
    )
  }

  let availability = await Recognition.available({
    langs: [LANGUAGE],
    processLocally: true,
  })

  if (availability === 'available') {
    return
  }

  if (availability === 'unavailable') {
    throw new Error(
      `El modelo ${LANGUAGE} no está disponible en este navegador.`
    )
  }

  if (
    availability === 'downloadable' ||
    availability === 'downloading'
  ) {
    const installed = await Recognition.install({
      langs: [LANGUAGE],
    })

    if (!installed) {
      throw new Error(
        `No se pudo instalar el modelo local ${LANGUAGE}.`
      )
    }
  }

  availability = await Recognition.available({
    langs: [LANGUAGE],
    processLocally: true,
  })

  if (availability !== 'available') {
    throw new Error(
      `El modelo ${LANGUAGE} no está preparado. Estado: ${availability}`
    )
  }
}

export function useSpeechToText(
  options?: {
    onFinal?: (text: string) => void
  }
) {
  const [status, setStatus] =
    useState<SpeechStatus>('idle')

  const [transcript, setTranscript] =
    useState('')

  const [interim, setInterim] =
    useState('')

  const [error, setError] =
    useState<string | null>(null)

  const [supported, setSupported] =
    useState(false)

  const [modelReady, setModelReady] =
    useState(false)

  const [installing, setInstalling] =
    useState(false)

  const recognitionRef =
    useRef<SpeechRecognitionInstance | null>(null)

  const statusRef =
    useRef<SpeechStatus>('idle')

  const finalRef = useRef('')

  const onFinalRef =
    useRef(options?.onFinal)

  const startingRef = useRef(false)
  const cancelledRef = useRef(false)
  const generationRef = useRef(0)

  useEffect(() => {
    onFinalRef.current = options?.onFinal
  }, [options?.onFinal])

  const updateStatus = useCallback(
    (next: SpeechStatus) => {
      statusRef.current = next
      setStatus(next)
    },
    []
  )

  // Detectar soporte y comprobar el modelo local.
  useEffect(() => {
    let mounted = true

    async function initialize() {
      const Recognition = getRecognitionConstructor()

      setSupported(
        !!Recognition &&
        !!Recognition.available &&
        !!Recognition.install &&
        'processLocally' in Recognition.prototype
      )

      if (!Recognition?.available) return

      try {
        const availability = await Recognition.available({
          langs: [LANGUAGE],
          processLocally: true,
        })

        if (mounted) {
          setModelReady(availability === 'available')
        }
      } catch {
        if (mounted) setModelReady(false)
      }
    }

    initialize()

    return () => {
      mounted = false
    }
  }, [])

  const stop = useCallback(() => {
    cancelledRef.current = true

    const recognition = recognitionRef.current

    if (recognition) {
      try {
        recognition.stop()
      } catch {
        // Sesión ya detenida.
      }
    }
  }, [])

  const reset = useCallback(() => {
    generationRef.current++
    cancelledRef.current = true
    startingRef.current = false

    const recognition = recognitionRef.current
    recognitionRef.current = null

    if (recognition) {
      recognition.onstart = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null

      try {
        recognition.abort()
      } catch {
        // Ignorar.
      }
    }

    finalRef.current = ''

    updateStatus('idle')
    setTranscript('')
    setInterim('')
    setError(null)
  }, [updateStatus])

  const start = useCallback(async () => {
    if (
      startingRef.current ||
      statusRef.current === 'listening'
    ) {
      return
    }

    const Recognition = getRecognitionConstructor()

    if (!Recognition) {
      setSupported(false)
      setError('Web Speech API no soportada.')
      return
    }

    if (
      !Recognition.available ||
      !Recognition.install ||
      !('processLocally' in Recognition.prototype)
    ) {
      setError(
        'El navegador no soporta reconocimiento local.'
      )
      return
    }

    const generation = ++generationRef.current

    startingRef.current = true
    cancelledRef.current = false

    finalRef.current = ''

    setTranscript('')
    setInterim('')
    setError(null)

    try {
      setInstalling(true)

      await ensureLocalModel(Recognition)

      if (generation !== generationRef.current) return

      setModelReady(true)
      setInstalling(false)

      const recognition = new Recognition()

      recognition.lang = LANGUAGE
      recognition.processLocally = true
      recognition.continuous = false
      recognition.interimResults = true
      recognition.maxAlternatives = 1

      recognition.onstart = () => {
        if (generation !== generationRef.current) return

        startingRef.current = false
        updateStatus('listening')
      }

      recognition.onresult = (event) => {
        if (generation !== generationRef.current) return

        let finalText = ''
        let interimText = ''

        for (
          let index = event.resultIndex;
          index < event.results.length;
          index++
        ) {
          const result = event.results[index]
          const text = result[0]?.transcript ?? ''

          if (result.isFinal) {
            finalText += text
          } else {
            interimText += text
          }
        }

        if (finalText.trim()) {
          finalRef.current +=
            (finalRef.current ? ' ' : '') +
            finalText.trim()
        }

        setTranscript(finalRef.current)
        setInterim(interimText.trim())
      }

      recognition.onerror = (event) => {
        if (generation !== generationRef.current) return

        if (event.error === 'aborted' && cancelledRef.current) {
          return
        }

        const message =
          ERROR_MESSAGES[event.error] ??
          `Error de reconocimiento: ${event.error}`

        if (event.error !== 'no-speech') {
          setError(message)
        }
      }

      recognition.onend = () => {
        if (generation !== generationRef.current) return

        recognitionRef.current = null
        startingRef.current = false

        updateStatus('idle')
        setInterim('')

        if (cancelledRef.current) return

        const spoken = finalRef.current.trim()

        if (spoken) {
          setTranscript(spoken)
          onFinalRef.current?.(spoken)
        }
      }

      if (generation !== generationRef.current) return

      recognitionRef.current = recognition

      // Debe ejecutarse como consecuencia de la acción
      // del usuario para solicitar acceso al micrófono.
      recognition.start()

    } catch (err) {
      if (generation !== generationRef.current) return

      const message =
        err instanceof Error
          ? err.message
          : 'No se pudo iniciar el reconocimiento local.'

      setError(message)

      startingRef.current = false
      updateStatus('idle')

    } finally {
      if (generation === generationRef.current) {
        setInstalling(false)
      }
    }
  }, [updateStatus])

  const toggle = useCallback(() => {
    if (statusRef.current === 'idle') {
      void start()
    } else {
      stop()
    }
  }, [start, stop])

  return {
    status,
    transcript,
    interim,
    error,
    supported,
    modelReady,
    installing,
    toggle,
    reset,
    start,
    stop,
  }
}
