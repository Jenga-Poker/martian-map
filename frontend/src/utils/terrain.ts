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
  sourcePixelSizeMeters: number
  sourceWidth: number
  sourceHeight: number
  validRatio: number
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number }
  center: { lat: number; lon: number }
  crs: string
  sourceFile: string
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
  '#090202',
  '#2a120b',
  '#3a1710',
  '#5c2416',
  '#8a3a22',
  '#b8572f',
  '#d56738',
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

export async function loadTerrain(): Promise<TerrainData> {
  const metaResponse = await fetch('/terrain/mars_height_meta.json')
  if (!metaResponse.ok) {
    throw new Error(`No se pudo cargar el metadata (${metaResponse.status})`)
  }
  const meta = (await metaResponse.json()) as TerrainMeta

  const heightResponse = await fetch('/terrain/mars_height.bin')
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
