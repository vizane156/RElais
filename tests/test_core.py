import json
import tempfile
import unittest
from pathlib import Path

from relais.core.audio import wav_bytes, wav_info
from relais.core.glossary import Glossary, Rule
from relais.core.settings import ProfileStore, Schema, SettingsStore
from relais.core.store import GlossaryStore, HistoryStore, RecordingStore
from relais.core.text import NL, is_hallucination, rejoin, segment, split_for_speech
from relais.core.translate import TranslationService
from relais.engines.mock import MockTranslator


class TextTests(unittest.TestCase):
    def test_roundtrip(self):
        for t in ["Hello there. This is a test.\n\nSecond paragraph here.", "One sentence", "A! B? C… D.",
                  "", "line1\nline2", "Il a dit : « ok ».\nFin."]:
            self.assertEqual(rejoin(segment(t)), t)

    def test_long_text_is_cut(self):
        segs = segment("mot " * 400)
        self.assertTrue(all(len(s) <= 320 for s in segs if s != NL))

    def test_split_for_speech_first_chunk_is_short(self):
        text = ("This is a rather long opening clause that keeps going, and going, and going for a while, "
                "until we finally reach the end of the sentence.")
        chunks = split_for_speech(text)
        self.assertGreater(len(chunks), 1)
        self.assertLessEqual(len(chunks[0]), 90)
        self.assertEqual(" ".join(chunks).replace("  ", " "), text)

    def test_split_sentences(self):
        self.assertEqual(split_for_speech("Hello. How are you?"), ["Hello.", "How are you?"])
        self.assertEqual(split_for_speech("   "), [])

    def test_hallucinations(self):
        self.assertTrue(is_hallucination("Thanks for watching!"))
        self.assertTrue(is_hallucination("Sous-titres réalisés par la communauté d'Amara.org"))
        self.assertTrue(is_hallucination("..."))
        self.assertFalse(is_hallucination("Thank you very much for your help."))


class GlossaryTests(unittest.TestCase):
    def test_protect_restore(self):
        g = Glossary([Rule("en", "pull request", "demande de fusion", "replace"), Rule("en", "Relais", "", "keep")])
        p, slots = g.protect("Open the pull request in relais now", "en", "fr")
        self.assertNotIn("pull request", p)
        self.assertNotIn("relais", p.lower())
        out = g.restore(p.replace("Open the", "Ouvrez la"), slots)
        self.assertEqual(out, "Ouvrez la demande de fusion in relais now")

    def test_lost_token_returns_none(self):
        g = Glossary([Rule("en", "Relais", "", "keep")])
        _, slots = g.protect("Relais is here", "en", "fr")
        self.assertIsNone(g.restore("Ici", slots))

    def test_damaged_token_tolerated(self):
        g = Glossary([Rule("en", "Relais", "", "keep")])
        _, slots = g.protect("Relais is here", "en", "fr")
        self.assertEqual(g.restore("gls 0 est ici", slots), "Relais est ici")

    def test_longest_term_first_and_word_boundaries(self):
        g = Glossary([Rule("en", "pull", "tirer", "replace"), Rule("en", "pull request", "PR", "replace")])
        p, slots = g.protect("a pull request and a pullover", "en", "fr")
        self.assertEqual([s[1] for s in slots], ["PR"])
        self.assertIn("pullover", p)

    def test_wrong_language_ignored(self):
        g = Glossary([Rule("fr", "bonjour", "hello", "replace")])
        self.assertEqual(g.protect("bonjour", "en", "fr")[1], [])


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.schema = Schema.load()
        self.path = Path(self.tmp.name) / "settings.json"
        self.store = SettingsStore(self.path, self.schema)

    def tearDown(self):
        self.tmp.cleanup()

    def test_defaults_and_clamp(self):
        self.assertEqual(self.store.get("ui.lang"), "fr")
        ch, rej = self.store.patch({"speak.rate": 99, "listen.silence_ms": 10})
        self.assertEqual(ch["speak.rate"], 1.6)
        self.assertEqual(ch["listen.silence_ms"], 250)
        self.assertEqual(rej, [])

    def test_rejects_invalid(self):
        _, rej = self.store.patch({"ui.lang": "xx", "ui.color_a": "red", "nope": 1, "listen.partials": "yes",
                                   "speak.rate": float("nan")})
        self.assertEqual(sorted(rej), ["listen.partials", "nope", "speak.rate", "ui.color_a", "ui.lang"])
        self.assertEqual(self.store.get("ui.lang"), "fr")

    def test_nested_patch_and_persistence(self):
        self.store.patch({"ui": {"lang": "en"}, "speak": {"volume": 0.5}})
        again = SettingsStore(self.path, self.schema)
        self.assertEqual(again.get("ui.lang"), "en")
        self.assertEqual(again.get("speak.volume"), 0.5)

    def test_int_select_and_step_rounding(self):
        ch, _ = self.store.patch({"perf.threads": "4", "type.min_words": 3.4})
        self.assertEqual(ch["perf.threads"], 4)
        self.assertEqual(self.store.get("type.min_words"), 3)

    def test_caps_list_filtered(self):
        self.store.patch({"caps.on": ["listen", "listen", "bogus", "speak"]})
        self.assertEqual(self.store.get("caps.on"), ["listen", "speak"])

    def test_corrupt_file_falls_back_to_defaults(self):
        self.path.write_text("{ not json", encoding="utf-8")
        self.assertEqual(SettingsStore(self.path, self.schema).get("ui.lang"), "fr")

    def test_schema_is_consistent(self):
        for key, f in self.schema.fields.items():
            ok, val = self.schema.coerce(key, f["default"])
            self.assertTrue(ok, key)
            self.assertEqual(val, f["default"] if f["type"] != "color" else f["default"].upper(), key)

    def test_profiles(self):
        ps = ProfileStore(Path(self.tmp.name) / "profiles", self.schema)
        self.store.patch({"ui.theme": "dark", "listen.device": "abc", "caps.on": ["speak"]})
        ps.save("Réunion", self.store.snapshot())
        self.assertEqual(ps.list(), ["Réunion"])
        loaded = ps.load("Réunion")
        self.assertEqual(loaded["ui.theme"], "dark")
        self.assertNotIn("listen.device", loaded)  # propre à la machine : pas dans un profil
        self.assertNotIn("caps.on", loaded)
        self.assertFalse(ps.valid_name("a/b"))
        self.assertFalse(ps.valid_name("../x"))
        self.assertTrue(ps.delete("Réunion"))


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_recordings(self):
        rs = RecordingStore(self.root / "rec")
        wav = wav_bytes(b"\x01\x00" * 16000, 16000)
        meta = rs.add_wav(wav, name="Ma voix", kind="voice", lang="fr")
        self.assertEqual(meta["duration"], 1.0)
        self.assertEqual(rs.list()[0]["name"], "Ma voix")
        self.assertTrue(rs.path(meta["id"]).is_file())
        self.assertEqual(rs.update(meta["id"], {"name": "Renommée"})["name"], "Renommée")
        self.assertTrue(rs.delete(meta["id"]))
        self.assertEqual(rs.list(), [])

    def test_recordings_reject_bad_input(self):
        rs = RecordingStore(self.root / "rec")
        with self.assertRaises(ValueError):
            rs.add_wav(b"not a wav")
        self.assertIsNone(rs.path("../../etc/passwd"))
        self.assertIsNone(rs.path("..%2f..%2fx"))
        self.assertFalse(rs.delete("../x"))
        with self.assertRaises(ValueError):
            wav_info(wav_bytes(b"", 16000))

    def test_history(self):
        h = HistoryStore(self.root / "h.jsonl")
        h.append({"ts": 1, "lang": "en", "text": "Hello", "to": "fr", "translation": "Bonjour"})
        h.append({"ts": 2, "lang": "fr", "text": "Merci"})
        self.assertEqual(len(h.tail(10)), 2)
        txt = h.export_txt({"en": "English", "fr": "Français"})
        self.assertIn("English : Hello", txt)
        self.assertIn("Français : Bonjour", txt)
        h.clear()
        self.assertEqual(h.tail(10), [])

    def test_glossary_store_validates(self):
        gs = GlossaryStore(self.root / "g.json")
        rules = gs.set([{"src": "en", "term": "build", "mode": "keep"},
                        {"src": "xx", "term": "bad"}, {"src": "en", "term": ""},
                        {"src": "fr", "term": "courriel", "target": "email", "mode": "replace"},
                        {"src": "en", "term": "x", "mode": "replace", "target": ""}, "junk"])
        self.assertEqual(len(rules), 3)
        self.assertEqual(rules[2]["mode"], "keep")  # remplacement sans cible : devient « garder »
        self.assertEqual(len(GlossaryStore(self.root / "g.json").get()), 3)


class CountingTranslator(MockTranslator):
    def __init__(self):
        self.calls = []

    def translate_batch(self, texts, src, tgt, beam=1):
        self.calls.append(list(texts))
        return super().translate_batch(texts, src, tgt, beam)


class TranslateServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.schema = Schema.load()
        self.settings = SettingsStore(Path(self.tmp.name) / "s.json", self.schema)
        self.gloss = GlossaryStore(Path(self.tmp.name) / "g.json")
        self.eng = CountingTranslator()
        self.svc = TranslationService(self.eng, self.gloss, self.settings)

    def tearDown(self):
        self.tmp.cleanup()

    def test_cache_hits_on_repeat(self):
        a = self.svc.translate("Hello. Thank you.", "en", "fr")
        n = sum(len(c) for c in self.eng.calls)
        b = self.svc.translate("Hello. Thank you.", "en", "fr")
        self.assertEqual(a, b)
        self.assertEqual(sum(len(c) for c in self.eng.calls), n)
        self.assertGreaterEqual(self.svc.hits, 2)

    def test_newlines_and_empty(self):
        out = self.svc.translate("Hello.\nThank you.", "en", "fr")
        self.assertEqual(out.count("\n"), 1)
        self.assertEqual(self.svc.translate("   ", "en", "fr"), "   ")
        self.assertEqual(self.svc.translate("same", "en", "en"), "same")

    def test_glossary_applied_and_fallback(self):
        self.gloss.set([{"src": "en", "term": "meeting", "target": "rendez-vous", "mode": "replace"}])
        self.assertIn("rendez-vous", self.svc.translate("The meeting starts at nine.", "en", "fr"))
        # le moteur « perd » le jeton : le service doit retraduire sans protection
        class Lossy(MockTranslator):
            def translate_batch(self, texts, src, tgt, beam=1):
                return ["Rien ici"] * len(texts) if any("GLS" in t for t in texts) else super().translate_batch(texts, src, tgt, beam)
        svc = TranslationService(Lossy(), self.gloss, self.settings)
        self.assertNotIn("GLS", svc.translate("The meeting starts at nine.", "en", "fr"))

    def test_glossary_can_be_disabled(self):
        self.gloss.set([{"src": "en", "term": "meeting", "target": "rendez-vous", "mode": "replace"}])
        self.settings.patch({"translate.glossary": False})
        self.assertNotIn("rendez-vous", self.svc.translate("The meeting starts.", "en", "fr"))


class I18nTests(unittest.TestCase):
    """Chaque libellé du schéma existe dans les DEUX langues de l'interface."""

    def test_keys_exist_in_both_languages(self):
        web = Path(__file__).resolve().parent.parent / "relais" / "web" / "i18n"
        fr = json.loads((web / "fr.json").read_text(encoding="utf-8"))
        en = json.loads((web / "en.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted(set(fr) ^ set(en)), [], "clés différentes entre fr.json et en.json")
        schema = Schema.load().raw
        needed = set()
        for sec in schema["sections"]:
            needed.add(sec["label"])
            for f in sec["fields"]:
                for k in ("label", "hint"):
                    if f.get(k):
                        needed.add(f[k])
                for o in f.get("options", []):
                    if o.get("label_key"):
                        needed.add(o["label_key"])
        missing = sorted(k for k in needed if k not in fr)
        self.assertEqual(missing, [], "clés manquantes dans fr.json")


if __name__ == "__main__":
    unittest.main()
