import type { TerrainData, TerrainMeta } from './terrain'

export type GeoPoint = { lat: number; lon: number }
export type WorldPoint = { x: number; z: number }
export type TerrainSample = { elevation: number; y: number }

export type GeoProjection = {
  widthKm: number
  heightKm: number
  geoToWorld: (point: GeoPoint) => WorldPoint
  worldToGeo: (x: number, z: number) => GeoPoint
  /** Continuous DEM grid coordinates: u = column, v = row. */
  geoToGrid: (point: GeoPoint) => { u: number; v: number }
  gridToGeo: (u: number, v: number) => GeoPoint
}

export type TerrainModel = GeoProjection & {
  meta: TerrainMeta
  heights: Uint16Array
  rocky: Uint8Array | null
  midElevation: number
  elevationSpan: number
  qToMeters: number
  baseHeights: Float32Array
  /** Bilinear sample of heightmap. null when the point falls outside the DEM. */
  sampleAt: (
    x: number,
    z: number,
    exaggeration: number,
    out?: TerrainSample,
  ) => TerrainSample | null
  elevationAt: (point: GeoPoint) => number | null
}

/** Shared lat/lon ↔ world/grid projection for the DEM. */
export function createGeoProjection(meta: TerrainMeta): GeoProjection {
  const widthKm = meta.widthMeters / 1000
  const heightKm = meta.heightMeters / 1000
  const lonSpan = meta.bounds.lonMax - meta.bounds.lonMin || 1
  const latSpan = meta.bounds.latMax - meta.bounds.latMin || 1

  const geoToGrid = (point: GeoPoint) => ({
    u: ((point.lon - meta.bounds.lonMin) / lonSpan) * (meta.width - 1),
    v: ((meta.bounds.latMax - point.lat) / latSpan) * (meta.height - 1),
  })

  const gridToGeo = (u: number, v: number): GeoPoint => ({
    lon: meta.bounds.lonMin + (u / (meta.width - 1)) * lonSpan,
    lat: meta.bounds.latMax - (v / (meta.height - 1)) * latSpan,
  })

  const geoToWorld = (point: GeoPoint): WorldPoint => {
    const { u, v } = geoToGrid(point)
    return {
      x: (u / (meta.width - 1) - 0.5) * widthKm,
      z: (v / (meta.height - 1) - 0.5) * heightKm,
    }
  }

  const worldToGeo = (x: number, z: number): GeoPoint =>
    gridToGeo(
      (x / widthKm + 0.5) * (meta.width - 1),
      (z / heightKm + 0.5) * (meta.height - 1),
    )

  return { widthKm, heightKm, geoToWorld, worldToGeo, geoToGrid, gridToGeo }
}

export function createTerrainModel({ meta, heights, rocky }: TerrainData): TerrainModel {
  const projection = createGeoProjection(meta)
  const midElevation = (meta.minElevation + meta.maxElevation) / 2
  const elevationSpan = meta.maxElevation - meta.minElevation || 1
  const qToMeters = elevationSpan / (meta.nodata - 1)
  const count = meta.width * meta.height
  const widthKm = projection.widthKm
  const heightKm = projection.heightKm

  const baseHeights = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    const q = heights[i]
    if (q === meta.nodata) {
      baseHeights[i] = 0
      continue
    }
    const elevation = meta.minElevation + q * qToMeters
    baseHeights[i] = (elevation - midElevation) / 1000
  }

  const sampleAt = (
    x: number,
    z: number,
    exaggeration: number,
    out: TerrainSample = { elevation: 0, y: 0 },
  ): TerrainSample | null => {
    if (x < -widthKm / 2 || x > widthKm / 2) return null
    if (z < -heightKm / 2 || z > heightKm / 2) return null
    const u = ((x + widthKm / 2) / widthKm) * (meta.width - 1)
    const v = ((z + heightKm / 2) / heightKm) * (meta.height - 1)
    const col0 = Math.floor(u)
    const row0 = Math.floor(v)
    const col1 = Math.min(col0 + 1, meta.width - 1)
    const row1 = Math.min(row0 + 1, meta.height - 1)
    const fx = u - col0
    const fy = v - row0
    const i00 = row0 * meta.width + col0
    const i10 = row0 * meta.width + col1
    const i01 = row1 * meta.width + col0
    const i11 = row1 * meta.width + col1

    if (
      heights[i00] === meta.nodata ||
      heights[i10] === meta.nodata ||
      heights[i01] === meta.nodata ||
      heights[i11] === meta.nodata
    ) {
      return null
    }

    const base =
      (baseHeights[i00] * (1 - fx) + baseHeights[i10] * fx) * (1 - fy) +
      (baseHeights[i01] * (1 - fx) + baseHeights[i11] * fx) * fy
    const q =
      (heights[i00] * (1 - fx) + heights[i10] * fx) * (1 - fy) +
      (heights[i01] * (1 - fx) + heights[i11] * fx) * fy

    out.elevation = meta.minElevation + q * qToMeters
    out.y = base * exaggeration
    return out
  }

  const elevationAt = (point: GeoPoint): number | null => {
    const { x, z } = projection.geoToWorld(point)
    const sample = sampleAt(x, z, 1, { elevation: 0, y: 0 })
    return sample ? sample.elevation : null
  }

  return {
    ...projection,
    meta,
    heights,
    rocky,
    midElevation,
    elevationSpan,
    qToMeters,
    baseHeights,
    sampleAt,
    elevationAt,
  }
}
