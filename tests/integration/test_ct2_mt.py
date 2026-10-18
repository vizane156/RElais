import builtins
import sys
import types
import time
from unittest.mock import patch
import pytest
from relais.engines.base import EngineUnavailable
from relais.engines.ct2_mt import Ct2Translator
from relais.paths import Paths
from .conftest import skip_mt

@pytest.mark.integration
@skip_mt
def test_constructs(): Ct2Translator(Paths().models, [("en", "fr")])
@pytest.mark.integration
@skip_mt
def test_english_to_french():
    out=Ct2Translator(Paths().models, [("en", "fr")]).translate_batch(["Hello, how are you?"],"en","fr")[0]; assert out and out!="Hello, how are you?"
@pytest.mark.integration
@skip_mt
def test_french_to_english(): assert Ct2Translator(Paths().models,[("fr","en")]).translate_batch(["Bonjour, comment allez-vous?"],"fr","en")[0]
@pytest.mark.integration
@skip_mt
def test_batch(): assert len(Ct2Translator(Paths().models,[("en","fr")]).translate_batch(["Hello.","Good morning.","Thank you."],"en","fr"))==3
@pytest.mark.integration
@skip_mt
def test_warm_translation_is_fast():
    engine=Ct2Translator(Paths().models,[("en","fr")]); start=time.monotonic(); assert engine.translate_batch(["A real sentence."],"en","fr")[0]; assert time.monotonic()-start<10

def test_missing_model(tmp_path):
    with patch.dict(sys.modules,{"ctranslate2":types.ModuleType("ctranslate2"),"sentencepiece":types.ModuleType("sentencepiece")}),pytest.raises(EngineUnavailable) as e: Ct2Translator(tmp_path,[("en","fr")])
    assert e.value.key.startswith("err.model")
def test_missing_library(tmp_path):
    original=builtins.__import__
    def importer(name,*a,**kw):
        if name=="ctranslate2": raise ImportError("mock absent")
        return original(name,*a,**kw)
    with patch("builtins.__import__",side_effect=importer),pytest.raises(EngineUnavailable) as e: Ct2Translator(tmp_path,[("en","fr")])
    assert e.value.key=="err.dep"
