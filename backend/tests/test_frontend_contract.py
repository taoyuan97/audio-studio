"""契约测试：锁定 api-contract.md 第 3/5/6 节端点（T002 范围）。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.applications import Starlette

from conftest import create_script_artifact, create_voice_artifact


class TestHealthAndStats:
    def test_health(self, client: TestClient):
        response = client.get("/api/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert "version" in body

    def test_stats_shape(self, client: TestClient):
        body = client.get("/api/stats").json()
        assert set(body) == {
            "artifact_counts",
            "conversation_count",
            "recent_artifacts",
            "active_runs",
        }


class TestArtifacts:
    def test_list_with_type_filter(self, app: Starlette, client: TestClient):
        voice = create_voice_artifact(app)
        create_script_artifact(app)
        body = client.get("/api/artifacts?type=voice").json()
        assert all(item["type"] == "voice" for item in body["items"])
        assert any(item["id"] == voice["id"] for item in body["items"])

    def test_list_invalid_type_422(self, client: TestClient):
        response = client.get("/api/artifacts?type=unknown")
        assert response.status_code == 422
        assert response.json()["code"] == "ARTIFACT_TYPE_INVALID"

    def test_detail_shape(self, app: Starlette, client: TestClient):
        voice = create_voice_artifact(app, name="深海人声")
        body = client.get(f"/api/artifacts/{voice['id']}").json()
        assert body["id"] == voice["id"]
        assert body["name"] == "深海人声"
        assert body["params"]["engine"] == "demo"
        assert body["audio"]["format"] == "wav"
        assert body["audio"]["url"] == f"/api/artifacts/{voice['id']}/audio"
        assert body["audio"]["peaks_url"] == f"/api/artifacts/{voice['id']}/peaks"

    def test_detail_not_found(self, client: TestClient):
        response = client.get("/api/artifacts/art_missing")
        assert response.status_code == 404
        assert response.json()["code"] == "ARTIFACT_NOT_FOUND"

    def test_patch_rename(self, app: Starlette, client: TestClient):
        voice = create_voice_artifact(app)
        response = client.patch(
            f"/api/artifacts/{voice['id']}", json={"name": "新名字"}
        )
        assert response.status_code == 200
        assert response.json()["name"] == "新名字"

    def test_patch_script_content_requires_draft_version_flow(
        self, app: Starlette, client: TestClient
    ):
        script = create_script_artifact(app)
        response = client.patch(
            f"/api/artifacts/{script['id']}", json={"content": {"text": "编辑后 [停顿 2s]"}}
        )
        assert response.status_code == 422
        assert response.json()["code"] == "SCRIPT_EDIT_VIA_DRAFT_REQUIRED"

    def test_patch_audio_content_rejected(self, app: Starlette, client: TestClient):
        voice = create_voice_artifact(app)
        response = client.patch(
            f"/api/artifacts/{voice['id']}", json={"content": {"text": "x"}}
        )
        assert response.status_code == 422
        assert response.json()["code"] == "ARTIFACT_NOT_EDITABLE"

    def test_patch_script_empty_content_still_requires_draft_flow(
        self, app: Starlette, client: TestClient
    ):
        script = create_script_artifact(app)
        response = client.patch(
            f"/api/artifacts/{script['id']}", json={"content": {"text": "  "}}
        )
        assert response.status_code == 422
        assert response.json()["code"] == "SCRIPT_EDIT_VIA_DRAFT_REQUIRED"

    def test_delete_removes_files(self, app: Starlette, client: TestClient):
        voice = create_voice_artifact(app)
        audio_file = app.state.audio_dir / "artifacts" / f"{voice['id']}.wav"
        assert audio_file.is_file()
        # 先请求 peaks 生成缓存
        assert client.get(f"/api/artifacts/{voice['id']}/peaks").status_code == 200
        peaks_file = app.state.audio_dir / "peaks" / f"{voice['id']}.json"
        assert peaks_file.is_file()

        response = client.delete(f"/api/artifacts/{voice['id']}")
        assert response.status_code == 200
        assert response.json() == {"deleted": True}
        assert not audio_file.exists()
        assert not peaks_file.exists()
        assert client.get(f"/api/artifacts/{voice['id']}").status_code == 404


class TestArtifactAudio:
    def test_full_download(self, app: Starlette, client: TestClient):
        voice = create_voice_artifact(app)
        response = client.get(f"/api/artifacts/{voice['id']}/audio")
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/wav"
        assert response.headers["accept-ranges"] == "bytes"
        assert len(response.content) > 0

    def test_range_request_partial(self, app: Starlette, client: TestClient):
        voice = create_voice_artifact(app)
        full = client.get(f"/api/artifacts/{voice['id']}/audio").content
        response = client.get(
            f"/api/artifacts/{voice['id']}/audio", headers={"Range": "bytes=0-99"}
        )
        assert response.status_code == 206
        assert response.headers["content-range"] == f"bytes 0-99/{len(full)}"
        assert len(response.content) == 100

    def test_range_open_ended(self, app: Starlette, client: TestClient):
        voice = create_voice_artifact(app)
        full = client.get(f"/api/artifacts/{voice['id']}/audio").content
        response = client.get(
            f"/api/artifacts/{voice['id']}/audio", headers={"Range": "bytes=100-"}
        )
        assert response.status_code == 206
        assert len(response.content) == len(full) - 100

    def test_script_artifact_no_audio_404(self, app: Starlette, client: TestClient):
        script = create_script_artifact(app)
        response = client.get(f"/api/artifacts/{script['id']}/audio")
        assert response.status_code == 404
        assert response.json()["code"] == "ARTIFACT_NO_AUDIO"


class TestArtifactPeaks:
    def test_peaks_shape_and_cache(self, app: Starlette, client: TestClient):
        voice = create_voice_artifact(app)
        body = client.get(f"/api/artifacts/{voice['id']}/peaks").json()
        assert set(body) == {"peaks", "duration", "buckets"}
        assert 0 < body["buckets"] <= 1200
        assert len(body["peaks"]) == body["buckets"]
        assert all(0.0 <= value <= 1.0 for value in body["peaks"])
        assert body["duration"] == pytest.approx(0.2, abs=0.01)
        # 缓存文件已生成
        peaks_file = app.state.audio_dir / "peaks" / f"{voice['id']}.json"
        assert peaks_file.is_file()

    def test_peaks_script_artifact_404(self, app: Starlette, client: TestClient):
        script = create_script_artifact(app)
        response = client.get(f"/api/artifacts/{script['id']}/peaks")
        assert response.status_code == 404
        assert response.json()["code"] == "ARTIFACT_NO_AUDIO"


class TestErrorContract:
    def test_error_shape_is_code_message(self, client: TestClient):
        response = client.get("/api/artifacts/art_missing")
        body = response.json()
        assert set(body) == {"code", "message"}
        assert isinstance(body["code"], str)
        assert isinstance(body["message"], str)

    def test_validation_error_shape(self, client: TestClient):
        response = client.patch("/api/artifacts/art_missing", json={"name": ""})
        assert response.status_code in (404, 422)
        assert "code" in response.json()


class TestServeFrontend:
    def test_static_hosting_and_spa_fallback(self, tmp_path):
        """占位 dist 验证：静态资源命中 + 非 API 深链回退 index.html。"""
        dist = tmp_path / "dist"
        dist.mkdir()
        (dist / "index.html").write_text("<html>audio-studio</html>", encoding="utf-8")
        (dist / "assets").mkdir()
        (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")

        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from app.main import SPAStaticFiles

        application = FastAPI()
        application.mount("/", SPAStaticFiles(directory=dist, html=True), name="frontend")
        with TestClient(application) as test_client:
            # 静态资源命中
            assert test_client.get("/assets/app.js").status_code == 200
            # 深链（SPA 路由）回退 index.html
            deep_link = test_client.get("/meditation/conv_123")
            assert deep_link.status_code == 200
            assert "audio-studio" in deep_link.text
