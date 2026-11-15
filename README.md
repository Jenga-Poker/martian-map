# Installation

## Linux

```
sudo systemctl edit ollama.service
```

Add:
```
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
```

Run:
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

Put this in your .env in the backend:

```
OLLAMA_URL=http://host.docker.internal:11434
```
