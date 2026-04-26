using System;

namespace ConsentShield.Client.AspNetCore;

/// <summary>
/// Base type for every exception thrown by the ConsentShield ASP.NET Core
/// integration. Concrete subtypes preserve the server-side trace id when
/// available so callers can correlate failures across the wire.
/// </summary>
public abstract class ConsentShieldException : Exception
{
    public string? TraceId { get; }

    protected ConsentShieldException(string message, string? traceId)
        : base(message)
    {
        TraceId = traceId;
    }

    protected ConsentShieldException(string message, Exception? innerException, string? traceId)
        : base(message, innerException)
    {
        TraceId = traceId;
    }
}
