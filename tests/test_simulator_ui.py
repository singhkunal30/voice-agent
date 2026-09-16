"""Tests for serving the Architecture Simulator UI from the FastAPI app.

These exercise `app/simulator_ui.py` directly rather than through `create_app`,
so they do not pull in the pipecat voice stack.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import simulator_ui
from app.simulator_ui import MOUNT_PATH, mount_simulator, simulator_is_built


def test_mount_path_is_lab():
    assert MOUNT_PATH == "/lab"


def test_returns_helpful_503_when_not_built(tmp_path, monkeypatch):
    monkeypatch.setattr(simulator_ui, "SIMULATOR_DIST", tmp_path / "nowhere")
    app = FastAPI()
    mounted = mount_simulator(app)
    assert mounted is False

    client = TestClient(app)
    resp = client.get("/lab")
    assert resp.status_code == 503
    body = resp.json()
    assert "not been built" in body["detail"]
    # The error tells you exactly how to fix it.
    assert "npm run build" in body["build_it_with"]


def test_serves_index_and_assets_when_built(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text('<!doctype html><div id="root"></div>')
    (dist / "assets" / "app-abc123.js").write_text("console.log(1)")

    monkeypatch.setattr(simulator_ui, "SIMULATOR_DIST", dist)
    app = FastAPI()
    assert mount_simulator(app) is True

    client = TestClient(app)
    index = client.get("/lab/")
    assert index.status_code == 200
    assert 'id="root"' in index.text

    asset = client.get("/lab/assets/app-abc123.js")
    assert asset.status_code == 200
    assert asset.text == "console.log(1)"


def test_mounting_does_not_shadow_existing_routes(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html></html>")
    monkeypatch.setattr(simulator_ui, "SIMULATOR_DIST", dist)

    app = FastAPI()

    @app.get("/healthz")
    async def healthz():
        return {"status": "ok"}

    mount_simulator(app)
    client = TestClient(app)
    assert client.get("/healthz").json() == {"status": "ok"}


def test_simulator_is_built_reflects_the_filesystem(tmp_path, monkeypatch):
    monkeypatch.setattr(simulator_ui, "SIMULATOR_DIST", tmp_path)
    assert simulator_is_built() is False
    (tmp_path / "index.html").write_text("<html></html>")
    assert simulator_is_built() is True


def test_default_dist_path_points_at_the_simulator_package():
    # Guards against the relative-path arithmetic drifting if files move.
    assert simulator_ui.SIMULATOR_DIST.name == "dist"
    assert simulator_ui.SIMULATOR_DIST.parent.name == "simulator"
    repo_root = Path(__file__).resolve().parent.parent
    assert simulator_ui.SIMULATOR_DIST.parent.parent == repo_root


@pytest.mark.parametrize("path", ["/lab/", "/lab/index.html"])
def test_spa_entry_points_resolve(tmp_path, monkeypatch, path):
    """The app uses hash routing, so every in-app route loads this one file."""
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text('<!doctype html><div id="root"></div>')
    monkeypatch.setattr(simulator_ui, "SIMULATOR_DIST", dist)

    app = FastAPI()
    mount_simulator(app)
    resp = TestClient(app).get(path)
    assert resp.status_code == 200
    assert 'id="root"' in resp.text
