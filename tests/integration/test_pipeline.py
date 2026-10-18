import time
import pytest
from relais.engines.ct2_mt import Ct2Translator
from relais.engines.whisper_stt import WhisperRecognizer
from relais.engines.piper_tts import PiperSynthesizer
from relais.engines.factory import load_manifest
from relais.paths import Paths
from .conftest import skip_mt, skip_stt, skip_piper

@pytest.mark.integration
@skip_mt
@skip_stt
@skip_piper
def test_real_pipeline(pcm_tone):
    paths=Paths(); t=time.monotonic(); stt=WhisperRecognizer(paths.models,"base",("en","fr")); text=stt.transcribe(pcm_tone,"en",True).text; stt_ms=(time.monotonic()-t)*1000
    assert text
    t=time.monotonic(); mt=Ct2Translator(paths.models,[("en","fr")]); translated=mt.translate_batch([text],"en","fr")[0]; mt_ms=(time.monotonic()-t)*1000
    assert translated and translated != text
    t=time.monotonic(); tts=PiperSynthesizer(paths.models,load_manifest()); audio=tts.synth(translated,"fr",tts.voices("fr")[0].id,1)[0]; tts_ms=(time.monotonic()-t)*1000
    assert audio
    print(f"STT {stt_ms:.0f}ms; MT {mt_ms:.0f}ms; TTS {tts_ms:.0f}ms")

@pytest.mark.integration
@skip_mt
def test_known_english(): assert Ct2Translator(Paths().models,[("en","fr")]).translate_batch(["The weather is nice today."],"en","fr")[0] != "The weather is nice today."
@pytest.mark.integration
@skip_mt
def test_known_french(): assert Ct2Translator(Paths().models,[("fr","en")]).translate_batch(["Il fait beau aujourd'hui."],"fr","en")[0]
