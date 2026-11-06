# Relais Backend - Moteur VibeVoice ASR BitNet (1.58-bit)

Serveur de reconnaissance vocale continue (STT) et de diarisation temps réel optimisé pour tourner sur CPU faible consommation sans GPU.

## Lancement rapide

```bash
cd backend
docker compose up --build -d
```

Le serveur sera accessible sur `http://localhost:8000` :
- Vérification santé : `GET http://localhost:8000/health`
- WebSocket de streaming : `ws://localhost:8000/api/v1/stt/vibevoice-stream`
- Fallback HTTP : `POST http://localhost:8000/api/v1/stt/transcribe`
