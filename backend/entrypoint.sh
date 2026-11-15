#!/bin/sh
set -e

mkdir -p data

pip install requests
python scripts/download-map.py
# Run the download script only if there are no .npz files in data/
if [ -z "$(find data -maxdepth 1 -name '*.npz' -print -quit)" ]; then
    echo "No .npz files found in data/, running scripts/download-map.py..."
fi

# Hand over to the main command (uvicorn)
exec "$@"