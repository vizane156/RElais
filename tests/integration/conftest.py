import math
import struct
from pathlib import Path

import pytest

from relais.paths import Paths


def model_present(*parts):
    return (Paths().models.joinpath(*parts)).exists()


def _has_stt():
    root = Paths().models / "stt"
    return root.is_dir() and any((p / "model.bin").exists() for p in root.iterdir() if p.is_dir())


def _has_piper():
    root = Paths().models / "tts" / "piper"
    return root.is_dir() and any(root.glob("*.onnx"))

skip_mt = pytest.mark.skipif(not model_present("mt", "opus-mt-en-fr-int8", "model.bin"), reason="MT model absent")
skip_stt = pytest.mark.skipif(not _has_stt(), reason="Whisper model absent")
skip_piper = pytest.mark.skipif(not _has_piper(), reason="Piper voice absent")
skip_kokoro = pytest.mark.skipif(not model_present("tts", "kokoro", "kokoro-v1.0.onnx"), reason="Kokoro model absent")


def _tone(seconds, hz=440, sr=16000):
    return b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * hz * i / sr))) for i in range(int(seconds * sr)))


@pytest.fixture
def pcm_tone():
    return _tone(2)


@pytest.fixture
def pcm_silence():
    return bytes(16000 * 2)
