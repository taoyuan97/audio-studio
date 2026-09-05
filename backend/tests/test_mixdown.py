"""T006 混音线：滤镜矩阵、契约、真实时长、失败清理与脱敏。"""

from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.ffmpeg import FFmpegError, find_ffmpeg, find_ffprobe
from app.main import create_app
from app.mixdown import build_ffmpeg_args, build_filter_graph
from conftest import create_voice_artifact, make_settings, write_wav


def create_bgm_artifact(app, *, seconds: float = 0.1, name: str = "测试背景"):
    repo = app.state.repository
    artifact = repo.insert_artifact(
        type="bgm",
        name=name,
        params={"prompt": "test", "format": "wav"},
        audio_format="wav",
        duration=seconds,
    )
    path = app.state.audio_dir / "artifacts" / f"{artifact['id']}.wav"
    write_wav(path, seconds=seconds, frequency=110, sample_rate=48000)
    repo.update_artifact_audio_path(artifact["id"], f"artifacts/{artifact['id']}.wav")
    return repo.get_artifact(artifact["id"])


def payload(voice_id=None, bgm_id=None, **overrides):
    value = {
        "voice_artifact_id": voice_id,
        "bgm_artifact_id": bgm_id,
        "voice_speed": 1.0,
        "bgm_speed": 1.0,
        "voice_gain": 80,
        "bgm_gain": 45,
        "bgm_offset": 0,
        "ducking": True,
        "format": "wav",
    }
    value.update(overrides)
    return value


def wait_for_terminal(client: TestClient, run_id: str):
    for _ in range(200):
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in {"completed", "failed", "cancelled"}:
            return run
        time.sleep(0.02)
    raise AssertionError("run 未在预期时间内结束")


def test_filter_graph_matrix():
    looped = build_filter_graph(
        voice_duration=60,
        bgm_duration=20,
        voice_speed=2,
        bgm_speed=0.5,
        voice_gain=80,
        bgm_gain=45,
        bgm_offset=2.5,
        ducking=True,
    )
    assert "aloop=loop=-1" not in looped
    assert "[0:a]atempo=2.0000" in looped
    assert "[1:a]atempo=0.5000" in looped
    assert "adelay=2500:all=1" in looped
    assert "volume=0.8000" in looped and "volume=0.4500" in looped
    assert "sidechaincompress=threshold=0.03:ratio=4:attack=50:release=400" in looped
    assert "duration=first" in looped

    trimmed = build_filter_graph(
        voice_duration=20,
        bgm_duration=60,
        voice_speed=0.5,
        bgm_speed=2,
        voice_gain=100,
        bgm_gain=100,
        bgm_offset=0,
        ducking=False,
    )
    assert "aloop=loop=-1" in trimmed
    assert "atrim=duration=40" in trimmed
    assert "sidechaincompress" not in trimmed


def test_single_track_argument_rules(tmp_path: Path):
    voice_args = build_ffmpeg_args(
        voice_path=tmp_path / "voice.wav", bgm_path=None,
        voice_duration=1, bgm_duration=None, voice_speed=1.25, bgm_speed=1,
        voice_gain=20, bgm_gain=40,
        bgm_offset=12, ducking=True, output_format="mp3", output_path=tmp_path / "out.mp3.part",
    )
    assert "libmp3lame" in voice_args and "320k" in voice_args
    assert any("atempo=1.2500,volume=0.2000" in item for item in voice_args)
    assert not any("adelay=" in item for item in voice_args)

    bgm_args = build_ffmpeg_args(
        voice_path=None, bgm_path=tmp_path / "bgm.wav",
        voice_duration=None, bgm_duration=1, voice_speed=1, bgm_speed=0.75,
        voice_gain=20, bgm_gain=40,
        bgm_offset=12, ducking=True, output_format="wav", output_path=tmp_path / "out.wav.part",
        bgm_format="wav",
    )
    assert "copy" not in bgm_args
    assert any("atempo=0.7500,volume=0.4000" in item for item in bgm_args)

    copied_bgm_args = build_ffmpeg_args(
        voice_path=None, bgm_path=tmp_path / "bgm.wav",
        voice_duration=None, bgm_duration=1, voice_speed=1, bgm_speed=1,
        voice_gain=20, bgm_gain=100, bgm_offset=0, ducking=False,
        output_format="wav", output_path=tmp_path / "copied.wav.part", bgm_format="wav",
    )
    assert "copy" in copied_bgm_args


@pytest.mark.parametrize(
    "change,code",
    [
        ({}, "MIX_INPUT_MISSING"),
        ({"voice_gain": 101, "voice_artifact_id": "art_missing"}, "MIX_INPUT_INVALID"),
        ({"voice_speed": 0.49, "voice_artifact_id": "art_missing"}, "MIX_INPUT_INVALID"),
        ({"bgm_speed": 2.01, "voice_artifact_id": "art_missing"}, "MIX_INPUT_INVALID"),
        ({"bgm_offset": -1, "voice_artifact_id": "art_missing"}, "MIX_INPUT_INVALID"),
        ({"format": "flac", "voice_artifact_id": "art_missing"}, "MIX_INPUT_INVALID"),
    ],
)
def test_submit_validation(client, change, code):
    response = client.post("/api/mixdown/jobs", json=payload(**change))
    assert response.status_code == 422
    assert response.json()["code"] == code


def test_track_type_validation(client, app):
    voice = create_voice_artifact(app)
    response = client.post("/api/mixdown/jobs", json=payload(bgm_id=voice["id"]))
    assert response.status_code == 422
    assert response.json()["code"] == "MIX_INPUT_INVALID"


def test_speed_defaults_and_absent_track_values_are_normalized(client, app, monkeypatch):
    voice = create_voice_artifact(app)
    monkeypatch.setattr("app.mixdown.find_ffmpeg", lambda _path="": "ffmpeg")
    monkeypatch.setattr("app.mixdown.find_ffprobe", lambda _path="": "ffprobe")
    request_payload = payload(voice_id=voice["id"], bgm_speed=1.8, bgm_gain=99)
    request_payload.pop("voice_speed")
    response = client.post("/api/mixdown/jobs", json=request_payload)
    assert response.status_code == 202
    run = app.state.repository.get_run(response.json()["run_id"])
    snapshot = run["result"]["request"]
    assert snapshot["voice_speed"] == 1.0
    assert snapshot["bgm_speed"] == 1.0
    assert snapshot["bgm_gain"] == 45


def test_missing_ffmpeg_rejected_without_creating_run(tmp_path: Path):
    settings = make_settings(tmp_path, ffmpeg_path=str(tmp_path / "missing-ffmpeg"))
    application = create_app(settings=settings)
    with TestClient(application) as client:
        voice = create_voice_artifact(application)
        before = application.state.repository.count_queued_runs()
        response = client.post("/api/mixdown/jobs", json=payload(voice_id=voice["id"]))
        assert response.status_code == 503
        assert response.json()["code"] == "MIX_FFMPEG_MISSING"
        assert application.state.repository.count_queued_runs() == before


@pytest.mark.parametrize("configured_path", ["", "C:/tools/ffmpeg.exe"])
def test_submit_checks_path_and_configured_ffmpeg(tmp_path: Path, monkeypatch, configured_path):
    seen_ffmpeg = []
    seen_ffprobe = []
    monkeypatch.setattr("app.mixdown.find_ffmpeg", lambda value="": seen_ffmpeg.append(value) or "ffmpeg")
    monkeypatch.setattr("app.mixdown.find_ffprobe", lambda value="": seen_ffprobe.append(value) or "ffprobe")
    application = create_app(settings=make_settings(tmp_path, ffmpeg_path=configured_path))
    with TestClient(application) as client:
        voice = create_voice_artifact(application)
        response = client.post("/api/mixdown/jobs", json=payload(voice_id=voice["id"]))
        assert response.status_code == 202
    assert seen_ffmpeg and set(seen_ffmpeg) == {configured_path}
    assert seen_ffprobe and set(seen_ffprobe) == {configured_path}


@pytest.mark.parametrize("bgm_seconds", [0.08, 0.4])
def test_real_ffmpeg_dual_track_duration_and_events(client, app, monkeypatch, bgm_seconds):
    configured = Settings().ffmpeg_path
    if find_ffmpeg(configured) is None or find_ffprobe(configured) is None:
        pytest.skip("FFmpeg/ffprobe 不可用")
    voice = create_voice_artifact(app)
    bgm = create_bgm_artifact(app, seconds=bgm_seconds)
    from app import mixdown

    real_run = mixdown._run_cancellable

    async def observable_run(ctx, binary, args, timeout=300):
        await ctx.sleep(0.1)
        await real_run(ctx, binary, args, timeout)

    monkeypatch.setattr(mixdown, "_run_cancellable", observable_run)
    response = client.post(
        "/api/mixdown/jobs",
        json=payload(voice["id"], bgm["id"], voice_speed=0.5, bgm_speed=2, bgm_offset=0.03),
    )
    assert response.status_code == 202
    run_id = response.json()["run_id"]
    events = []
    with client.stream("GET", f"/api/runs/{run_id}/events") as stream:
        for line in stream.iter_lines():
            if line.startswith("event: "):
                events.append(line.removeprefix("event: "))
    run = app.state.repository.get_run(run_id)
    assert run["status"] == "completed"
    assert events[0] == "run.status"
    assert events[-1] == "run.completed"
    assert run["progress"]["stage"] == "encode"
    artifact = app.state.repository.get_artifact(run["artifact_id"])
    assert artifact["type"] == "mix"
    assert artifact["audio"]["duration"] == pytest.approx(voice["audio"]["duration"] / 0.5, abs=0.05)
    assert artifact["params"]["ducking"] is True
    assert artifact["params"]["voice_speed"] == 0.5
    assert artifact["params"]["bgm_speed"] == 2


def test_real_ffmpeg_single_track_combinations(client, app):
    configured = Settings().ffmpeg_path
    if find_ffmpeg(configured) is None or find_ffprobe(configured) is None:
        pytest.skip("FFmpeg/ffprobe 不可用")
    voice = create_voice_artifact(app)
    bgm = create_bgm_artifact(app, seconds=0.12)
    for request_payload, output_format, expected_duration in (
        (payload(voice_id=voice["id"], voice_speed=2, format="mp3"), "mp3", voice["audio"]["duration"] / 2),
        (payload(bgm_id=bgm["id"], bgm_speed=0.5, format="wav"), "wav", bgm["audio"]["duration"] / 0.5),
    ):
        response = client.post("/api/mixdown/jobs", json=request_payload)
        assert response.status_code == 202
        run = wait_for_terminal(client, response.json()["run_id"])
        assert run["status"] == "completed"
        artifact = app.state.repository.get_artifact(run["artifact_id"])
        assert artifact["audio"]["format"] == output_format
        assert artifact["audio"]["duration"] == pytest.approx(expected_duration, abs=0.1)
        assert artifact["params"]["ducking"] is False
        assert artifact["params"]["bgm_offset"] == 0


def test_ffmpeg_failure_is_sanitized_and_cleans_parts(client, app, monkeypatch):
    voice = create_voice_artifact(app)

    async def fail(_ctx, _binary, _args, timeout=300):
        del timeout
        raise FFmpegError(r"C:\\secret\\voice.wav: private stderr")

    monkeypatch.setattr("app.mixdown._run_cancellable", fail)
    monkeypatch.setattr("app.mixdown.find_ffmpeg", lambda _path="": "ffmpeg")
    monkeypatch.setattr("app.mixdown.find_ffprobe", lambda _path="": "ffprobe")
    response = client.post("/api/mixdown/jobs", json=payload(voice_id=voice["id"]))
    run = wait_for_terminal(client, response.json()["run_id"])
    assert run["status"] == "failed"
    assert run["error"]["code"] == "MIX_FFMPEG_ERROR"
    assert "secret" not in run["error"]["message"]
    assert not list((app.state.audio_dir / "artifacts").glob("*.part"))


def test_running_mixdown_cancel_cleans_partial_output(client, app, monkeypatch):
    voice = create_voice_artifact(app)

    async def slow(ctx, _binary, args, timeout=300):
        del timeout
        Path(args[-1]).write_bytes(b"partial")
        while True:
            await ctx.sleep(0.05)

    monkeypatch.setattr("app.mixdown._run_cancellable", slow)
    monkeypatch.setattr("app.mixdown.find_ffmpeg", lambda _path="": "ffmpeg")
    monkeypatch.setattr("app.mixdown.find_ffprobe", lambda _path="": "ffprobe")
    before = {item["id"] for item in app.state.repository.list_artifacts(type="mix")}
    response = client.post("/api/mixdown/jobs", json=payload(voice_id=voice["id"]))
    run_id = response.json()["run_id"]
    for _ in range(100):
        if client.get(f"/api/runs/{run_id}").json()["status"] == "running":
            break
        time.sleep(0.01)
    assert client.post(f"/api/runs/{run_id}/cancel").status_code == 200
    run = wait_for_terminal(client, run_id)
    assert run["status"] == "cancelled"
    after = {item["id"] for item in app.state.repository.list_artifacts(type="mix")}
    assert after == before
    assert not list((app.state.audio_dir / "artifacts").glob("*.part"))
