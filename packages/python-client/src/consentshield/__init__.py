"""ADR-1006 Phase 2 — `consentshield` Python SDK public surface.

Sprint 2.1 (THIS) ships the full method surface for both sync
``ConsentShieldClient`` and async ``AsyncConsentShieldClient``.
Sprint 2.2 will add Django / Flask / FastAPI integration examples
and PyPI publication tooling.
"""

from __future__ import annotations

__version__ = "1.0.0"

from .async_client import AsyncConsentShieldClient, AsyncFailOpenCallback
from .client import ConsentShieldClient, FailOpenCallback
from .errors import (
    ConsentShieldApiError,
    ConsentShieldError,
    ConsentShieldNetworkError,
    ConsentShieldTimeoutError,
    ConsentVerifyError,
    ProblemJson,
)
from ._verify import is_open_failure
from .types import (
    ArtefactDetail,
    ArtefactListEnvelope,
    ArtefactListItem,
    ArtefactRevocation,
    AuditLogEnvelope,
    AuditLogItem,
    DeletionActorType,
    DeletionReason,
    DeletionReceiptRow,
    DeletionReceiptsEnvelope,
    DeletionTriggerEnvelope,
    EventListEnvelope,
    EventListItem,
    IdentifierType,
    OpenFailureCause,
    OpenFailureEnvelope,
    RecordedArtefact,
    RecordEnvelope,
    RevokeActorType,
    RevokeEnvelope,
    RightsCapturedVia,
    RightsRequestCreatedEnvelope,
    RightsRequestItem,
    RightsRequestListEnvelope,
    RightsRequestStatus,
    RightsRequestType,
    VerifyBatchEnvelope,
    VerifyBatchOutcome,
    VerifyBatchResultRow,
    VerifyEnvelope,
    VerifyOutcome,
    VerifyStatus,
)

__all__ = [
    "__version__",
    # Clients
    "ConsentShieldClient",
    "AsyncConsentShieldClient",
    # Errors
    "ConsentShieldError",
    "ConsentShieldApiError",
    "ConsentShieldNetworkError",
    "ConsentShieldTimeoutError",
    "ConsentVerifyError",
    "ProblemJson",
    # Callback types
    "FailOpenCallback",
    "AsyncFailOpenCallback",
    # Helpers
    "is_open_failure",
    # Wire-format envelopes
    "ArtefactDetail",
    "ArtefactListEnvelope",
    "ArtefactListItem",
    "ArtefactRevocation",
    "AuditLogEnvelope",
    "AuditLogItem",
    "DeletionActorType",
    "DeletionReason",
    "DeletionReceiptRow",
    "DeletionReceiptsEnvelope",
    "DeletionTriggerEnvelope",
    "EventListEnvelope",
    "EventListItem",
    "IdentifierType",
    "OpenFailureCause",
    "OpenFailureEnvelope",
    "RecordedArtefact",
    "RecordEnvelope",
    "RevokeActorType",
    "RevokeEnvelope",
    "RightsCapturedVia",
    "RightsRequestCreatedEnvelope",
    "RightsRequestItem",
    "RightsRequestListEnvelope",
    "RightsRequestStatus",
    "RightsRequestType",
    "VerifyBatchEnvelope",
    "VerifyBatchOutcome",
    "VerifyBatchResultRow",
    "VerifyEnvelope",
    "VerifyOutcome",
    "VerifyStatus",
]
