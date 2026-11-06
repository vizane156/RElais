"""Schémas de validation Pydantic v2 pour l'API Relais STT."""

from typing import List, Optional
from pydantic import BaseModel, Field


class SpeakerDiarizationSegment(BaseModel):
    speaker_id: str = Field(..., alias="speakerId", description="ID unique du locuteur (ex: spk-1)")
    speaker_name: str = Field(..., alias="speakerName", description="Nom lisible ou alias du locuteur")
    text: str = Field(..., description="Texte transcrit pour ce segment")
    start_ms: int = Field(..., alias="startMs", description="Début du segment en millisecondes")
    end_ms: int = Field(..., alias="endMs", description="Fin du segment en millisecondes")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="Score de confiance du modèle")
    is_final: bool = Field(default=False, alias="isFinal", description="True si le segment est figé")

    class Config:
        populate_by_name = True


class TranscriptionResult(BaseModel):
    session_id: str = Field(..., alias="sessionId")
    segments: List[SpeakerDiarizationSegment] = Field(default_factory=list)
    text: str = Field(default="")
    is_final: bool = Field(default=False, alias="isFinal")
    timestamp: int = Field(...)

    class Config:
        populate_by_name = True


class HealthResponse(BaseModel):
    status: str
    model: str
    quantization: str
    active_sessions: int
