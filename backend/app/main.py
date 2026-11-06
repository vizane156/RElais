"""Point d'entrée principal FastAPI de l'application Relais Backend."""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.models.schemas import HealthResponse
from app.routers import stt, tts
from app.services.vibevoice_bitnet import vibevoice_engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    await vibevoice_engine.load_model()
    yield
    pass


app = FastAPI(
    title="Relais Voice & Meeting Engine",
    version="2.0.0",
    description="Backend temps réel ASR VibeVoice BitNet, Diarisation et Traduction bilingue",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stt.router)
app.include_router(tts.router)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(
        status="healthy",
        model="VibeVoice-ASR-BitNet-b1.58",
        quantization="1.58-bit ternary weight / int8 activation",
        active_sessions=len(vibevoice_engine._sessions),
    )
