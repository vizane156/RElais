import builtins
import sys
import types
from unittest.mock import patch
import pytest
from relais.engines.base import EngineUnavailable
from relais.engines.factory import load_manifest
from relais.engines.kokoro_tts import KokoroSynthesizer
from relais.paths import Paths
from .conftest import skip_kokoro

# URLs are pinned in models.json; upstream release/tag changes can invalidate these:
# https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
# https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

def make(): return KokoroSynthesizer(Paths().models,load_manifest())
@pytest.mark.integration
@skip_kokoro
def test_constructs(): make()
@pytest.mark.integration
@skip_kokoro
def test_english_voices(): assert make().voices("en")
@pytest.mark.integration
@skip_kokoro
def test_french_voices(): assert make().voices("fr")
@pytest.mark.integration
@skip_kokoro
def test_english_synth():
    e=make(); pcm,sr=e.synth("Hello, world.","en",e.voices("en")[0].id,1); assert pcm and sr>0
@pytest.mark.integration
@skip_kokoro
def test_french_synth():
    e=make(); assert e.synth("Bonjour le monde.","fr",e.voices("fr")[0].id,1)[0]
@pytest.mark.integration
@skip_kokoro
def test_unknown_voice():
    e=make(); assert e.synth("Hello.","en","unknown",1)[0]
def test_missing_model(tmp_path):
    fake=types.ModuleType("kokoro_onnx"); fake.Kokoro=object
    with patch.dict(sys.modules,{"numpy":types.ModuleType("numpy"),"kokoro_onnx":fake}),pytest.raises(EngineUnavailable) as e: KokoroSynthesizer(tmp_path,load_manifest())
    assert e.value.key.startswith("err.model")
def test_missing_library(tmp_path):
    orig=builtins.__import__
    def imp(name,*a,**kw):
        if name=="kokoro_onnx": raise ImportError()
        return orig(name,*a,**kw)
    with patch("builtins.__import__",side_effect=imp),pytest.raises(EngineUnavailable) as e: KokoroSynthesizer(tmp_path,load_manifest())
    assert e.value.key=="err.dep"
