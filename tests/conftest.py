import os

# Twilio auth token doubles as the inbound-signature key and outbound
# REST credential. The outbound endpoint also needs its own bearer.
os.environ.setdefault("TWILIO_ACCOUNT_SID", "ACtest0000000000000000000000000000")
os.environ.setdefault("TWILIO_AUTH_TOKEN", "twilio-test-token")
os.environ.setdefault("TWILIO_FROM_NUMBER", "+15551230000")
os.environ.setdefault("PUBLIC_BASE_URL", "https://test.example.com")
os.environ.setdefault("OUTBOUND_API_KEY", "outbound-test-token")

# Voice services don't get called in tests (the pipeline is exercised
# only at runtime), but config.py expects strings.
os.environ.setdefault("DEEPGRAM_API_KEY", "dg-test")
os.environ.setdefault("ELEVENLABS_API_KEY", "el-test")
os.environ.setdefault("OPENAI_API_KEY", "oa-test")
