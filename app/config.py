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

    # --- Twilio (PSTN + audio transport) ---
    twilio_account_sid: str = ""
    twilio_auth_token: str = Field(
        default="",
        description=(
            "Used both to sign outbound REST calls AND to verify the "
            "X-Twilio-Signature on inbound webhooks."
        ),
    )
    # The Twilio number that places outbound calls (E.164 format).
    twilio_from_number: str = ""
    # Public HTTPS base URL of this service — Twilio dials/streams need
    # an absolute URL pointing back at us. e.g. https://abc.ngrok.app
    public_base_url: str = ""

    # --- Voice services ---
    deepgram_api_key: str = ""
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = "EXAVITQu4vr4xnSDxMaA"  # ElevenLabs "Sarah"
    elevenlabs_model: str = "eleven_turbo_v2_5"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # --- Server ---
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"

    webhook_rate_limit: str = "120/minute"
    outbound_rate_limit: str = "30/minute"

    external_call_timeout_s: float = 5.0
    twilio_api_timeout_s: float = 10.0

    # Bearer credential required to trigger an outbound call via
    # `POST /outbound/call`. Server-internal credential; not a
    # Twilio secret.
    outbound_api_key: str = ""

    # --- Supabase ---
    supabase_url: str = ""
    supabase_service_role_key: str = ""


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
