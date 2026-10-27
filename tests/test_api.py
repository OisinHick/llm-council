import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_settings_endpoints():
    with tempfile.TemporaryDirectory() as tmp_dir:
        fake_settings = Path(tmp_dir) / "settings.json"
        with patch("backend.config.SETTINGS_FILE", fake_settings):
            # GET
            r_get = client.get("/api/settings")
            assert r_get.status_code == 200

            # POST update
            r_post = client.post(
                "/api/settings",
                json={"show_token_count": False, "assistant_color": "#123456"},
            )
            assert r_post.status_code == 200
            data = r_post.json()
            assert data["success"] is True
            assert data["settings"]["show_token_count"] is False
            assert data["settings"]["assistant_color"] == "#123456"


def test_conversation_lifecycle_endpoints():
    with tempfile.TemporaryDirectory() as tmp_dir:
        data_dir = Path(tmp_dir) / "conversations"
        with patch("backend.storage.DATA_DIR", str(data_dir)):
            # 1. Create conversation
            res_create = client.post(
                "/api/conversations", json={"mode": "informational"}
            )
            assert res_create.status_code == 200
            conv_id = res_create.json()["id"]

            # 2. List conversations
            res_list = client.get("/api/conversations")
            assert res_list.status_code == 200
            assert len(res_list.json()) == 1

            # 3. Get conversation
            res_get = client.get(f"/api/conversations/{conv_id}")
            assert res_get.status_code == 200
            assert res_get.json()["id"] == conv_id

            # 4. Patch mode
            res_mode = client.patch(
                f"/api/conversations/{conv_id}/mode", json={"mode": "agentic"}
            )
            assert res_mode.status_code == 200
            assert res_mode.json()["mode"] == "agentic"

            # 5. Delete conversation
            res_del = client.delete(f"/api/conversations/{conv_id}")
            assert res_del.status_code == 200
            assert res_del.json()["success"] is True


def test_compression_endpoints():
    # Preview
    preview_req = {
        "messages": [
            {
                "role": "user",
                "content": "Certainly! I would be happy to help with this question:\n\n\nHere is lots of text to compress.",
            }
        ],
        "algorithm": "heuristic",
    }
    res_prev = client.post("/api/compression/preview", json=preview_req)
    assert res_prev.status_code == 200
    assert res_prev.json()["success"] is True

    # Stats
    res_stats = client.get("/api/compression/stats")
    assert res_stats.status_code == 200
    assert res_stats.json()["success"] is True

    # Reset
    res_reset = client.post("/api/compression/reset-stats")
    assert res_reset.status_code == 200
    assert res_reset.json()["success"] is True
