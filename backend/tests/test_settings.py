"""T007-B 浏览器设置、持久化与热更新契约。"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient


def test_status_is_masked_and_exposes_runtime(client: TestClient):
    body = client.get("/api/settings/status").json()
    assert body["revision"] == 0
    assert body["providers"]["minimax"]["editable"] is False
    assert "credential_masked" in body["providers"]["llm_deepseek"]
    assert body["providers"]["llm_deepseek"]["runtime_credential_fields"] == []
    assert body["runtime"]["llm_timeout_seconds"] == 120
    assert "ffprobe_available" in body["ffmpeg"]
    serialized = json.dumps(body)
    assert "deepseek_api_key" not in serialized


def test_reveal_only_returns_browser_saved_credential(app, client: TestClient):
    app.state.settings_store._base.deepseek_api_key = "env-secret"
    env_only = client.post(
        "/api/settings/providers/llm_deepseek/credentials/reveal",
        json={"revision": 0, "field": "credential"},
    )
    assert env_only.status_code == 422
    assert "env-secret" not in env_only.text

    saved = client.patch(
        "/api/settings/providers/llm_deepseek",
        json={"revision": 0, "credential": "browser-secret"},
    )
    assert saved.status_code == 200
    assert saved.json()["provider"]["runtime_credential_fields"] == ["credential"]

    revealed = client.post(
        "/api/settings/providers/llm_deepseek/credentials/reveal",
        headers={"Origin": "http://localhost:5173"},
        json={"revision": 1, "field": "credential"},
    )
    assert revealed.status_code == 200
    assert revealed.headers["cache-control"] == "no-store"
    assert revealed.json() == {
        "revision": 1,
        "field": "credential",
        "value": "browser-secret",
    }

    conflict = client.post(
        "/api/settings/providers/llm_deepseek/credentials/reveal",
        json={"revision": 0, "field": "credential"},
    )
    assert conflict.status_code == 409


def test_volc_credentials_are_revealed_per_field(app, client: TestClient):
    app.state.settings_store._base.volc_tts_access_token = "env-token"
    saved = client.patch(
        "/api/settings/providers/tts_volc",
        json={"revision": 0, "app_id": "browser-app-id"},
    )
    assert saved.status_code == 200
    provider = saved.json()["provider"]
    assert provider["credential_source"] == "mixed"
    assert provider["runtime_credential_fields"] == ["app_id"]

    app_id = client.post(
        "/api/settings/providers/tts_volc/credentials/reveal",
        json={"revision": 1, "field": "app_id"},
    )
    assert app_id.json()["value"] == "browser-app-id"
    token = client.post(
        "/api/settings/providers/tts_volc/credentials/reveal",
        json={"revision": 1, "field": "access_token"},
    )
    assert token.status_code == 422
    assert "env-token" not in token.text


def test_provider_update_persists_and_refreshes_models(app, client: TestClient):
    response = client.patch(
        "/api/settings/providers/llm_deepseek",
        json={"revision": 0, "credential": "sk-secret-value", "model_id": "same-model"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["revision"] == 1
    assert body["provider"]["credential_source"] == "runtime"
    assert "sk-secret-value" not in response.text
    settings_file = app.state.data_dir / "settings.json"
    assert settings_file.is_file()
    assert "sk-secret-value" in settings_file.read_text(encoding="utf-8")

    conversation = client.post("/api/conversations", json={"scene": "meditation"}).json()
    models = client.get(f"/api/conversations/{conversation['id']}/models").json()["models"]
    assert any(item["provider"] == "deepseek" and item["model"] == "same-model" for item in models)


def test_revision_conflict_and_minimax_write_rejected(client: TestClient):
    first = client.patch(
        "/api/settings/runtime",
        json={"revision": 0, "llm_timeout_seconds": 30},
    )
    assert first.status_code == 200
    conflict = client.patch(
        "/api/settings/runtime",
        json={"revision": 0, "llm_timeout_seconds": 40},
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "SETTINGS_REVISION_CONFLICT"
    minimax = client.patch(
        "/api/settings/providers/minimax",
        json={"revision": 1, "credential": "forbidden"},
    )
    assert minimax.status_code == 422


def test_clear_runtime_credentials_falls_back_to_base(app, client: TestClient):
    app.state.settings_store._base.deepseek_api_key = "env-key"
    saved = client.patch(
        "/api/settings/providers/llm_deepseek",
        json={"revision": 0, "credential": "runtime-key"},
    )
    assert saved.status_code == 200
    cleared = client.request(
        "DELETE",
        "/api/settings/providers/llm_deepseek/credentials",
        json={"revision": 1},
    )
    assert cleared.status_code == 200
    assert cleared.json()["provider"]["credential_source"] == "env"
    assert app.state.settings_store.current.deepseek_api_key == "env-key"


def test_non_local_origin_is_rejected(client: TestClient):
    response = client.patch(
        "/api/settings/runtime",
        headers={"Origin": "https://example.com"},
        json={"revision": 0, "llm_timeout_seconds": 30},
    )
    assert response.status_code == 403
    assert response.json()["code"] == "SETTINGS_ORIGIN_FORBIDDEN"


def test_probe_unconfigured_is_200_and_unknown_is_422(client: TestClient):
    unconfigured = client.post("/api/settings/probe/minimax")
    assert unconfigured.status_code == 200
    assert unconfigured.json()["ok"] is False
    unknown = client.post("/api/settings/probe/unknown")
    assert unknown.status_code == 422
    assert unknown.json()["code"] == "SETTINGS_PARAMS_INVALID"
