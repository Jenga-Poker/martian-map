print("Running from python")

import requests

download = [
  ("https://github.com/Jenga-Poker/martian-map-data/releases/download/v1.0/jezero_dem_1m.tif", "data/jezero_dem_1m.tif"),
  ("https://github.com/Jenga-Poker/martian-map-data/releases/download/v2.0/gale_dem_1m.tif", "data/gale_dem_1m.tif"),
  ("https://github.com/Jenga-Poker/martian-map-data/releases/download/v4.0/valles_marineris_dem_200m.tif", "data/valles_marineris_dem_200m.tif"),
  ("https://github.com/Jenga-Poker/martian-map-data/releases/download/v5.0/jezero_dem_1m.npz", "data/jezero_dem_1m.npz"),
  ("https://github.com/Jenga-Poker/martian-map-data/releases/download/v6.0/valles_marineris_dem_200m.npz", "data/valles_marineris_dem_200m.npz"),
  ("https://github.com/Jenga-Poker/martian-map-data/releases/download/v6.0/gale_dem_1m.npz", "data/gale_dem_1m.npz"),
]

for url, archivo_destino in download:
  print(f"Iniciando descarga de {archivo_destino}...")
  with requests.get(url, stream=True) as respuesta:
    respuesta.raise_for_status()
    with open(archivo_destino, "wb") as f:
      # Descarga en bloques de 8 MB para no llenar la memoria RAM
      for chunk in respuesta.iter_content(chunk_size=8 * 1024 * 1024):
        if chunk:
          f.write(chunk)

  print(f"Descarga completada de {archivo_destino}")
