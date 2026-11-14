import type { TerrainMeta } from './terrain'
import type { GeoPoint } from './terrainModel'

export type ParsedRoute = { start: GeoPoint; end: GeoPoint }

type CoordinatePair = readonly [number, number]

function toPair(value: unknown): CoordinatePair | null {
  if (Array.isArray(value) && value.length >= 2) {
    const lat = Number(value[0])
    const lon = Number(value[1])
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const lat = Number(record.lat ?? record.latitude)
    const lon = Number(record.lon ?? record.lng ?? record.longitude)
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null
  }
  return null
}

function collectPairs(value: unknown, depth = 0): CoordinatePair[] {
  if (depth > 4) return []
  const direct = toPair(value)
  if (direct) return [direct]

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPairs(entry, depth + 1))
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.type === 'Feature') return collectPairs(record.geometry, depth + 1)
    if (record.type === 'FeatureCollection') {
      return collectPairs(record.features, depth + 1)
    }

    const start = toPair(record.start ?? record.from ?? record.origin)
    const end = toPair(record.end ?? record.to ?? record.destination)
    if (start && end) return [start, end]

    for (const key of ['points', 'path', 'route', 'coordinates']) {
      if (key in record) {
        const pairs = collectPairs(record[key], depth + 1)
        if (pairs.length > 0) return pairs
      }
    }
  }

  return []
}

/**
 * Jezero's DEM has very different latitude (~18°) and longitude (~77°) ranges,
 * so we can detect and fix lon/lat pairs supplied in the wrong order.
 */
function orientPoint(first: number, second: number, meta: TerrainMeta): GeoPoint {
  const { latMin, latMax, lonMin, lonMax } = meta.bounds
  const inside = (lat: number, lon: number) =>
    lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax

  if (inside(first, second)) return { lat: first, lon: second }
  if (inside(second, first)) return { lat: second, lon: first }
  throw new Error(
    `La coordenada ${first}, ${second} queda fuera del DEM del cráter Jezero.`,
  )
}

function parseCsv(text: string): CoordinatePair[] {
  const pairs: CoordinatePair[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim()
    if (!line) continue

    const separator = line.includes(';')
      ? ';'
      : line.includes('\t')
        ? '\t'
        : line.includes(',')
          ? ','
          : null

    const fields = (separator ? line.split(separator) : line.split(/\s+/))
      .map((field) => field.trim())
      .filter(Boolean)

    if (fields.length < 2) continue

    const first = Number(fields[0].replace(',', '.'))
    const second = Number(fields[1].replace(',', '.'))
    // Skip headers and malformed rows.
    if (!Number.isFinite(first) || !Number.isFinite(second)) continue
    pairs.push([first, second])
  }

  return pairs
}

function buildRoute(pairs: CoordinatePair[], meta: TerrainMeta): ParsedRoute {
  if (pairs.length < 2) {
    throw new Error(
      'El archivo debe contener al menos dos puntos con latitud y longitud.',
    )
  }
  const first = pairs[0]
  const last = pairs[pairs.length - 1]
  return {
    start: orientPoint(first[0], first[1], meta),
    end: orientPoint(last[0], last[1], meta),
  }
}

/**
 * Accepts plain JSON/CSV coordinate lists. Only the first and last point are
 * used: the route itself is calculated over the DEM.
 *
 * JSON: `[[lat, lon], [lat, lon], ...]`, `[{ "lat": 18.45, "lon": 77.44 }]`,
 * `{ "start": [lat, lon], "end": [lat, lon] }` or GeoJSON points/lines.
 * CSV: two numeric columns per row (`lat,lon`, `lat;lon` or whitespace).
 */
export function parseRouteInput(
  text: string,
  filename: string,
  meta: TerrainMeta,
): ParsedRoute {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('El archivo está vacío.')

  const looksJson =
    trimmed.startsWith('[') ||
    trimmed.startsWith('{') ||
    /\.json$/i.test(filename)

  if (looksJson) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('El archivo JSON no es válido.')
    }
    return buildRoute(collectPairs(parsed), meta)
  }

  return buildRoute(parseCsv(trimmed), meta)
}
