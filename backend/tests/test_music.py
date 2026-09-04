"""T005 BGM 线：MiniMax、契约、重试、后处理与事件。"""

from __future__ import annotations

import asyncio
import json
import shutil
import time
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.database import now_ms
from app.ffmpeg import find_ffmpeg, find_ffprobe
from app.music.fake import generate_fake_music
from app.music.minimax import URL_TTL_MS, generate_music
from app.music.postprocess import AudioInfo, process_music
from app.music.provider import MusicGenerationRequest, MusicServiceError


def music_payload(**overrides):
    payload = {
        "prompt": "空灵古琴与柔和电子氛围",
        "target_duration": 300,
        "structure_hints": ["intro", "outro"],
        "format": "mp3",
    }
    payload.update(overrides)
    return payload


def failed_music_run(app, *, expires_at=None, audio_url=None):
    result = {"request": {"provider": "minimax", "model": "music-3.0", **music_payload()}, "source_run_id": None}
    if audio_url:
        result.update(audio_url=audio_url, expires_at=expires_at, request_id="trace-1", source_duration=42.0)
    run = app.state.repository.create_run("music", result=result)
    app.state.repository.finish_run(run["id"], "failed", error_code="MUSIC_DOWNLOAD_FAILED", error_message="下载失败")
    return app.state.repository.get_run(run["id"])


def test_defaults_and_submit_contract(client, app):
    defaults = client.get("/api/music/defaults")
    assert defaults.status_code == 200
    body = defaults.json()
    assert body["provider"] == "minimax"
    assert body["model"] == "music-3.0"
    assert "styles" not in body
    assert body["capabilities"]["structure_control"] == "prompt_hint"

    response = client.post("/api/music/jobs", json=music_payload())
    assert response.status_code == 202
    run = app.state.repository.get_run(response.json()["run_id"])
    assert run["result"]["request"]["prompt"] == "空灵古琴与柔和电子氛围"
    assert run["result"]["request"]["structure_hints"] == ["intro", "outro"]


@pytest.mark.parametrize(
    "change",
    [
        {"prompt": " "},
        {"prompt": "x" * 2001},
        {"target_duration": 59},
        {"target_duration": 601},
        {"structure_hints": ["intro", "intro"]},
        {"structure_hints": ["verse"]},
        {"format": "flac"},
    ],
)
def test_submit_validation(client, change):
    response = client.post("/api/music/jobs", json=music_payload(**change))
    assert response.status_code == 422
    assert response.json()["code"] == "MUSIC_PARAMS_INVALID"


def test_retry_download_and_regenerate_branches(client, app, monkeypatch):
    async def fake_download(_ctx, _url, destination):
        destination.write_bytes(b"audio")

    monkeypatch.setattr("app.music.routes._download", fake_download)
    valid = failed_music_run(app, expires_at=now_ms() + 60_000, audio_url="https://example.com/music.mp3")
    status = client.get(f"/api/runs/{valid['id']}").json()
    assert status["music_retry"] == {"download_available": True, "expires_at": valid["result"]["expires_at"]}

    download = client.post(f"/api/music/jobs/{valid['id']}/retry", json={"mode": "download"})
    assert download.status_code == 202
    copied = app.state.repository.get_run(download.json()["run_id"])["result"]
    assert copied["audio_url"] == "https://example.com/music.mp3"
    assert copied["source_run_id"] == valid["id"]

    expired = failed_music_run(app, expires_at=now_ms() - 1, audio_url="https://example.com/expired.mp3")
    rejected = client.post(f"/api/music/jobs/{expired['id']}/retry", json={"mode": "download"})
    assert rejected.status_code == 422
    assert rejected.json()["code"] == "MUSIC_URL_EXPIRED"

    unconfirmed = client.post(f"/api/music/jobs/{expired['id']}/retry", json={"mode": "regenerate"})
    assert unconfirmed.status_code == 422
    assert unconfirmed.json()["code"] == "MUSIC_REGENERATE_UNCONFIRMED"
    confirmed = client.post(
        f"/api/music/jobs/{expired['id']}/retry",
        json={"mode": "regenerate", "confirm_regenerate": True},
    )
    assert confirmed.status_code == 202
    regenerated = app.state.repository.get_run(confirmed.json()["run_id"])["result"]
    assert "audio_url" not in regenerated
    assert regenerated["source_run_id"] == expired["id"]


def test_retry_only_failed_music(client, app):
    queued = app.state.repository.create_run("music", result={"request": music_payload()})
    response = client.post(f"/api/music/jobs/{queued['id']}/retry", json={"mode": "download"})
    assert response.status_code == 409
    assert response.json()["code"] == "RUN_NOT_RETRYABLE"


@pytest.mark.parametrize(
    ("status", "body", "code"),
    [
        (401, {}, "MUSIC_AUTH_FAILED"),
        (429, {}, "MUSIC_RATE_LIMITED"),
        (403, {"base_resp": {"status_msg": "insufficient balance"}}, "MUSIC_ACCESS_DENIED"),
        (
            200,
            {"base_resp": {"status_code": 2153, "status_msg": "This Music API is no longer available to new users."}},
            "MUSIC_ACCESS_DENIED",
        ),
        (400, {"base_resp": {"status_msg": "content audit failed"}}, "MUSIC_CONTENT_REJECTED"),
        (200, {"base_resp": {"status_code": 2013}}, "MUSIC_REQUEST_INVALID"),
        (500, {}, "MUSIC_PROVIDER_ERROR"),
    ],
)
def test_minimax_error_classification(status, body, code):
    transport = httpx.MockTransport(lambda request: httpx.Response(status, json=body, request=request))
    with pytest.raises(MusicServiceError) as caught:
        asyncio.run(generate_music("secret", MusicGenerationRequest("calm", 60), transport=transport))
    assert caught.value.code == code


def test_minimax_payload_and_url_ttl():
    captured = {}

    def handler(request: httpx.Request):
        captured.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "data": {"audio": "https://example.com/audio.mp3", "status": 2},
                "trace_id": "trace-1",
                "extra_info": {"music_duration": 25_364, "music_sample_rate": 44100, "music_channel": 2},
                "base_resp": {"status_code": 0, "status_msg": "success"},
            },
            request=request,
        )

    before = int(time.time() * 1000)
    result = asyncio.run(
        generate_music(
            "secret",
            MusicGenerationRequest("空灵音乐", 300, ("intro", "outro")),
            model="music-custom",
            transport=httpx.MockTransport(handler),
        )
    )
    assert captured["model"] == "music-custom"
    assert captured["is_instrumental"] is True
    assert captured["lyrics_optimizer"] is False
    assert captured["stream"] is False
    assert captured["output_format"] == "url"
    assert "结构倾向" in captured["prompt"]
    assert before + URL_TTL_MS <= result.expires_at_ms <= int(time.time() * 1000) + URL_TTL_MS


def test_postprocess_loop_fade_and_atomic(monkeypatch, tmp_path: Path):
    source = tmp_path / "source.wav"
    final = tmp_path / "final.mp3"
    source.write_bytes(b"source")
    commands = []

    def fake_probe(path, _ffmpeg_path=""):
        if Path(path) == source:
            return AudioInfo(30, 44100, 2)
        return AudioInfo(60, 48000, 2)

    def fake_run(_path, args):
        commands.append(args)
        Path(args[-1]).write_bytes(b"generated")

    monkeypatch.setattr("app.music.postprocess.probe_audio", fake_probe)
    monkeypatch.setattr("app.music.postprocess._run", fake_run)
    _source, output = process_music(source, final, 60, "mp3")
    assert output.duration_seconds == 60
    assert final.read_bytes() == b"generated"
    flattened = " ".join(" ".join(command) for command in commands)
    assert "-stream_loop -1" in flattened
    assert "afade=t=in" in flattened and "afade=t=out" in flattened
    assert "320k" in flattened and "48000" in flattened
    assert not list(tmp_path.glob("*.part"))


def test_fake_event_sequence_and_artifact(client, app, monkeypatch):
    def fake_process(source, final, target, _format, _ffmpeg_path=""):
        shutil.copyfile(source, final)
        return AudioInfo(12, 8000, 1), AudioInfo(float(target), 48000, 1)

    monkeypatch.setattr("app.music.routes.process_music", fake_process)
    response = client.post("/api/music/jobs", json=music_payload(target_duration=60))
    run_id = response.json()["run_id"]
    events = []
    with client.stream("GET", f"/api/runs/{run_id}/events") as stream:
        for line in stream.iter_lines():
            if line.startswith("event: "):
                events.append(line.removeprefix("event: "))
    assert events[0] == "run.status"
    assert "music.progress" in events
    assert events[-1] == "run.completed"
    run = app.state.repository.get_run(run_id)
    artifact = app.state.repository.get_artifact(run["artifact_id"])
    assert artifact["type"] == "bgm"
    assert artifact["params"]["prompt"] == music_payload()["prompt"]
    assert artifact["params"]["target_duration"] == 60


def test_fake_music_real_postprocess(tmp_path: Path):
    ffmpeg_path = Settings().ffmpeg_path
    if find_ffmpeg(ffmpeg_path) is None or find_ffprobe(ffmpeg_path) is None:
        pytest.skip("FFmpeg/ffprobe 不可用")
    source = tmp_path / "source.wav"
    final = tmp_path / "final.mp3"
    generate_fake_music(source, "冥想钢琴", ["intro", "outro"])
    source_info, final_info = process_music(source, final, 60, "mp3", ffmpeg_path)
    assert source_info.duration_seconds == pytest.approx(12, abs=0.1)
    assert final_info.duration_seconds == pytest.approx(60, abs=1)
    assert final_info.sample_rate == 48000
    assert final.is_file() and final.stat().st_size > 0


def test_cancelling_music_generation_leaves_no_artifact_or_partial_file(client, app, monkeypatch):
    def slow_fake(path, _prompt, _hints):
        time.sleep(0.2)
        Path(path).write_bytes(b"cancelled-source")
        return 12.0

    monkeypatch.setattr("app.music.routes.generate_fake_music", slow_fake)
    before = {item["id"] for item in app.state.repository.list_artifacts(type="bgm")}
    response = client.post("/api/music/jobs", json=music_payload(target_duration=60))
    run_id = response.json()["run_id"]
    for _ in range(100):
        if client.get(f"/api/runs/{run_id}").json()["status"] == "running":
            break
        time.sleep(0.01)
    assert client.post(f"/api/runs/{run_id}/cancel").status_code == 200
    for _ in range(100):
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] == "cancelled":
            break
        time.sleep(0.02)
    assert run["status"] == "cancelled"
    after = {item["id"] for item in app.state.repository.list_artifacts(type="bgm")}
    assert after == before
    artifacts_dir = app.state.audio_dir / "artifacts"
    assert not list(artifacts_dir.glob(f"*{run_id}*"))
    assert not list(artifacts_dir.glob("*.part"))
