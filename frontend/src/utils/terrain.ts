export type TerrainMeta = {
  width: number
  height: number
  nodata: number
  dtype: string
  minElevation: number
  maxElevation: number
  colorMin: number
  colorMax: number
  widthMeters: number
  heightMeters: number
  sourcePixelSizeMeters: number | { x: number; y: number }
  metersPerPixel?: { x: number; y: number }
  sourceWidth: number
  sourceHeight: number
  sourceBoundsPx?: { x0: number; y0: number; x1: number; y1: number }
  validRatio: number
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number }
  center: { lat: number; lon: number }
  crs: string
  sourceFile: string
}

export function normalizeTerrainMeta(meta: TerrainMeta): TerrainMeta {
  const s = meta.sourcePixelSizeMeters
  const sx = typeof s === 'number' ? s : s.x
  const sy = typeof s === 'number' ? s : s.y
  const b = meta.sourceBoundsPx ?? {
    x0: 0,
    y0: 0,
    x1: meta.sourceWidth ?? meta.width,
    y1: meta.sourceHeight ?? meta.height,
  }
  const spanX = Math.max(0, b.x1 - b.x0)
  const spanY = Math.max(0, b.y1 - b.y0)
  const widthMeters = spanX * sx
  const heightMeters = spanY * sy
  const metersPerPixel = {
    x: widthMeters / Math.max(1, meta.width - 1),
    y: heightMeters / Math.max(1, meta.height - 1),
  }
  return { ...meta, sourceBoundsPx: b, widthMeters, heightMeters, metersPerPixel }
}

export type TerrainData = {
  meta: TerrainMeta
  heights: Uint16Array
}

export type HoverInfo = {
  elevation: number
  lat: number
  lon: number
}

/** Paleta de elevación basada en los rojos de la app, de sombra a cima iluminada. */
export const MARS_PALETTE = [
  '#5a1f14',
  '#7a2a1a',
  '#9c3720',
  '#b8442a',
  '#d2563a',
  '#e86d4a',
  '#f58b66',
]

const numberFormat = new Intl.NumberFormat('es-ES', {
  maximumFractionDigits: 0,
})

export function formatMeters(value: number): string {
  return `${numberFormat.format(Math.round(value)).replace('-', '−')} m`
}

export function formatCoord(value: number, positive: string, negative: string): string {
  const suffix = value >= 0 ? positive : negative
  return `${Math.abs(value).toFixed(3)}° ${suffix}`
}

export async function loadTerrain(terrainDir: string): Promise<TerrainData> {
  const baseUrl = `/terrain/${encodeURIComponent(terrainDir)}`
  const metaResponse = await fetch(`${baseUrl}/mars_height_meta.json`)
  if (!metaResponse.ok) {
    throw new Error(`No se pudo cargar el metadata (${metaResponse.status})`)
  }
  const rawMeta = (await metaResponse.json()) as TerrainMeta
  const meta = normalizeTerrainMeta(rawMeta)

  const heightResponse = await fetch(`${baseUrl}/mars_height.bin`)
  if (!heightResponse.ok) {
    throw new Error(`No se pudo cargar el heightmap (${heightResponse.status})`)
  }
  const buffer = await heightResponse.arrayBuffer()
  const heights = new Uint16Array(buffer)
  if (heights.length !== meta.width * meta.height) {
    throw new Error('El heightmap no coincide con las dimensiones del metadata')
  }
  return { meta, heights }
}
