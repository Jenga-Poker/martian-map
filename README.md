# Instalación

## Linux

```
sudo systemctl edit ollama.service
```

Añades: 
```
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
```

Ejecutas:
```
sudo systemctl daemon-reload
sudo systemctl restart ollama
```
```
```
```
```
```
```

Ponle esto a tu .env en backend:

```
OLLAMA_URL=http://host.docker.internal:11434
```
