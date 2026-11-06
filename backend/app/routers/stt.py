"""
Endpoints FastAPI pour VibeVoice ASR :
1. WebSocket bidirectionnel pour le streaming ultra-faible latence (< 200 ms)
2. HTTP POST pour les fichiers enregistrés ou le repli réseau
"""

import json
import logging
from fastapi import APIRouter, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from app.models.schemas import TranscriptionResult
from app.services.vibevoice_bitnet import vibevoice_engine

logger = logging.getLogger("relais.router.stt")
router = APIRouter(prefix="/api/v1/stt", tags=["Speech-To-Text"])


@router.websocket("/vibevoice-stream")
async def websocket_vibevoice_stream(
    websocket: WebSocket,
    session_id: str = "default_session",
    sample_rate: int = 16000,
):
    await websocket.accept()
    logger.info("Connexion WebSocket VibeVoice ouverte : session=%s, sr=%d", session_id, sample_rate)

    is_echo_guarded = False

    try:
        while True:
            message = await websocket.receive()

            if "bytes" in message and message["bytes"]:
                chunk = message["bytes"]
                res = await vibevoice_engine.process_stream_chunk(
                    session_id=session_id,
                    pcm_chunk=chunk,
                    sample_rate=sample_rate,
                    is_echo_guarded=is_echo_guarded,
                )
                if res and (res.text or res.segments):
                    await websocket.send_text(
                        json.dumps({"type": "transcription", **res.model_dump(by_alias=True)})
                    )

            elif "text" in message and message["text"]:
                try:
                    payload = json.loads(message["text"])
                    if payload.get("type") == "echo_guard":
                        is_echo_guarded = bool(payload.get("active", False))
                except json.JSONDecodeError:
                    pass

    except WebSocketDisconnect:
        logger.info("WebSocket VibeVoice déconnecté pour session %s", session_id)
    except Exception as exc:
        logger.error("Erreur inattendue WebSocket VibeVoice : %s", exc, exc_info=True)
    finally:
        vibevoice_engine.remove_session(session_id)


@router.post("/transcribe", response_model=TranscriptionResult)
async def transcribe_http(
    audio: UploadFile = File(...),
    session_id: str = Form("default_session"),
):
    file_bytes = await audio.read()
    result = await vibevoice_engine.transcribe_complete_wav(file_bytes, session_id=session_id)
    return result
