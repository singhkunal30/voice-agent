"""Environment-driven configuration.

All secrets and tunable knobs live here. Anything that varies between
environments must come from an environment variable, never a literal.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    vapi_server_secret: str = Field(
        default="",
        description="Shared secret Vapi sends back to authenticate webhooks.",
    )
    vapi_hmac_enabled: bool = False
    vapi_hmac_secret: str = ""
    vapi_hmac_header: str = "x-vapi-signature"

    vapi_api_key: str = ""
    vapi_api_base: str = "https://api.vapi.ai"
    vapi_phone_number_id: str = ""

    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"

    webhook_rate_limit: str = "120/minute"

    external_call_timeout_s: float = 5.0


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
