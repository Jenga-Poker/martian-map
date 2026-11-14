# Cráter Jezero en 3D

Visor web del modelo digital de elevación (DEM) marciano de `jezero_dem_1m.tif`
(17 783 × 17 784 px, 1 m/píxel, cráter Jezero, Marte). El terreno se procesa a
un heightmap de 1024 × 1024 y se renderiza en 3D con Three.js, con paleta de
tonos óxido de Marte, iluminación, exageración vertical y lectura de altura al
pasar el cursor.

## Puesta en marcha

```bash
cd frontend
npm install
npm run dev
```

Abre el enlace que muestra Vite (por defecto <http://localhost:5173>).

## Regenerar el heightmap

Si cambias el GeoTIFF de origen:

```bash
pip install -r backend/requirements.txt
python backend/process_dem.py
```

El script lee `jezero_dem_1m.tif`, lo reduce a 1024 × 1024 con media por
bloques y escribe en `frontend/public/terrain/`:

- `mars_height.bin`: alturas cuantizadas a `uint16` (65535 = sin datos).
- `mars_height_meta.json`: rango de elevación, escala, límites geográficos y
  metadatos del DEM.

## Controles

- Arrastrar: orbitar. Rueda: zoom. Clic derecho: desplazar.
- Exageración vertical de 1× a 8×.
- Cámara en perspectiva o cenital.
- Rotación automática, malla de alambre y lectura de elevación/coordenadas.
