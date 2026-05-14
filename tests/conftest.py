import os

# Provide a deterministic secret for tests that use the webhook.
os.environ.setdefault("VAPI_SERVER_SECRET", "test-secret")
os.environ.setdefault("VAPI_HMAC_ENABLED", "false")
