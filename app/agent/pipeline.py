"""Pipecat pipeline factory for a Twilio Media Streams call.

The pipeline:
    Twilio WSS (mu-law @ 8kHz)
      -> FastAPIWebsocketTransport.input + TwilioFrameSerializer
      -> Silero VAD (turn detection + barge-in)
      -> Deepgram streaming STT
      -> OpenAILLMContext aggregator (user turn)
      -> OpenAI LLM (gpt-4o-mini) with tool calling
      -> Tool bridge -> ToolRegistry -> Supabase / in-memory
      -> ElevenLabs streaming TTS
      -> FastAPIWebsocketTransport.output -> Twilio WSS
      -> Context aggregator (assistant turn)

One pipeline per call. Lifecycle is owned by the FastAPI WebSocket
handler in `app/transport/twilio_inbound.py`.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import WebSocket
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

from ..config import Settings
from ..tools import ToolRegistry
from .prompts import load_system_prompt
from .tools_bridge import build_tools_schema, register_tools

log = logging.getLogger(__name__)

# Twilio Media Streams are mu-law at 8 kHz. We resample inside the
# voice services rather than at the transport so the LLM/TTS can run
# at higher fidelity natively.
_TWILIO_SAMPLE_RATE = 8000

_FIRST_GREETING = (
    "Hi, thanks for calling Acme. I can help you check an order or "
    "book an appointment — which would you like?"
)


async def run_call(
    *,
    websocket: WebSocket,
    stream_sid: str,
    call_sid: str,
    settings: Settings,
    registry: ToolRegistry,
) -> None:
    """Drive a single call from start to finish.

    Returns when the call ends (either side disconnects). Exceptions
    propagate; the WebSocket handler logs them and closes the socket.
    """
    serializer = TwilioFrameSerializer(
        stream_sid=stream_sid,
        call_sid=call_sid,
        account_sid=settings.twilio_account_sid or None,
        auth_token=settings.twilio_auth_token or None,
    )

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=_TWILIO_SAMPLE_RATE,
            audio_out_sample_rate=_TWILIO_SAMPLE_RATE,
            add_wav_header=False,
            vad_analyzer=SileroVADAnalyzer(),
            serializer=serializer,
        ),
    )

    stt = DeepgramSTTService(api_key=settings.deepgram_api_key)
    tts = ElevenLabsTTSService(
        api_key=settings.elevenlabs_api_key,
        voice_id=settings.elevenlabs_voice_id,
        model=settings.elevenlabs_model,
    )
    llm = OpenAILLMService(
        api_key=settings.openai_api_key,
        model=settings.openai_model,
    )

    # Tools: the LLM sees the schema, our registry executes the calls.
    tools_schema = build_tools_schema()
    register_tools(llm, registry, call_id=call_sid)

    context = OpenAILLMContext(
        messages=[{"role": "system", "content": load_system_prompt()}],
        tools=tools_schema,
    )
    context_aggregator = llm.create_context_aggregator(context)

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            context_aggregator.user(),
            llm,
            tts,
            transport.output(),
            context_aggregator.assistant(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,
            enable_metrics=True,
        ),
    )

    @transport.event_handler("on_client_connected")
    async def _on_connect(_transport: Any, _client: Any) -> None:
        # Seed the conversation with a greeting so the caller hears
        # something within ~1s of pickup — otherwise we wait for them
        # to speak first, which feels broken on inbound calls.
        await task.queue_frames(
            [
                context_aggregator.user().get_context_frame(),
            ]
        )
        # Queue the literal greeting through the TTS path so it's
        # spoken without going through the LLM (saves a round-trip).
        from pipecat.frames.frames import TTSSpeakFrame

        await task.queue_frame(TTSSpeakFrame(_FIRST_GREETING))

    @transport.event_handler("on_client_disconnected")
    async def _on_disconnect(_transport: Any, _client: Any) -> None:
        await task.cancel()

    log.info(
        "call pipeline starting",
        extra={"call_sid": call_sid, "stream_sid": stream_sid},
    )
    runner = PipelineRunner(handle_sigint=False)
    await runner.run(task)
    log.info("call pipeline ended", extra={"call_sid": call_sid})
