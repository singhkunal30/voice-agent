"""Async PostgREST client for Supabase.

A minimal wrapper around httpx aimed at our two use cases: looking up
a single order and inserting/selecting appointments. We hand-roll it
instead of pulling in `supabase-py` because:

  * `supabase-py` is sync; the rest of the service is async.
  * We only need three verbs (select, insert, select-by-key), so the
    extra surface area isn't worth the dependency footprint.

Refs:
  * https://postgrest.org/en/stable/references/api.html
  * https://supabase.com/docs/guides/api

Use the service-role key. The anon key won't get past RLS for writes.
"""

from __future__ import annotations

from typing import Any, Optional

import httpx


class PostgresError(Exception):
    """A non-2xx response from PostgREST.

    Carries the SQLSTATE `code` (e.g. "23505" for unique violation) and
    the constraint detail so callers can distinguish, say, an
    idempotency-key collision from a slot collision.
    """

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: str,
    ):
        super().__init__(message or f"postgrest {status}")
        self.status = status
        self.code = code
        self.message = message
        self.details = details

    @property
    def is_unique_violation(self) -> bool:
        return self.code == "23505"


class SupabaseClient:
    """Thin async PostgREST client."""

    def __init__(
        self,
        url: str,
        service_role_key: str,
        timeout_s: float = 5.0,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        if not url or not service_role_key:
            raise RuntimeError(
                "SupabaseClient requires both url and service_role_key"
            )
        base = f"{url.rstrip('/')}/rest/v1"
        self._http = httpx.AsyncClient(
            base_url=base,
            headers={
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=timeout_s,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    @staticmethod
    def _raise_for_status(r: httpx.Response) -> None:
        if r.is_success:
            return
        body: dict[str, Any] = {}
        try:
            body = r.json()
        except ValueError:
            pass
        raise PostgresError(
            status=r.status_code,
            code=str(body.get("code", "") or ""),
            message=str(body.get("message", "") or r.text),
            details=str(body.get("details", "") or ""),
        )

    async def select(
        self,
        table: str,
        *,
        filters: Optional[dict[str, str]] = None,
        columns: str = "*",
        limit: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, str] = {"select": columns}
        if filters:
            params.update(filters)
        if limit is not None:
            params["limit"] = str(limit)
        r = await self._http.get(f"/{table}", params=params)
        self._raise_for_status(r)
        return r.json()

    async def select_one(
        self,
        table: str,
        *,
        filters: dict[str, str],
        columns: str = "*",
    ) -> Optional[dict[str, Any]]:
        rows = await self.select(table, filters=filters, columns=columns, limit=1)
        return rows[0] if rows else None

    async def insert(
        self,
        table: str,
        row: dict[str, Any],
    ) -> dict[str, Any]:
        """Insert one row and return it (with server-side defaults filled in)."""
        r = await self._http.post(
            f"/{table}",
            json=row,
            headers={"Prefer": "return=representation"},
        )
        self._raise_for_status(r)
        data = r.json()
        if not data:
            raise PostgresError(
                status=r.status_code,
                code="",
                message="insert returned no rows",
                details="",
            )
        return data[0]
