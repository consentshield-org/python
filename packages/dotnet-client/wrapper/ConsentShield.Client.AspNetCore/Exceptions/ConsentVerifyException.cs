using System;

namespace ConsentShield.Client.AspNetCore;

/// <summary>
/// Compliance-critical wrap thrown by verify calls when the SDK is fail-CLOSED
/// (the default) and the upstream cannot be reached after the retry budget is
/// exhausted (5xx, transport failure, or per-attempt timeout). 4xx responses
/// are never wrapped here; they always surface as
/// <see cref="ConsentShieldApiException"/>.
/// </summary>
public sealed class ConsentVerifyException : ConsentShieldException
{
    public VerifyFailureCause Cause { get; }

    public ConsentVerifyException(VerifyFailureCause cause, string message, Exception? innerException, string? traceId)
        : base(message, innerException, traceId)
    {
        Cause = cause;
    }
}

public enum VerifyFailureCause
{
    /// <summary>Upstream returned 5xx after retries were exhausted.</summary>
    ServerError,
    /// <summary>Per-attempt timeout — never retried.</summary>
    Timeout,
    /// <summary>Transport failure (connection refused, DNS, TLS).</summary>
    Network,
}
