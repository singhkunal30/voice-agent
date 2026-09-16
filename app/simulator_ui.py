"""Serve the Voice Agent Architecture Simulator from the FastAPI app.

The simulator is a self-contained client-side application (see `simulator/`):
the deterministic simulation engine runs entirely in the browser, so this
module only ever serves static files — there is no simulator API, no keys and
no server-side state.

The mount is conditional. If `simulator/dist` has not been built the app starts
exactly as before and `/lab` simply does not exist; the voice agent itself is
unaffected either way.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

log = logging.getLogger(__name__)

# repo_root/app/simulator_ui.py -> repo_root/simulator/dist
SIMULATOR_DIST = Path(__file__).resolve().parent.parent / "simulator" / "dist"

MOUNT_PATH = "/lab"


def simulator_is_built() -> bool:
    return (SIMULATOR_DIST / "index.html").is_file()


def mount_simulator(app: FastAPI) -> bool:
    """Mount the built simulator at /lab. Returns True when it was mounted.

    The app uses hash-based routing, so every in-app route resolves to the same
    index.html and no server-side rewrite rules are needed.
    """
    if not simulator_is_built():
        log.info(
            "simulator UI not mounted (not built)",
            extra={"expected_path": str(SIMULATOR_DIST)},
        )

        @app.get(MOUNT_PATH, include_in_schema=False)
        async def _simulator_not_built() -> JSONResponse:
            return JSONResponse(
                status_code=503,
                content={
                    "detail": "Simulator UI has not been built.",
                    "build_it_with": "cd simulator && npm install && npm run build",
                },
            )

        return False

    # `html=True` serves index.html for the mount root.
    app.mount(
        MOUNT_PATH,
        StaticFiles(directory=str(SIMULATOR_DIST), html=True),
        name="simulator",
    )

    @app.get("/lab/", include_in_schema=False)
    async def _simulator_index() -> FileResponse:
        return FileResponse(SIMULATOR_DIST / "index.html")

    log.info("simulator UI mounted", extra={"path": MOUNT_PATH})
    return True
