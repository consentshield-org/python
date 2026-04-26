using System.Collections.Generic;

namespace ConsentShield.Client.AspNetCore;

/// <summary>
/// Thrown when the ConsentShield API returns a 4xx response.
/// 4xx responses ALWAYS surface — they are never retried, never folded into
/// fail-OPEN handling.
/// </summary>
public sealed class ConsentShieldApiException : ConsentShieldException
{
    public int Status { get; }
    public string? Type { get; }
    public string? Title { get; }
    public string? Detail { get; }
    public string? Instance { get; }
    public IReadOnlyDictionary<string, object?> Extensions { get; }

    public ConsentShieldApiException(
        int status,
        string? type,
        string? title,
        string? detail,
        string? instance,
        string? traceId,
        IReadOnlyDictionary<string, object?>? extensions = null)
        : base(BuildMessage(status, title, detail), traceId)
    {
        Status = status;
        Type = type;
        Title = title;
        Detail = detail;
        Instance = instance;
        Extensions = extensions ?? new Dictionary<string, object?>();
    }

    private static string BuildMessage(int status, string? title, string? detail)
    {
        return $"ConsentShield API error: status={status}"
               + (string.IsNullOrEmpty(title) ? "" : $" title={title}")
               + (string.IsNullOrEmpty(detail) ? "" : $" detail={detail}");
    }
}
