export type Rover = {
  id: string
  name: string
  /** Travel velocity in meters per second. */
  velocityMps: number
  /** Maximum climbable height difference per meter of horizontal travel (m/m). */
  maxHeightDiffPerMeter: number
  description: string
  photo: string
}

/**
 * Real Martian rovers with approximate traverse speed and slope capability.
 * velocityMps: typical autonomous traverse speed.
 * maxHeightDiffPerMeter: approximate maximum slope expressed as rise/run.
 */
export const ROVERS: Rover[] = [
  {
    id: 'sojourner',
    name: 'Sojourner',
    velocityMps: 0.01,
    maxHeightDiffPerMeter: 0.27, // ~15°
    description: 'Mars Pathfinder rover (1997)',
    photo: '/rovers/sojourner.jpg',
  },
  {
    id: 'spirit',
    name: 'Spirit',
    velocityMps: 0.05,
    maxHeightDiffPerMeter: 0.47, // ~25°
    description: 'MER-A rover (2004)',
    photo: '/rovers/spirit.jpg',
  },
  {
    id: 'opportunity',
    name: 'Opportunity',
    velocityMps: 0.05,
    maxHeightDiffPerMeter: 0.47, // ~25°
    description: 'MER-B rover (2004)',
    photo: '/rovers/opportunity.jpg',
  },
  {
    id: 'curiosity',
    name: 'Curiosity',
    velocityMps: 0.04,
    maxHeightDiffPerMeter: 0.58, // ~30°
    description: 'MSL rover (2012)',
    photo: '/rovers/curiosity.jpg',
  },
  {
    id: 'perseverance',
    name: 'Perseverance',
    velocityMps: 0.042,
    maxHeightDiffPerMeter: 0.58, // ~30°
    description: 'Mars 2020 rover (2021)',
    photo: '/rovers/perseverance.jpg',
  },
]

export const DEFAULT_ROVER_ID: string | null = "perseverance"

export function getRover(id?: string | null): Rover | null {
  if (id == null) return null
  return ROVERS.find((r) => r.id === id) ?? null
}
