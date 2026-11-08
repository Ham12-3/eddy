"""Request limits for maths-core, as plain ASGI middleware.

The body is counted as it arrives, not trusted from the Content-Length header, so a chunked or
mislabelled request cannot carry more than MAX_BODY_BYTES into JSON parsing.
"""

import re
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

MAX_BODY_BYTES = 64 * 1024
_LENGTH = re.compile(r"[0-9]{1,7}")


class BodyTooLargeError(Exception):
    pass


async def _reply(send: Send, status: int, detail: str) -> None:
    body = ('{"detail":"' + detail + '"}').encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", b"%d" % len(body)),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class BodyLimit:
    """Refuses bodies over MAX_BODY_BYTES (413), and refuses a request that sends both
    Transfer-Encoding and Content-Length, or an unreadable Content-Length (400)."""

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {name.lower(): value for name, value in scope.get("headers", [])}
        declared = headers.get(b"content-length")
        if declared is not None and b"transfer-encoding" in headers:
            await _reply(send, 400, "Send Content-Length or Transfer-Encoding, not both.")
            return
        if declared is not None:
            if not _LENGTH.fullmatch(declared.decode("latin-1")):
                await _reply(send, 400, "Content-Length is not a number.")
                return
            if int(declared) > self.max_bytes:
                await _reply(send, 413, "Request too large.")
                return

        received = 0
        started = False

        async def counted_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise BodyTooLargeError
            return message

        async def tracked_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counted_receive, tracked_send)
        except BodyTooLargeError:
            if not started:
                await _reply(send, 413, "Request too large.")
