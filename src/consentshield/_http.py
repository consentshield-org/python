"""ADR-1006 Phase 2 Sprint 2.1 — HTTP transport.

Sync + async helpers built on httpx. Single source for the compliance-
load-bearing rules the Node SDK encodes: 2-second default timeout,
exponential-backoff retry on 5xx + transport errors, never retries
4xx, never retries timeouts.

Each public method on ``ConsentShieldClient`` / ``AsyncConsentShieldClient``
delegates to ``HttpClient.request`` / ``AsyncHttpClient.request`` —
both share the same ``HttpRequest`` shape + return ``HttpResponse``.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import (
    Any,
    Awaitable,
    Callable,
    Generic,
    Mapping,
    Optional,
    TypeVar,
    Union,
)

import httpx

from .errors import (
    ConsentShieldApiError,
    ConsentShieldNetworkError,
    ConsentShieldTimeoutError,
    ProblemJson,
)

TRACE_ID_HEADER = "X-CS-Trace-Id"

T = TypeVar("T")

# Backoff: 100 ms, 400 ms, 1 600 ms — bounded so even max_retries=3
# stays within ~2 s of cumulative wait, matching the Node SDK exactly.
def _backoff_seconds(attempt: int) -> float:
    return float(0.1 * (4 ** attempt))


HttpMethod = str  # "GET" | "POST" | "PATCH" | "DELETE"
QueryValue = Union[str, int, bool, None]


@dataclass
class HttpRequest:
    """Single HTTP request envelope passed into ``HttpClient.request``.

    Per-call ``timeout_ms`` overrides are NOT exposed — the SDK owns
    the timeout budget per the v2 whitepaper §5.4 compliance posture.
    Per-call ``trace_id`` IS exposed (caller-supplied; round-trips via
    ``X-CS-Trace-Id``).
    """

    method: HttpMethod
    path: str  # "/consent/verify" — leading slash required, no /v1 prefix
    body: Any = None
    query: Mapping[str, QueryValue] = field(default_factory=dict)
    trace_id: Optional[str] = None


@dataclass
class HttpResponse(Generic[T]):
    status: int
    body: T
    trace_id: Optional[str] = None


def _build_url(base_url: str, path: str, query: Mapping[str, QueryValue]) -> str:
    base = base_url.rstrip("/")
    leading = path if path.startswith("/") else f"/{path}"
    url = f"{base}/v1{leading}"
    # Skip None values (matches the Node SDK semantics — False/0 still
    # serialise normally).
    pairs: list[tuple[str, str]] = [
        (k, str(v)) for k, v in query.items() if v is not None
    ]
    if pairs:
        # httpx.QueryParams overload accepts list[tuple[str, str]] but
        # the stub's union is invariant; cast through Any.
        from typing import Any as _Any

        params: _Any = pairs
        url = f"{url}?{httpx.QueryParams(params)}"
    return url


def _parse_problem(resp: httpx.Response) -> Optional[ProblemJson]:
    ctype = resp.headers.get("content-type", "")
    if "json" not in ctype:
        return None
    try:
        parsed = resp.json()
    except (ValueError, httpx.DecodingError):
        return None
    if isinstance(parsed, dict):
        return parsed
    return None


def _build_headers(api_key: str, has_body: bool, trace_id: Optional[str]) -> dict[str, str]:
    headers: dict[str, str] = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }
    if has_body:
        headers["Content-Type"] = "application/json"
    if trace_id:
        headers[TRACE_ID_HEADER] = trace_id
    return headers


def _decode_success(resp: httpx.Response) -> Any:
    if resp.status_code == 204:
        return None
    ctype = resp.headers.get("content-type", "")
    if "json" in ctype:
        return resp.json()
    return resp.text


# ─────────────────────────────────────────────────────────────────────
# Sync transport
# ─────────────────────────────────────────────────────────────────────


class HttpClient:
    """Sync HTTP transport. Reuses one ``httpx.Client`` for the lifetime
    of the wrapping ``ConsentShieldClient``.

    Safe to share across threads — ``httpx.Client`` documents this.
    Fluid Compute / serverless callers should construct one per
    cold-start and reuse across requests.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        timeout_ms: int,
        max_retries: int,
        client: Optional[httpx.Client] = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._base_url = base_url
        self._api_key = api_key
        self._timeout_ms = timeout_ms
        self._max_retries = max_retries
        self._sleep = sleep
        self._client = client or httpx.Client(
            timeout=httpx.Timeout(timeout_ms / 1000.0)
        )
        self._owns_client = client is None

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "HttpClient":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def request(self, req: HttpRequest) -> HttpResponse[Any]:
        url = _build_url(self._base_url, req.path, req.query)
        headers = _build_headers(self._api_key, req.body is not None, req.trace_id)
        body_kwargs: dict[str, Any] = {}
        if req.body is not None:
            body_kwargs["json"] = req.body

        last_error: Optional[BaseException] = None
        for attempt in range(self._max_retries + 1):
            try:
                resp = self._client.request(
                    req.method, url, headers=headers, **body_kwargs
                )
            except httpx.TimeoutException as err:
                # Don't retry timeouts — second attempt would compound
                # latency past the compliance budget.
                raise ConsentShieldTimeoutError(self._timeout_ms) from err
            except httpx.HTTPError as err:
                last_error = ConsentShieldNetworkError(str(err), cause=err)
                if attempt < self._max_retries:
                    self._sleep(_backoff_seconds(attempt))
                    continue
                raise last_error from err

            trace_id = resp.headers.get(TRACE_ID_HEADER) or None

            # 5xx → retry with backoff (server might be transiently
            # overloaded).
            if 500 <= resp.status_code < 600:
                problem = _parse_problem(resp)
                last_error = ConsentShieldApiError(
                    resp.status_code, problem, trace_id=trace_id
                )
                if attempt < self._max_retries:
                    self._sleep(_backoff_seconds(attempt))
                    continue
                raise last_error

            # 4xx → never retry. Caller bug or auth/scope problem.
            if resp.status_code >= 400:
                problem = _parse_problem(resp)
                raise ConsentShieldApiError(
                    resp.status_code, problem, trace_id=trace_id
                )

            return HttpResponse(
                status=resp.status_code,
                body=_decode_success(resp),
                trace_id=trace_id,
            )

        # Loop exhausted. Should be unreachable thanks to raises above,
        # but mypy needs it + paranoia is cheap.
        if last_error is not None:
            raise last_error
        raise ConsentShieldNetworkError("request failed without a captured error")


# ─────────────────────────────────────────────────────────────────────
# Async transport
# ─────────────────────────────────────────────────────────────────────


async def _default_async_sleep(seconds: float) -> None:
    await asyncio.sleep(seconds)


class AsyncHttpClient:
    """Async HTTP transport. Reuses one ``httpx.AsyncClient`` for the
    lifetime of the wrapping ``AsyncConsentShieldClient``.

    Use as ``async with AsyncConsentShieldClient(...) as client``, or
    call ``await client.aclose()`` in your shutdown hook.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        timeout_ms: int,
        max_retries: int,
        client: Optional[httpx.AsyncClient] = None,
        sleep: Callable[[float], Awaitable[None]] = _default_async_sleep,
    ) -> None:
        self._base_url = base_url
        self._api_key = api_key
        self._timeout_ms = timeout_ms
        self._max_retries = max_retries
        self._sleep = sleep
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_ms / 1000.0)
        )
        self._owns_client = client is None

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self) -> "AsyncHttpClient":
        return self

    async def __aexit__(self, *_args: object) -> None:
        await self.aclose()

    async def request(self, req: HttpRequest) -> HttpResponse[Any]:
        url = _build_url(self._base_url, req.path, req.query)
        headers = _build_headers(self._api_key, req.body is not None, req.trace_id)
        body_kwargs: dict[str, Any] = {}
        if req.body is not None:
            body_kwargs["json"] = req.body

        last_error: Optional[BaseException] = None
        for attempt in range(self._max_retries + 1):
            try:
                resp = await self._client.request(
                    req.method, url, headers=headers, **body_kwargs
                )
            except httpx.TimeoutException as err:
                raise ConsentShieldTimeoutError(self._timeout_ms) from err
            except httpx.HTTPError as err:
                last_error = ConsentShieldNetworkError(str(err), cause=err)
                if attempt < self._max_retries:
                    await self._sleep(_backoff_seconds(attempt))
                    continue
                raise last_error from err

            trace_id = resp.headers.get(TRACE_ID_HEADER) or None

            if 500 <= resp.status_code < 600:
                problem = _parse_problem(resp)
                last_error = ConsentShieldApiError(
                    resp.status_code, problem, trace_id=trace_id
                )
                if attempt < self._max_retries:
                    await self._sleep(_backoff_seconds(attempt))
                    continue
                raise last_error

            if resp.status_code >= 400:
                problem = _parse_problem(resp)
                raise ConsentShieldApiError(
                    resp.status_code, problem, trace_id=trace_id
                )

            return HttpResponse(
                status=resp.status_code,
                body=_decode_success(resp),
                trace_id=trace_id,
            )

        if last_error is not None:
            raise last_error
        raise ConsentShieldNetworkError("request failed without a captured error")


__all__ = [
    "HttpClient",
    "AsyncHttpClient",
    "HttpRequest",
    "HttpResponse",
    "TRACE_ID_HEADER",
]
