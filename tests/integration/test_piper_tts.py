import builtins
import sys
import types
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import pytest
from relais.engines.base import EngineUnavailable
from relais.engines.piper_tts import PiperSynthesizer
from relais.engines.factory import load_manifest
from relais.paths import Paths
from .conftest import skip_piper

def make(): return PiperSynthesizer(Paths().models, load_manifest())
@pytest.mark.integration
@skip_piper
def test_constructs(): make()
@pytest.mark.integration
@skip_piper
def test_english_voices():
    assert all(all(hasattr(v, k) for k in ("id", "lang", "label")) for v in make().voices("en")) and make().voices("en")
@pytest.mark.integration
@skip_piper
def test_english_synth():
    e=make(); pcm,sr=e.synth("Hello, world.","en",e.voices("en")[0].id,1.0); assert pcm and sr>0
@pytest.mark.integration
@skip_piper
def test_french_synth():
    e=make(); assert e.synth("Bonjour le monde.","fr",e.voices("fr")[0].id,1.0)[0]
@pytest.mark.integration
@skip_piper
def test_rate_duration():
    e=make(); v=e.voices("en")[0].id; fast=e.synth("This is a moderately long test sentence.","en",v,1)[0]; slow=e.synth("This is a moderately long test sentence.","en",v,.5)[0]; assert len(slow) >= len(fast)*1.5
@pytest.mark.integration
@skip_piper
def test_unknown_voice_fallback():
    e=make(); assert e.synth("Hello.","en","unknown",1)[0]
@pytest.mark.integration
@skip_piper
def test_concurrent():
    e=make(); v=e.voices("en")[0].id
    with ThreadPoolExecutor(2) as pool: assert all(pool.map(bool,[pool.submit(e.synth,"Hello.","en",v,1).result()[0], pool.submit(e.synth,"World.","en",v,1).result()[0]]))
def test_missing_model(tmp_path):
    fake=types.ModuleType("piper"); fake.PiperVoice=object
    with patch.dict(sys.modules,{"piper":fake}),pytest.raises(EngineUnavailable) as e: PiperSynthesizer(tmp_path,load_manifest())
    assert e.value.key.startswith("err.model")
def test_missing_library(tmp_path):
    orig=builtins.__import__
    def imp(name,*a,**kw):
        if name=="piper": raise ImportError()
        return orig(name,*a,**kw)
    with patch("builtins.__import__",side_effect=imp),pytest.raises(EngineUnavailable) as e: PiperSynthesizer(tmp_path,load_manifest())
    assert e.value.key=="err.dep"
