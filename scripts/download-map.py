print("Running from python")

import os
import requests

download = [
  ("https://github.com/Jenga-Poker/martian-map-data/releases/download/v1.0/jezero_dem_1m.tif", "data/jezero_dem_1m.tif"),
  ("https://github.com/Jenga-Poker/martian-map-data/releases/download/v2.0/gale_dem_1m.tif", "data/gale_dem_1m.tif"),
  ("https://github.com/Jenga-Poker/martian-map-data/releases/download/v4.0/valles_marineris_dem_200m.tif", "data/valles_marineris_dem_200m.tif"),
  ("https://github.com/Jenga-Poker/martian-map-data/releases/download/v5.0/jezero_dem_1m.npz", "data/jezero_dem_1m.npz"),
  ("https://github.com/Jenga-Poker/martian-map-data/releases/download/v6.0/valles_marineris_dem_200m.npz", "data/valles_marineris_dem_200m.npz"),
  ("https://github.com/Jenga-Poker/martian-map-data/releases/download/v6.0/gale_dem_1m.npz", "data/gale_dem_1m.npz"),
  ("https://github.com/Jenga-Poker/martian-map-data/releases/download/v7.0/rocky_gale_themis_night.tif", "data/rocky_gale_themis_night.tif"),
  ("https://github.com/Jenga-Poker/martian-map-data/releases/download/v7.0/rocky_jezero_themis_night.tif", "data/rocky_jezero_themis_night.tif"),
  ("https://github.com/Jenga-Poker/martian-map-data/releases/download/v7.0/rocky_valles_marineris_themis_night.tif", "data/rocky_valles_marineris_themis_night.tif"),
]

os.makedirs("data", exist_ok=True)

for url, archivo_destino in download:
  if os.path.exists(archivo_destino):
    print(f"{archivo_destino} ya existe, se omite")
    continue

  print(f"Iniciando descarga de {archivo_destino}...")
  archivo_temporal = archivo_destino + ".part"
  try:
    with requests.get(url, stream=True) as respuesta:
      respuesta.raise_for_status()
      with open(archivo_temporal, "wb") as f:
        # Descarga en bloques de 8 MB para no llenar la memoria RAM
        for chunk in respuesta.iter_content(chunk_size=8 * 1024 * 1024):
          if chunk:
            f.write(chunk)
    # Solo se renombra cuando la descarga terminó completa
    os.replace(archivo_temporal, archivo_destino)
  except BaseException:
    if os.path.exists(archivo_temporal):
      os.remove(archivo_temporal)
    raise

  print(f"Descarga completada de {archivo_destino}")