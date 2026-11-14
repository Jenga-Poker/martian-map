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


