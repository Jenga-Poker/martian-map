export type Poi = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  description: string;
  /** Folder inside public/terrain/ that contains the POI model. */
  terrainDir: string;
  /** Name shown above the terrain viewer. */
  terrainLabel: string;
};

export const POIS: Poi[] = [
  {
    id: "jezero",
    name: "Jezero Crater",
    lat: 18.38,
    lon: 77.58,
    description:
      "Landing site of NASA's Perseverance rover. An ancient river delta preserving clues to past microbial life.",
    terrainDir: "crater_jezero",
    terrainLabel: "Mars · Jezero Crater",
  },
  {
    id: "gale",
    name: "Gale Crater",
    lat: -5.4,
    lon: 137.8,
    description:
      "Explored by the Curiosity rover. Home to Mount Sharp, a layered mountain recording Mars' climate history.",
    terrainDir: "crater_gale",
    terrainLabel: "Mars · Gale Crater",
  },
  {
    id: "valles",
    name: "Valles Marineris",
    lat: -13.9,
    lon: -59.2,
    description:
      "One of the largest canyon systems in the solar system, stretching over 4,000 km across the Martian equator.",
    terrainDir: "valles_marineris",
    terrainLabel: "Mars · Valles Marineris",
  },
];

export const DEFAULT_POI_ID = POIS[0].id;

export function getPoi(id?: string | null): Poi {
  return POIS.find((poi) => poi.id === id) ?? POIS[0];
}
