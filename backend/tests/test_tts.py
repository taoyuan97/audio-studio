"""T004：合成计划、Provider 解析、端点与 fake 完整链路。"""

from __future__ import annotations

import asyncio
import base64
import time

import httpx
import pytest

from app.config import Settings
from app.ffmpeg import find_ffmpeg
from app.tts.capabilities import ALIYUN_QWEN, VOLCANO, TTSCapabilities
from app.tts.plan import PlanSegment, build_plan, validate_plan
from app.tts.providers import AliyunTTSProvider, TTSProviderError
from conftest import create_script_artifact


def test_plan_uses_ssml_for_short_pause_and_silence_for_long_pause():
    ssml_capable = TTSCapabilities(True, True, True, 10_000)
    plan = build_plan("开始[停顿 2s]继续[停顿 12s]结束", ssml_capable, 0.8)
    assert plan[0].enable_ssml is True
    assert '<break time="2000ms"/>' in plan[0].text
    assert any(item.kind == "silence" and item.seconds == 12 for item in plan)


def test_plan_keeps_breaths_as_independent_silence():
    plan = build_plan("吸气[吸气]呼气[呼气]结束", ALIYUN_QWEN, 0.8)
    silences = [item.seconds for item in plan if item.kind == "silence"]
    assert silences == [4.0, 5.0]


def test_plan_skips_punctuation_only_text_between_breath_markers():
    plan = build_plan("[吸气]……[呼气]……", ALIYUN_QWEN, 0.8)

    assert [(item.kind, item.seconds) for item in plan] == [
        ("silence", 4.0),
        ("silence", 5.0),
    ]


def test_plan_skips_symbols_and_invisible_characters_but_keeps_sentence_punctuation():
    assert build_plan("\u200b……——\x00", ALIYUN_QWEN, 0.8) == []

    plan = build_plan("你好，世界……", ALIYUN_QWEN, 0.8)
    assert [item.text for item in plan if item.kind == "speech"] == ["你好，世界……"]


def test_plan_preflight_rejects_invalid_speech_without_exposing_text():
    with pytest.raises(ValueError) as caught:
        validate_plan([PlanSegment(kind="speech", text="……")])

    assert "第 1 段" in str(caught.value)
    assert "……" not in str(caught.value)


def test_default_aliyun_qwen_uses_local_silence_for_pause():
    plan = build_plan("开始[停顿 2s]继续", ALIYUN_QWEN, 0.8)
    assert any(item.kind == "silence" and item.seconds == 2 for item in plan)
    assert all(item.enable_ssml is False for item in plan)


def test_plan_degrades_instruction_and_ssml_for_volcano():
    plan = build_plan("你好[情绪:温柔][停顿 2s]世界", VOLCANO, 1.0)
    assert all(item.emotion is None for item in plan)
    assert any(item.kind == "silence" and item.seconds == 2 for item in plan)


def test_aliyun_sse_parser_joins_audio_chunks():
    first = base64.b64encode(b"abc").decode()
    second = base64.b64encode(b"def").decode()

    async def run():
        response = httpx.Response(
            200,
            content=(
                f'data: {{"output":{{"audio":{{"data":"{first}"}}}}}}\n\n'
                f'data: {{"output":{{"audio":{{"data":"{second}"}}}}}}\n\n'
                'data: {"output":{"finish_reason":"stop"}}\n\n'
            ),
        )
        return await AliyunTTSProvider._parse_sse(response)

    assert asyncio.run(run()) == b"abcdef"


def test_aliyun_sse_parser_explains_model_voice_411():
    async def run():
        response = httpx.Response(
            200,
            content=(
                'data: {"code":"InvalidParameter","message":'
                '"[cosyvoice:]Engine error [411]: TTS speak operation failed"}\n\n'
            ),
        )
        return await AliyunTTSProvider._parse_sse(
            response,
            model="qwen-audio-3.0-tts-plus",
            voice="longlinshuoxi",
        )

    with pytest.raises(TTSProviderError) as caught:
        asyncio.run(run())

    message = str(caught.value)
    assert "当前模型不支持该音色" in message
    assert "model=qwen-audio-3.0-tts-plus" in message
    assert "voice=longlinshuoxi" in message
    assert "qwen-audio-3.0-tts-plus-音色后缀" in message


def test_aliyun_sse_parser_keeps_other_safe_provider_errors():
    async def run():
        response = httpx.Response(
            200,
            content='data: {"code":"InvalidParameter","message":"text is invalid"}\n\n',
        )
        return await AliyunTTSProvider._parse_sse(response)

    with pytest.raises(TTSProviderError, match="text is invalid"):
        asyncio.run(run())


def test_defaults_use_independent_aliyun_model(client):
    response = client.get("/api/tts/defaults")
    assert response.status_code == 200
    aliyun = response.json()["engines"][0]
    assert aliyun["model"] == "qwen-audio-3.0-tts-plus"
    assert aliyun["supports_ssml"] is False
    assert aliyun["supports_instruction"] is True
    assert aliyun["supports_pitch"] is False
    assert aliyun["voices"]
    assert aliyun["voices"][0]["name"] == "龙安灵心"
    assert aliyun["voices"][0]["source"] == "system"


def test_preview_is_cached(client, app):
    url = "/api/tts/voices/aliyun/longanlingxin/preview"
    first = client.get(url)
    assert first.status_code == 200
    caches = list((app.state.audio_dir / "previews").glob("aliyun_*.wav"))
    assert len(caches) == 1
    cache = caches[0]
    assert "longanlingxin" not in cache.name
    modified = cache.stat().st_mtime_ns
    second = client.get(url)
    assert second.status_code == 200
    assert cache.stat().st_mtime_ns == modified


def test_custom_voice_crud_model_filter_and_defaults(client, app):
    created = client.post(
        "/api/tts/custom-voices",
        json={"model": "qwen-audio-3.0-tts-plus", "voice_id": "my-voice_01", "name": " 我的音色 "},
    )
    assert created.status_code == 201
    voice = created.json()
    assert voice["name"] == "我的音色"
    assert voice["display_name"] == "我的音色"
    assert voice["verification_status"] == "unverified"

    assert client.post(
        "/api/tts/custom-voices",
        json={"model": "other-model", "voice_id": "my-voice_01"},
    ).status_code == 201
    filtered = client.get(
        "/api/tts/custom-voices", params={"model": "qwen-audio-3.0-tts-plus"}
    ).json()["items"]
    assert [item["id"] for item in filtered] == [voice["id"]]

    aliyun = client.get("/api/tts/defaults").json()["engines"][0]
    option = next(item for item in aliyun["voices"] if item["id"] == "my-voice_01")
    assert option["name"] == "我的音色"
    assert option["source"] == "custom"
    assert option["custom_voice_id"] == voice["id"]

    renamed = client.patch(
        f"/api/tts/custom-voices/{voice['id']}", json={"name": None}
    )
    assert renamed.status_code == 200
    assert renamed.json()["display_name"] == "my-voice_01"

    assert client.delete(f"/api/tts/custom-voices/{voice['id']}").json() == {
        "deleted": True
    }
    assert client.get(f"/api/tts/custom-voices/{voice['id']}/preview").status_code == 404


def test_custom_voice_rejects_duplicates_system_conflicts_and_invalid_ids(client):
    payload = {"model": "qwen-audio-3.0-tts-plus", "voice_id": "custom-one"}
    assert client.post("/api/tts/custom-voices", json=payload).status_code == 201
    duplicate = client.post("/api/tts/custom-voices", json=payload)
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "TTS_CUSTOM_VOICE_DUPLICATE"

    conflict = client.post(
        "/api/tts/custom-voices",
        json={"model": "qwen-audio-3.0-tts-plus", "voice_id": "longanlingxin"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "TTS_CUSTOM_VOICE_SYSTEM_CONFLICT"

    invalid_id = client.post(
        "/api/tts/custom-voices",
        json={"model": "qwen-audio-3.0-tts-plus", "voice_id": "../escape"},
    )
    assert invalid_id.status_code == 422
    assert invalid_id.json()["code"] == "TTS_CUSTOM_VOICE_PARAMS_INVALID"


def test_custom_voice_verify_caches_force_refreshes_and_records_failure(
    client, app, monkeypatch
):
    from app.tts import routes

    created = client.post(
        "/api/tts/custom-voices",
        json={"model": "qwen-audio-3.0-tts-plus", "voice_id": "preview-custom"},
    ).json()
    original = routes._synthesize_one
    calls = 0

    async def count_synthesize(*args, **kwargs):
        nonlocal calls
        calls += 1
        return await original(*args, **kwargs)

    monkeypatch.setattr(routes, "_synthesize_one", count_synthesize)
    first = client.post(
        f"/api/tts/custom-voices/{created['id']}/verify", json={"force": False}
    )
    assert first.status_code == 200
    assert first.json()["cache_hit"] is False
    assert first.json()["voice"]["verification_status"] == "verified"
    cache = next((app.state.audio_dir / "previews").glob("aliyun_*.wav"))
    assert "preview-custom" not in cache.name

    second = client.post(
        f"/api/tts/custom-voices/{created['id']}/verify", json={"force": False}
    )
    assert second.json()["cache_hit"] is True
    assert calls == 1
    assert client.get(second.json()["preview_url"]).status_code == 200

    forced = client.post(
        f"/api/tts/custom-voices/{created['id']}/verify", json={"force": True}
    )
    assert forced.status_code == 200
    assert calls == 2

    async def fail(*args, **kwargs):
        raise TTSProviderError("上游拒绝该音色")

    monkeypatch.setattr(routes, "_synthesize_one", fail)
    failed = client.post(
        f"/api/tts/custom-voices/{created['id']}/verify", json={"force": True}
    )
    assert failed.status_code == 502
    assert failed.json()["code"] == "TTS_CUSTOM_VOICE_VERIFY_FAILED"
    stored = client.get("/api/tts/custom-voices").json()["items"][0]
    assert stored["verification_status"] == "failed"
    assert stored["last_verified_at"] is not None
    assert "上游拒绝" in stored["last_error"]
    assert client.get(f"/api/tts/custom-voices/{created['id']}/preview").status_code == 200


def test_custom_voice_can_generate_and_freezes_display_metadata(client):
    voice = client.post(
        "/api/tts/custom-voices",
        json={"model": "qwen-audio-3.0-tts-plus", "voice_id": "generate-custom", "name": "温柔女声 03"},
    ).json()
    response = client.post(
        "/api/tts/jobs",
        json={
            "text": "现在，请慢慢放松。",
            "scene": "meditation",
            "engine": "aliyun",
            "voice_id": "generate-custom",
            "speed": 0.8,
            "format": "wav",
        },
    )
    assert response.status_code == 202
    run_id = response.json()["run_id"]
    for _ in range(100):
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in ("completed", "failed"):
            break
        time.sleep(0.02)
    assert run["status"] == "completed", run
    artifact = client.get(f"/api/artifacts/{run['artifact_id']}").json()
    assert artifact["params"]["voice_id"] == "generate-custom"
    assert artifact["params"]["voice_name"] == "温柔女声 03"
    assert artifact["params"]["voice_source"] == "custom"

    assert client.patch(
        f"/api/tts/custom-voices/{voice['id']}", json={"name": "新名称"}
    ).status_code == 200
    unchanged = client.get(f"/api/artifacts/{run['artifact_id']}").json()
    assert unchanged["params"]["voice_name"] == "温柔女声 03"


def test_fake_tts_job_creates_voice_artifact(client, app):
    script = create_script_artifact(app, "欢迎[停顿 1s]慢慢放松")
    response = client.post(
        "/api/tts/jobs",
        json={
            "script_artifact_id": script["id"],
            "text": None,
            "scene": "meditation",
            "engine": "aliyun",
            "voice_id": "longanlingxin",
            "speed": 0.8,
            "pitch": None,
            "format": "wav",
        },
    )
    assert response.status_code == 202
    run_id = response.json()["run_id"]
    run = None
    for _ in range(100):
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in ("completed", "failed"):
            break
        time.sleep(0.02)
    assert run is not None and run["status"] == "completed", run
    artifact = client.get(f"/api/artifacts/{run['artifact_id']}").json()
    assert artifact["type"] == "voice"
    assert artifact["params"]["model"] == "qwen-audio-3.0-tts-plus"
    assert client.get(artifact["audio"]["url"]).status_code == 200


def test_tts_preflight_runs_before_provider_calls(client, monkeypatch):
    from app.tts import routes

    called = False

    async def track_synthesize(*args, **kwargs):
        nonlocal called
        called = True
        return b""

    monkeypatch.setattr(
        routes,
        "build_plan",
        lambda *args, **kwargs: [PlanSegment(kind="speech", text="……")],
    )
    monkeypatch.setattr(routes, "_synthesize_one", track_synthesize)
    response = client.post(
        "/api/tts/jobs",
        json={
            "text": "正常提交文本",
            "scene": "meditation",
            "engine": "aliyun",
            "voice_id": "longanlingxin",
            "speed": 0.8,
            "format": "wav",
        },
    )
    run_id = response.json()["run_id"]
    for _ in range(100):
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in ("completed", "failed"):
            break
        time.sleep(0.02)

    assert run["status"] == "failed"
    assert run["error"]["code"] == "TTS_TEXT_INVALID"
    assert called is False


def test_tts_provider_failure_includes_safe_segment_context(client, monkeypatch):
    from app.tts import routes

    original = routes._synthesize_one
    calls = 0

    async def fail_second_speech(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise TTSProviderError("上游拒绝输入")
        return await original(*args, **kwargs)

    monkeypatch.setattr(routes, "_synthesize_one", fail_second_speech)
    response = client.post(
        "/api/tts/jobs",
        json={
            "text": "第一段。[停顿 1s]第二段。",
            "scene": "meditation",
            "engine": "aliyun",
            "voice_id": "longanlingxin",
            "speed": 0.8,
            "format": "wav",
        },
    )
    run_id = response.json()["run_id"]
    for _ in range(100):
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in ("completed", "failed"):
            break
        time.sleep(0.02)

    assert run["status"] == "failed"
    assert run["progress"]["completed"] == 2
    assert run["error"]["code"] == "TTS_PROVIDER_ERROR"
    assert "第 3/3 段" in run["error"]["message"]
    assert "TTS 请求 2" in run["error"]["message"]
    assert "文本长度 4" in run["error"]["message"]
    assert "第二段" not in run["error"]["message"]


def test_fake_tts_job_encodes_mp3_when_ffmpeg_is_available(client, app):
    if find_ffmpeg(Settings().ffmpeg_path) is None:
        pytest.skip("本机未配置 ffmpeg")
    response = client.post(
        "/api/tts/jobs",
        json={
            "text": "现在，请慢慢放松。",
            "scene": "meditation",
            "engine": "aliyun",
            "voice_id": "longanlingxin",
            "speed": 0.8,
            "format": "mp3",
        },
    )
    assert response.status_code == 202
    run_id = response.json()["run_id"]
    run = None
    for _ in range(150):
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in ("completed", "failed"):
            break
        time.sleep(0.02)
    assert run is not None and run["status"] == "completed", run
    artifact = client.get(f"/api/artifacts/{run['artifact_id']}").json()
    assert artifact["audio"]["format"] == "mp3"
    audio = client.get(artifact["audio"]["url"])
    assert audio.status_code == 200
    assert audio.headers["content-type"].startswith("audio/mpeg")


def test_cancelling_running_tts_leaves_no_artifact_or_partial_file(
    client, app, monkeypatch
):
    from app.tts import routes

    original = routes._synthesize_one

    async def slow_synthesize(*args, **kwargs):
        await asyncio.sleep(0.15)
        return await original(*args, **kwargs)

    monkeypatch.setattr(routes, "_synthesize_one", slow_synthesize)
    before = {item["id"] for item in app.state.repository.list_artifacts(type="voice")}
    response = client.post(
        "/api/tts/jobs",
        json={
            "text": "第一段。[停顿 11s]第二段。[停顿 11s]第三段。",
            "scene": "meditation",
            "engine": "aliyun",
            "voice_id": "longanlingxin",
            "speed": 0.8,
            "format": "wav",
        },
    )
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
    after = {item["id"] for item in app.state.repository.list_artifacts(type="voice")}
    assert after == before
    assert list((app.state.audio_dir / "artifacts").glob("*.part")) == []
