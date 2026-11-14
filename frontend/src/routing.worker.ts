import type { TerrainMeta } from './terrain'
import {
  computeRoute,
  type RoutingInMessage,
  type RoutingOutMessage,
} from './routing'

type WorkerContext = {
  onmessage: ((event: MessageEvent<RoutingInMessage>) => void) | null
  postMessage: (message: RoutingOutMessage) => void
}

const context = globalThis as unknown as WorkerContext

let meta: TerrainMeta | null = null
let heights: Uint16Array | null = null

context.onmessage = (event) => {
  const message = event.data

  if (message.type === 'init') {
    meta = message.meta
    heights = message.heights
    context.postMessage({ type: 'ready' })
    return
  }

  if (message.type === 'route') {
    if (!meta || !heights) {
      context.postMessage({
        type: 'error',
        id: message.id,
        message: 'El terreno todavía se está preparando. Inténtalo de nuevo.',
      })
      return
    }

    try {
      const result = computeRoute(meta, heights, message.start, message.end)
      context.postMessage({ type: 'result', id: message.id, result })
    } catch (cause) {
      context.postMessage({
        type: 'error',
        id: message.id,
        message:
          cause instanceof Error
            ? cause.message
            : 'No se pudo calcular la ruta.',
      })
    }
  }
}
