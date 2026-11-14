import type { TerrainMeta } from './terrain'
import {
  createGeoProjection,
  type GeoPoint,
  type WorldPoint,
} from './terrainModel'

export type RoutePoint = {
  x: number
  z: number
  elevation: number
}

export type RouteStats = {
  /** Horizontal length of the route, in metres. */
  distance2d: number
  /** Length following the relief, in metres. */
  distance3d: number
  /** Accumulated climb, in metres. */
  ascent: number
  /** Accumulated descent, in metres. */
  descent: number
  /** Steepest segment of the route, as a rise/run ratio. */
  maxSlope: number
  minElevation: number
  maxElevation: number
  /** Number of DEM cells the route crosses. */
  cells: number
}

export type RouteResult = {
  start: RoutePoint
  end: RoutePoint
  /** Smoothed polyline in world kilometres, ready to render. */
  points: RoutePoint[]
  stats: RouteStats
}

export type RoutingInitMessage = {
  type: 'init'
  meta: TerrainMeta
  heights: Uint16Array
}

export type RoutingRequestMessage = {
  type: 'route'
  id: number
  start: GeoPoint
  end: GeoPoint
}

export type RoutingInMessage = RoutingInitMessage | RoutingRequestMessage

export type RoutingReadyMessage = { type: 'ready' }

export type RoutingResultMessage = {
  type: 'result'
  id: number
  result: RouteResult
}

export type RoutingErrorMessage = {
  type: 'error'
  id: number
  message: string
}

export type RoutingOutMessage =
  | RoutingReadyMessage
  | RoutingResultMessage
  | RoutingErrorMessage

/** Extra cost per unit of squared slope: 10 means a 50 % grade costs 3.5×. */
const SLOPE_WEIGHT = 10
/** Extra cost when walking uphill (positive slope). */
const UPHILL_WEIGHT = 2.5

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
]

class MinHeap {
  private nodes: Int32Array
  private scores: Float32Array
  private length = 0

  constructor(capacity: number) {
    const size = Math.max(16, capacity)
    this.nodes = new Int32Array(size)
    this.scores = new Float32Array(size)
  }

  get size(): number {
    return this.length
  }

  push(node: number, score: number): void {
    if (this.length === this.nodes.length) {
      const grownNodes = new Int32Array(this.nodes.length * 2)
      grownNodes.set(this.nodes)
      this.nodes = grownNodes
      const grownScores = new Float32Array(this.scores.length * 2)
      grownScores.set(this.scores)
      this.scores = grownScores
    }
    const nodes = this.nodes
    const scores = this.scores
    let index = this.length
    this.length += 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (scores[parent] <= score) break
      nodes[index] = nodes[parent]
      scores[index] = scores[parent]
      index = parent
    }
    nodes[index] = node
    scores[index] = score
  }

  pop(): number {
    const nodes = this.nodes
    const scores = this.scores
    const top = nodes[0]
    this.length -= 1
    const lastNode = nodes[this.length]
    const lastScore = scores[this.length]
    if (this.length > 0) {
      const size = this.length
      let index = 0
      for (;;) {
        const left = index * 2 + 1
        if (left >= size) break
        const right = left + 1
        const child =
          right < size && scores[right] < scores[left] ? right : left
        if (scores[child] >= lastScore) break
        nodes[index] = nodes[child]
        scores[index] = scores[child]
        index = child
      }
      nodes[index] = lastNode
      scores[index] = lastScore
    }
    return top
  }
}

function gridToWorld(
  col: number,
  row: number,
  width: number,
  height: number,
  widthKm: number,
  heightKm: number,
): WorldPoint {
  return {
    x: (col / (width - 1) - 0.5) * widthKm,
    z: (row / (height - 1) - 0.5) * heightKm,
  }
}

function snapToValidCell(
  elevations: Float32Array,
  width: number,
  height: number,
  col: number,
  row: number,
): number {
  const clampedCol = Math.min(width - 1, Math.max(0, col))
  const clampedRow = Math.min(height - 1, Math.max(0, row))
  const direct = clampedRow * width + clampedCol
  if (!Number.isNaN(elevations[direct])) return direct

  const maxRadius = Math.max(width, height)
  for (let radius = 1; radius < maxRadius; radius += 1) {
    let best = -1
    let bestDistance = Infinity
    for (let dr = -radius; dr <= radius; dr += 1) {
      const r = clampedRow + dr
      if (r < 0 || r >= height) continue
      const edge = Math.abs(dr) === radius
      const step = edge ? 1 : radius * 2
      for (let dc = -radius; dc <= radius; dc += step) {
        const c = clampedCol + dc
        if (c < 0 || c >= width) continue
        const index = r * width + c
        if (Number.isNaN(elevations[index])) continue
        const distance = dr * dr + dc * dc
        if (distance < bestDistance) {
          bestDistance = distance
          best = index
        }
      }
    }
    if (best >= 0) return best
  }

  throw new Error('No hay celdas válidas en el DEM para trazar la ruta.')
}

function chaikin(points: WorldPoint[], iterations: number): WorldPoint[] {
  let current = points
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (current.length < 3) break
    const next: WorldPoint[] = [current[0]]
    for (let i = 0; i < current.length - 1; i += 1) {
      const a = current[i]
      const b = current[i + 1]
      next.push(
        { x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 },
        { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 },
      )
    }
    next.push(current[current.length - 1])
    current = next
  }
  return current
}

export function computeRoute(
  meta: TerrainMeta,
  heights: Uint16Array,
  startGeo: GeoPoint,
  endGeo: GeoPoint,
): RouteResult {
  if (heights.length !== meta.width * meta.height) {
    throw new Error('El heightmap no coincide con las dimensiones del DEM.')
  }

  const { width, height, nodata } = meta
  const projection = createGeoProjection(meta)
  const { widthKm, heightKm } = projection
  const qToMeters = (meta.maxElevation - meta.minElevation) / (nodata - 1 || 1)
  const stepX = (widthKm * 1000) / (width - 1)
  const stepZ = (heightKm * 1000) / (height - 1)
  const stepDiagonal = Math.hypot(stepX, stepZ)

  const startGrid = projection.geoToGrid(startGeo)
  const endGrid = projection.geoToGrid(endGeo)
  const inside = (u: number, v: number) =>
    u >= -1e-6 && u <= width - 1 + 1e-6 && v >= -1e-6 && v <= height - 1 + 1e-6

  if (!inside(startGrid.u, startGrid.v)) {
    throw new Error('El punto de inicio queda fuera de la huella del DEM.')
  }
  if (!inside(endGrid.u, endGrid.v)) {
    throw new Error('El punto final queda fuera de la huella del DEM.')
  }

  // Elevation in metres for every cell (NaN = nodata).
  const elevations = new Float32Array(width * height)
  for (let i = 0; i < elevations.length; i += 1) {
    const q = heights[i]
    elevations[i] = q === nodata ? Number.NaN : meta.minElevation + q * qToMeters
  }

  const startIndex = snapToValidCell(
    elevations,
    width,
    height,
    Math.round(startGrid.u),
    Math.round(startGrid.v),
  )
  const endIndex = snapToValidCell(
    elevations,
    width,
    height,
    Math.round(endGrid.u),
    Math.round(endGrid.v),
  )

  const count = width * height
  const gScore = new Float32Array(count)
  gScore.fill(Infinity)
  const cameFrom = new Int32Array(count)
  cameFrom.fill(-1)
  const closed = new Uint8Array(count)
  const heap = new MinHeap(Math.min(count, 1 << 18))

  const endCol = endIndex % width
  const endRow = Math.floor(endIndex / width)
  const heuristic = (index: number): number => {
    const col = index % width
    const row = Math.floor(index / width)
    return Math.hypot((col - endCol) * stepX, (row - endRow) * stepZ)
  }

  gScore[startIndex] = 0
  heap.push(startIndex, heuristic(startIndex))

  let found = startIndex === endIndex

  while (heap.size > 0 && !found) {
    const current = heap.pop()
    if (closed[current]) continue
    closed[current] = 1

    if (current === endIndex) {
      found = true
      break
    }

    const currentCol = current % width
    const currentRow = Math.floor(current / width)
    const currentElevation = elevations[current]
    const currentG = gScore[current]

    for (let n = 0; n < NEIGHBORS.length; n += 1) {
      const col = currentCol + NEIGHBORS[n][0]
      const row = currentRow + NEIGHBORS[n][1]
      if (col < 0 || col >= width || row < 0 || row >= height) continue
      const next = row * width + col
      if (closed[next]) continue
      const nextElevation = elevations[next]
      if (Number.isNaN(nextElevation)) continue

      const diagonal = col !== currentCol && row !== currentRow
      const step = diagonal ? stepDiagonal : col !== currentCol ? stepX : stepZ
      const slope = (nextElevation - currentElevation) / step
      const uphill = slope > 0 ? slope : 0
      const penalty =
        1 + SLOPE_WEIGHT * slope * slope + UPHILL_WEIGHT * uphill
      const tentative = currentG + step * penalty

      if (tentative < gScore[next]) {
        gScore[next] = tentative
        cameFrom[next] = current
        heap.push(next, tentative + heuristic(next))
      }
    }
  }

  if (!found) {
    throw new Error(
      'No se encontró una ruta transitable entre esos puntos. Prueba con coordenadas más cercanas o en zonas llanas.',
    )
  }

  const path: number[] = []
  let cursor = endIndex
  while (cursor !== -1) {
    path.push(cursor)
    if (cursor === startIndex) break
    cursor = cameFrom[cursor]
  }
  path.reverse()

  let distance2d = 0
  let distance3d = 0
  let ascent = 0
  let descent = 0
  let maxSlope = 0
  let minElevation = Infinity
  let maxElevation = -Infinity

  for (let i = 0; i < path.length; i += 1) {
    const elevation = elevations[path[i]]
    if (elevation < minElevation) minElevation = elevation
    if (elevation > maxElevation) maxElevation = elevation
    if (i === 0) continue
    const previous = path[i - 1]
    const prevCol = previous % width
    const prevRow = Math.floor(previous / width)
    const col = path[i] % width
    const row = Math.floor(path[i] / width)
    const diagonal = col !== prevCol && row !== prevRow
    const horizontal = diagonal
      ? stepDiagonal
      : col !== prevCol
        ? stepX
        : stepZ
    const rise = elevation - elevations[previous]
    distance2d += horizontal
    distance3d += Math.hypot(horizontal, rise)
    if (rise > 0) ascent += rise
    else descent -= rise
    const slope = Math.abs(rise) / horizontal
    if (slope > maxSlope) maxSlope = slope
  }

  const raw = path.map((index) =>
    gridToWorld(
      index % width,
      Math.floor(index / width),
      width,
      height,
      widthKm,
      heightKm,
    ),
  )

  const bilinearElevation = (x: number, z: number): number | null => {
    const u = (x / widthKm + 0.5) * (width - 1)
    const v = (z / heightKm + 0.5) * (height - 1)
    const col0 = Math.min(width - 1, Math.max(0, Math.floor(u)))
    const row0 = Math.min(height - 1, Math.max(0, Math.floor(v)))
    const col1 = Math.min(width - 1, col0 + 1)
    const row1 = Math.min(height - 1, row0 + 1)
    const fx = u - col0
    const fy = v - row0
    const i00 = row0 * width + col0
    const i10 = row0 * width + col1
    const i01 = row1 * width + col0
    const i11 = row1 * width + col1
    const values = [elevations[i00], elevations[i10], elevations[i01], elevations[i11]]
    if (values.some((value) => Number.isNaN(value))) {
      const nearest = elevations[Math.round(v) * width + Math.round(u)]
      return Number.isNaN(nearest) ? null : nearest
    }
    return (
      (values[0] * (1 - fx) + values[1] * fx) * (1 - fy) +
      (values[2] * (1 - fx) + values[3] * fx) * fy
    )
  }

  const smoothed = chaikin(raw, 2)
  let lastElevation = elevations[startIndex]
  const points: RoutePoint[] = smoothed.map((point) => {
    const elevation = bilinearElevation(point.x, point.z) ?? lastElevation
    lastElevation = elevation
    return { x: point.x, z: point.z, elevation }
  })
  points[0].elevation = elevations[startIndex]
  points[points.length - 1].elevation = elevations[endIndex]

  const startWorld = raw[0]
  const endWorld = raw[raw.length - 1]

  return {
    start: {
      x: startWorld.x,
      z: startWorld.z,
      elevation: elevations[startIndex],
    },
    end: {
      x: endWorld.x,
      z: endWorld.z,
      elevation: elevations[endIndex],
    },
    points,
    stats: {
      distance2d,
      distance3d,
      ascent,
      descent,
      maxSlope,
      minElevation,
      maxElevation,
      cells: path.length,
    },
  }
}


