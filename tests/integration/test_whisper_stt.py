import builtins
import sys
import types
from unittest.mock import patch

import pytest
from relais.engines.base import EngineUnavailable, RecResult
from relais.engines.whisper_stt import WhisperRecognizer
from relais.paths import Paths
from .conftest import skip_stt


def make(): return WhisperRecognizer(Paths().models, "base", ("en", "fr"))

@pytest.mark.integration
@skip_stt
def test_constructs(): make()
@pytest.mark.integration
@skip_stt
def test_transcribes(pcm_tone): assert make().transcribe(pcm_tone, "en", True).text
@pytest.mark.integration
@skip_stt
def test_silence(pcm_silence): assert not make().transcribe(pcm_silence, None, True).text
@pytest.mark.integration
@skip_stt
def test_detect(pcm_tone):
    lang, prob = make().detect(pcm_tone)
    assert isinstance(lang, str) and 0 <= prob <= 1
@pytest.mark.integration
@skip_stt
def test_short_audio(): make().transcribe(bytes(3200), "en", True)
@pytest.mark.integration
@skip_stt
def test_interim(pcm_tone): assert isinstance(make().transcribe(pcm_tone, "en", False), RecResult)

def test_missing_model(tmp_path):
    fw=types.ModuleType("faster_whisper"); fw.WhisperModel=object
    with patch.dict(sys.modules,{"numpy":types.ModuleType("numpy"),"faster_whisper":fw}), pytest.raises(EngineUnavailable) as e: WhisperRecognizer(tmp_path, "base", ("en", "fr"))
    assert e.value.key.startswith("err.model")

def test_missing_library(tmp_path):
    original = builtins.__import__
    def importer(name, *a, **kw):
        if name == "faster_whisper": raise ImportError("mock absent")
        return original(name, *a, **kw)
    with patch("builtins.__import__", side_effect=importer), pytest.raises(EngineUnavailable) as e:
        WhisperRecognizer(tmp_path, "base", ("en", "fr"))
    assert e.value.key == "err.dep"
