using System;

namespace ConsentShield.Client.AspNetCore;

/// <summary>
/// Configuration options for the ConsentShield ASP.NET Core integration.
/// Bound from the <c>ConsentShield</c> section of <c>IConfiguration</c> by
/// <see cref="ServiceCollectionExtensions"/>.
/// </summary>
public sealed class ConsentShieldOptions
{
    /// <summary>API key prefixed with <c>cs_live_</c>. Required.</summary>
    public string? ApiKey { get; set; }

    /// <summary>API base URL. Defaults to <c>https://api.consentshield.in/v1</c>.</summary>
    public string BaseUrl { get; set; } = "https://api.consentshield.in/v1";

    /// <summary>Per-attempt timeout. Defaults to 2 seconds.</summary>
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(2);

    /// <summary>Max retries on 5xx and transport failure. Defaults to 3.</summary>
    public int MaxRetries { get; set; } = 3;

    /// <summary>
    /// If true, verify failures (5xx / network / timeout) return a fail-OPEN
    /// outcome rather than throwing <see cref="ConsentVerifyException"/>.
    /// Defaults to false (fail-CLOSED), matching the Tier-1 SDKs.
    /// </summary>
    public bool FailOpen { get; set; } = false;
}
