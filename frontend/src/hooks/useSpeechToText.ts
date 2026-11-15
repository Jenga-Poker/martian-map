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

  addEventListener: (type: string, listener: () => void) => void
}

type SpeechRecognitionConstructor = {
  new (): SpeechRecognitionInstance

  available?: (options: {
    langs: string[]
    processLocally: boolean
  }) => Promise<LocalAvailability>

  install?: (options: {
    langs: string[]
    processLocally: boolean
  }) => Promise<boolean>
}

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

const LANGUAGE = 'en-US'

const LOCAL_OPTIONS = {
  langs: [LANGUAGE],
  processLocally: true,
}

const INSTALL_POLL_ATTEMPTS = 120
const INSTALL_POLL_INTERVAL_MS = 1000

// Maximum wait time for a cloud response after the audio ends.
const CLOUD_RESPONSE_TIMEOUT_MS = 5000

// Cloud errors after which it retries locally.
const CLOUD_FALLBACK_ERRORS = [
  'network',
  'service-not-allowed',
  'language-not-supported',
]

const DEBUG_EVENTS = [
  'audiostart',
  'soundstart',
  'speechstart',
  'speechend',
  'soundend',
  'audioend',
] as const

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone permission denied.',
  'service-not-allowed': 'Recognition service not allowed.',
  'audio-capture': 'No microphone found.',
  network: 'Network error or local model download failure.',
  'no-speech': 'No speech detected.',
  'language-not-supported':
    'The en-US local model is not available.',
  aborted: 'Recognition cancelled.',
  'bad-grammar': 'Recognition configuration error.',
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine
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

function supportsLocal(
  Recognition: SpeechRecognitionConstructor
): boolean {
  return (
    !!Recognition.available &&
    !!Recognition.install &&
    'processLocally' in Recognition.prototype
  )
}

async function ensureLocalModel(
  Recognition: SpeechRecognitionConstructor,
  callbacks?: {
    // If false, downloading is never attempted (e.g. offline).
    allowInstall?: boolean
    onInstalling?: (installing: boolean) => void
    isCancelled?: () => boolean
  }
): Promise<void> {

  if (!Recognition.available || !Recognition.install) {
    throw new Error(
      'The browser does not implement the local recognition API.'
    )
  }

  let availability = await Recognition.available(LOCAL_OPTIONS)

  if (availability === 'available') return

  if (availability === 'unavailable') {
    throw new Error(
      `The ${LANGUAGE} model is not available in this browser.`
    )
  }

  if (callbacks?.allowInstall === false) {
    throw new Error(
      `Offline and the ${LANGUAGE} local model is not installed. ` +
      'Connect to the internet once to download it.'
    )
  }

  // 'downloadable' | 'downloading' -> install / wait for the download.
  callbacks?.onInstalling?.(true)

  try {
    const installed = await Recognition.install(LOCAL_OPTIONS)

    if (!installed) {
      throw new Error(
        `Could not install the ${LANGUAGE} local model.`
      )
    }

    // The download may still be in progress: wait up to 2 minutes.
    for (let attempt = 0; attempt < INSTALL_POLL_ATTEMPTS; attempt++) {
      if (callbacks?.isCancelled?.()) return

      availability = await Recognition.available(LOCAL_OPTIONS)

      if (availability === 'available') return

      if (availability === 'unavailable') break

      await sleep(INSTALL_POLL_INTERVAL_MS)
    }

    throw new Error(
      `The ${LANGUAGE} model is not ready. State: ${availability}`
    )
  } finally {
    callbacks?.onInstalling?.(false)
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
  const prefetchingRef = useRef(false)
  const fallbackRef = useRef(false)
  const cloudFailedRef = useRef(false)

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

  // Detect support and check the local model.
  useEffect(() => {
    let mounted = true

    async function initialize() {
      const Recognition = getRecognitionConstructor()

      // With internet the standard (cloud) API is enough;
      // the local model is only needed offline.
      setSupported(!!Recognition)

      if (!Recognition?.available) return

      try {
        const availability =
          await Recognition.available(LOCAL_OPTIONS)

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

  // Download the local model in the background (only if online)
  // so it is available when the connection is lost.
  const prefetchLocalModel = useCallback(
    async (Recognition: SpeechRecognitionConstructor) => {
      if (prefetchingRef.current) return

      prefetchingRef.current = true

      try {
        await ensureLocalModel(Recognition, {
          onInstalling: setInstalling,
        })

        setModelReady(true)
      } catch {
        // Best effort: cloud recognition keeps working.
      } finally {
        prefetchingRef.current = false
      }
    },
    []
  )

  const stop = useCallback(() => {
    cancelledRef.current = true
    fallbackRef.current = false

    const recognition = recognitionRef.current

    if (recognition) {
      try {
        recognition.stop()
      } catch {
        // Session already stopped.
      }
    }
  }, [])

  const reset = useCallback(() => {
    console.trace('[speech] reset() called')

    generationRef.current++
    cancelledRef.current = true
    fallbackRef.current = false
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
        // Ignore.
      }
    }

    finalRef.current = ''

    updateStatus('idle')
    setTranscript('')
    setInterim('')
    setError(null)
    setInstalling(false)
  }, [updateStatus])

  const start = useCallback(async () => {
    console.log('[speech] start() called', {
      starting: startingRef.current,
      status: statusRef.current,
      online: !isOffline(),
    })

    if (
      startingRef.current ||
      statusRef.current === 'listening'
    ) {
      console.log('[speech] start() ignored: already starting/listening')
      return
    }

    const Recognition = getRecognitionConstructor()

    if (!Recognition) {
      console.log('[speech] no SpeechRecognition constructor')
      setSupported(false)
      setError('Web Speech API not supported.')
      return
    }

    const offline = isOffline()
    const localSupported = supportsLocal(Recognition)

    if (offline && !localSupported) {
      setError(
        'Offline and the browser does not support local recognition.'
      )
      return
    }

    const generation = ++generationRef.current

    startingRef.current = true
    cancelledRef.current = false
    fallbackRef.current = false

    finalRef.current = ''

    setTranscript('')
    setInterim('')
    setError(null)

    const isStale = () => generation !== generationRef.current

    const handleError = (err: unknown) => {
      if (isStale()) return

      const message =
        err instanceof Error
          ? err.message
          : 'Could not start recognition.'

      setError(message)

      startingRef.current = false
      updateStatus('idle')
    }

    // Launch a recognition session, in the cloud or locally.
    const launch = async (local: boolean): Promise<void> => {
      if (local) {
        // Offline the model must already be installed;
        // online it is installed if missing.
        await ensureLocalModel(Recognition, {
          allowInstall: !isOffline(),
          onInstalling: setInstalling,
          isCancelled: isStale,
        })

        if (isStale()) return

        setModelReady(true)
      }

      const recognition = new Recognition()

      recognition.lang = LANGUAGE
      recognition.continuous = false
      recognition.interimResults = true
      recognition.maxAlternatives = 1

      if (local) {
        recognition.processLocally = true
      }

      const mode = local ? 'local' : 'cloud'

      for (const name of DEBUG_EVENTS) {
        recognition.addEventListener(name, () => {
          console.log(`[speech] ${mode}: ${name}`)
        })
      }

      // If the cloud does not respond after the audio ends (no result,
      // no error, no end), abort and repeat the session locally.
      let watchdog: ReturnType<typeof setTimeout> | null = null

      const clearWatchdog = () => {
        if (watchdog) {
          clearTimeout(watchdog)
          watchdog = null
        }
      }

      if (!local && localSupported) {
        recognition.addEventListener('audioend', () => {
          clearWatchdog()

          watchdog = setTimeout(() => {
            if (
              isStale() ||
              cancelledRef.current ||
              recognitionRef.current !== recognition
            ) {
              return
            }

            console.warn(
              '[speech] cloud: no response after audioend, using local'
            )

            cloudFailedRef.current = true

            recognition.onstart = null
            recognition.onresult = null
            recognition.onerror = null
            recognition.onend = null
            recognitionRef.current = null

            try {
              recognition.abort()
            } catch {
              // Ignore.
            }

            finalRef.current = ''
            setInterim('')
            startingRef.current = true

            launch(true).catch(handleError)
          }, CLOUD_RESPONSE_TIMEOUT_MS)
        })
      }

      recognition.onstart = () => {
        if (isStale()) {
          console.log('[speech] onstart ignored (stale session)')
          return
        }

        console.log(`[speech] ${mode}: start`)

        startingRef.current = false
        updateStatus('listening')
      }

      recognition.onresult = (event) => {
        if (isStale()) {
          console.log('[speech] onresult ignored (stale session)')
          return
        }

        clearWatchdog()

        console.log(
          '[speech] result',
          Array.from(
            { length: event.results.length },
            (_, i) => ({
              text: event.results[i][0]?.transcript,
              final: event.results[i].isFinal,
            })
          )
        )

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
        if (isStale()) {
          console.log('[speech] onerror ignored (stale session)')
          return
        }

        clearWatchdog()

        console.warn(
          `[speech] error (${local ? 'local' : 'cloud'}):`,
          event.error,
          event.message
        )

        if (event.error === 'aborted' && cancelledRef.current) {
          return
        }

        // The cloud failed: retry locally without bothering the user.
        if (
          !local &&
          localSupported &&
          !cancelledRef.current &&
          CLOUD_FALLBACK_ERRORS.includes(event.error)
        ) {
          fallbackRef.current = true
          cloudFailedRef.current = true
          return
        }

        const message =
          ERROR_MESSAGES[event.error] ??
          `Recognition error: ${event.error}`

        if (event.error !== 'no-speech') {
          setError(message)
        }
      }

      recognition.onend = () => {
        if (isStale()) {
          console.log('[speech] onend ignored (stale session)')
          return
        }

        clearWatchdog()

        recognitionRef.current = null
        setInterim('')

        if (fallbackRef.current && !cancelledRef.current) {
          fallbackRef.current = false
          startingRef.current = true

          launch(true).catch(handleError)
          return
        }

        startingRef.current = false
        updateStatus('idle')

        console.log(
          `[speech] ${mode}: end, final text:`,
          JSON.stringify(finalRef.current)
        )

        // Online: install the local model in the background
        // when there is no longer an active session.
        if (!local && localSupported) {
          void prefetchLocalModel(Recognition)
        }

        if (cancelledRef.current) return

        const spoken = finalRef.current.trim()

        if (spoken) {
          setTranscript(spoken)
          onFinalRef.current?.(spoken)
        }
      }

      if (isStale()) return

      recognitionRef.current = recognition

      // It must run as a consequence of the user's
      // action to request microphone access.
      recognition.start()
    }

    // Local if offline, or if the cloud already failed before.
    const useLocal =
      offline || (cloudFailedRef.current && localSupported)

    console.log('[speech] launching', useLocal ? 'local' : 'cloud')

    try {
      await launch(useLocal)
    } catch (err) {
      handleError(err)
    }
  }, [prefetchLocalModel, updateStatus])

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
