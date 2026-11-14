import requests

url = "https://github.com/Jenga-Poker/martian-map-data/releases/download/v1.0/jezero_dem_1m.tif"
archivo_destino = "data/jezero_dem_1m.tif"

print("Iniciando descarga...")
with requests.get(url, stream=True) as respuesta:
  respuesta.raise_for_status()
  with open(archivo_destino, "wb") as f:
    # Descarga en bloques de 8 MB para no llenar la memoria RAM
    for chunk in respuesta.iter_content(chunk_size=8 * 1024 * 1024):
      if chunk:
        f.write(chunk)

print("Descarga completada")
