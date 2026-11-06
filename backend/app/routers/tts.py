"""
Routeur FastAPI pour la synthèse vocale et le clonage de voix (/api/v1/tts).
"""

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field
from app.services.voice_cloner import voice_cloner

router = APIRouter(prefix="/api/v1/tts", tags=["Text-To-Speech & Voice Cloning"])


class CloneTTSRequest(BaseModel):
    text: str = Field(..., description="Texte à prononcer avec la voix clonée")
    lang: str = Field(default="en", description="Langue cible (en ou fr)")
    profile_id: str = Field(default="clone_vital", description="ID de l'empreinte vocale")
    pitch: float = Field(default=1.0, ge=0.5, le=2.0)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


@router.post("/clone")
async def synthesize_cloned_voice(req: CloneTTSRequest):
    """
    Génère un flux audio WAV synthétisé avec le timbre de la voix clonée spécifiée.
    """
    wav_bytes = voice_cloner.synthesize_with_timbre(
        text=req.text,
        lang=req.lang,
        pitch=req.pitch,
        speed=req.speed,
    )
    return Response(content=wav_bytes, media_type="audio/wav")
