"""E2E 控制面只在显式 E2E_MODE 下可用。"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.main import create_app
from conftest import make_settings


def test_e2e_routes_are_absent_by_default(client: TestClient):
    assert client.get("/api/_e2e/audio.wav").status_code == 404
    assert client.post("/api/_e2e/run-control", json={"kind": "demo"}).status_code == 404


def test_e2e_failure_is_consumed_once(tmp_path):
    app = create_app(settings=make_settings(tmp_path, e2e_mode=True))
    with TestClient(app) as client:
        fixture = client.get("/api/_e2e/audio.wav")
        assert fixture.status_code == 200
        assert fixture.headers["content-type"] == "audio/wav"

        armed = client.post(
            "/api/_e2e/run-control",
            json={
                "kind": "demo",
                "failure_code": "E2E_EXPECTED_FAILURE",
                "failure_message": "受控失败",
            },
        )
        assert armed.status_code == 200

        first = client.post("/api/demo/jobs").json()["run_id"]
        second = client.post("/api/demo/jobs").json()["run_id"]

        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            first_run = client.get(f"/api/runs/{first}").json()
            second_run = client.get(f"/api/runs/{second}").json()
            if first_run["status"] == "failed" and second_run["status"] == "completed":
                break
            time.sleep(0.02)

        assert first_run["error"] == {
            "code": "E2E_EXPECTED_FAILURE",
            "message": "受控失败",
        }
        assert second_run["status"] == "completed"
