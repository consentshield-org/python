using System;

namespace ConsentShield.Client.AspNetCore;

/// <summary>
/// Thrown when a request exceeds the per-attempt timeout. Timeouts are NEVER
/// retried — burning the retry budget on more timeouts just delays the
/// inevitable failure.
/// </summary>
public sealed class ConsentShieldTimeoutException : ConsentShieldException
{
    public ConsentShieldTimeoutException(string message, Exception? innerException, string? traceId)
        : base(message, innerException, traceId)
    {
    }
}
