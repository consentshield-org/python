using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace ConsentShield.Client.AspNetCore;

/// <summary>
/// <see cref="DelegatingHandler"/> implementing the ConsentShield retry contract:
/// <list type="bullet">
///   <item>Up to <c>maxRetries</c> retries on 5xx and on transport
///         <see cref="HttpRequestException"/>.</item>
///   <item>Backoff: 100 ms, 400 ms, 1600 ms (exponential, base 4).</item>
///   <item>NEVER retries 4xx — those surface as the FIRST attempt's response.</item>
///   <item>NEVER retries per-attempt timeout
///         (<see cref="TaskCanceledException"/> / <see cref="OperationCanceledException"/>
///         when the user-supplied <see cref="CancellationToken"/> is NOT cancelled).</item>
/// </list>
/// </summary>
public sealed class RetryHandler : DelegatingHandler
{
    private static readonly int[] BackoffMs = { 100, 400, 1600 };
    private readonly int _maxRetries;

    public RetryHandler(int maxRetries)
    {
        if (maxRetries < 0 || maxRetries > BackoffMs.Length)
        {
            throw new ArgumentOutOfRangeException(
                nameof(maxRetries),
                maxRetries,
                $"maxRetries must be 0..{BackoffMs.Length}");
        }
        _maxRetries = maxRetries;
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        HttpResponseMessage? lastResponse = null;
        Exception? lastTransportException = null;

        for (int attempt = 0; attempt <= _maxRetries; attempt++)
        {
            if (attempt > 0)
            {
                await Task.Delay(BackoffMs[attempt - 1], cancellationToken).ConfigureAwait(false);
            }

            if (lastResponse != null)
            {
                lastResponse.Dispose();
                lastResponse = null;
            }

            try
            {
                HttpResponseMessage response = await base.SendAsync(request, cancellationToken).ConfigureAwait(false);
                int status = (int)response.StatusCode;

                if (status < 500)
                {
                    // 2xx, 3xx, 4xx — return as-is. Never retry 4xx.
                    return response;
                }

                if (attempt == _maxRetries)
                {
                    return response;
                }
                lastResponse = response;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                // Caller cancelled — propagate without retry.
                throw;
            }
            catch (TaskCanceledException tcex)
            {
                // HttpClient's per-attempt timeout surfaces as TaskCanceledException
                // when the linked timeout token fires; cancellationToken.IsCancellationRequested
                // is false in that case (handled by the `when` clause above).
                // This is a per-attempt timeout — NEVER retried.
                throw new ConsentShieldTimeoutException(
                    "ConsentShield API per-attempt timeout",
                    tcex,
                    traceId: null);
            }
            catch (HttpRequestException hrex)
            {
                lastTransportException = hrex;
                if (attempt == _maxRetries)
                {
                    throw;
                }
            }
        }

        if (lastResponse != null) return lastResponse;
        if (lastTransportException != null) throw lastTransportException;
        throw new InvalidOperationException("RetryHandler: unreachable");
    }
}
