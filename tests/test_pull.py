from pathlib import Path
from unittest.mock import patch
import pytest
from relais import pull as pullmod
from relais.paths import Paths

class Response:
    headers={"Content-Length":"4"}
    def __init__(self,data=b"data"): self.data=data
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def read(self,n): data,self.data=self.data,b""; return data

def test_download_connection_cleans_part(tmp_path):
    with patch("urllib.request.urlopen",side_effect=ConnectionError("offline")), pytest.raises(ConnectionError): pullmod._download("https://invalid",tmp_path/"x","x")
    assert not list(tmp_path.glob("*.part"))
def test_download_http_error(tmp_path):
    with patch("urllib.request.urlopen",side_effect=__import__("urllib.error",fromlist=["HTTPError"]).HTTPError("url",404,"no",{},None)), pytest.raises(Exception): pullmod._download("https://invalid",tmp_path/"x","x")
def test_download_bytes(tmp_path):
    with patch("urllib.request.urlopen",return_value=Response(b"data")): pullmod._download("https://invalid",tmp_path/"x","x")
    assert (tmp_path/"x").read_bytes()==b"data"
def test_pull_mt_missing_converter():
    with patch("relais.pull.shutil.which",return_value=None),patch("relais.pull.subprocess.run",side_effect=FileNotFoundError("no converter")),pytest.raises(RuntimeError,match="converter unavailable"):
        pullmod._pull_mt(Paths(Path("/tmp/not-installed")),pullmod.load_manifest())
def test_pull_stt_missing_dependency(tmp_path):
    import builtins
    orig=builtins.__import__
    def imp(name,*a,**kw):
        if name=="faster_whisper.utils": raise ImportError()
        return orig(name,*a,**kw)
    with patch("builtins.__import__",side_effect=imp): assert not pullmod._pull_stt(Paths(tmp_path),pullmod.load_manifest(),"base")
def test_corrupt_kokoro_onnx(tmp_path):
    paths=Paths(tmp_path)
    def write_html(_url,dest,_label): dest.parent.mkdir(parents=True,exist_ok=True); dest.write_bytes(b"<html>error</html>")
    with patch("relais.pull._download",side_effect=write_html),pytest.raises(RuntimeError,match="Downloaded file appears corrupt"):
        pullmod._pull_kokoro(paths,pullmod.load_manifest())
