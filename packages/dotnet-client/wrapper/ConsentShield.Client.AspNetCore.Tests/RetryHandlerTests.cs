using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

using Xunit;

namespace ConsentShield.Client.AspNetCore.Tests;

public class RetryHandlerTests
{
    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Func<int, HttpResponseMessage> _respond;
        public int CallCount { get; private set; }

        public StubHandler(Func<int, HttpResponseMessage> respond)
        {
            _respond = respond;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            CallCount++;
            return Task.FromResult(_respond(CallCount));
        }
    }

    private sealed class ThrowingHandler : HttpMessageHandler
    {
        private readonly Func<int, Exception?> _throw;
        public int CallCount { get; private set; }

        public ThrowingHandler(Func<int, Exception?> throwOn)
        {
            _throw = throwOn;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            CallCount++;
            Exception? toThrow = _throw(CallCount);
            if (toThrow != null) throw toThrow;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        }
    }

    private static HttpClient ClientWith(HttpMessageHandler inner, int maxRetries)
    {
        var retry = new RetryHandler(maxRetries) { InnerHandler = inner };
        return new HttpClient(retry) { BaseAddress = new Uri("http://stub.test/") };
    }

    [Fact]
    public async Task TwoXxNeverRetried()
    {
        var stub = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));
        var client = ClientWith(stub, 3);

        HttpResponseMessage r = await client.GetAsync("/x");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(1, stub.CallCount);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.Gone)]
    [InlineData(HttpStatusCode.UnprocessableEntity)]
    public async Task FourXxNeverRetried(HttpStatusCode code)
    {
        var stub = new StubHandler(_ => new HttpResponseMessage(code));
        var client = ClientWith(stub, 3);

        HttpResponseMessage r = await client.GetAsync("/x");

        Assert.Equal(code, r.StatusCode);
        Assert.Equal(1, stub.CallCount);
    }

    [Fact]
    public async Task FiveXxRetriesUntilSuccess()
    {
        var stub = new StubHandler(n => new HttpResponseMessage(n < 3 ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.OK));
        var client = ClientWith(stub, 3);

        HttpResponseMessage r = await client.GetAsync("/x");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(3, stub.CallCount);
    }

    [Fact]
    public async Task FiveXxExhaustsRetriesThenSurfaces()
    {
        var stub = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        var client = ClientWith(stub, 3);

        HttpResponseMessage r = await client.GetAsync("/x");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode);
        Assert.Equal(4, stub.CallCount);
    }

    [Fact]
    public async Task NetworkErrorRetriedThenSucceeds()
    {
        var stub = new ThrowingHandler(n => n <= 2 ? new HttpRequestException("simulated transport") : null);
        var client = ClientWith(stub, 3);

        HttpResponseMessage r = await client.GetAsync("/x");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(3, stub.CallCount);
    }

    [Fact]
    public async Task NetworkErrorExhaustsRetriesThenThrows()
    {
        var stub = new ThrowingHandler(_ => new HttpRequestException("simulated transport"));
        var client = ClientWith(stub, 3);

        await Assert.ThrowsAsync<HttpRequestException>(() => client.GetAsync("/x"));
        Assert.Equal(4, stub.CallCount);
    }

    [Fact]
    public async Task TimeoutNeverRetried()
    {
        var stub = new ThrowingHandler(_ => new TaskCanceledException("HttpClient timeout"));
        var client = ClientWith(stub, 3);

        await Assert.ThrowsAsync<ConsentShieldTimeoutException>(() => client.GetAsync("/x"));
        Assert.Equal(1, stub.CallCount);
    }

    [Fact]
    public async Task UserCancellationPropagated()
    {
        var stub = new ThrowingHandler(_ => null);
        var client = ClientWith(stub, 3);

        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAsync<TaskCanceledException>(() => client.GetAsync("/x", cts.Token));
    }

    [Fact]
    public async Task ZeroRetriesMeansOneAttempt()
    {
        var stub = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        var client = ClientWith(stub, 0);

        HttpResponseMessage r = await client.GetAsync("/x");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode);
        Assert.Equal(1, stub.CallCount);
    }

    [Fact]
    public void InvalidMaxRetriesRejected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new RetryHandler(-1));
        Assert.Throws<ArgumentOutOfRangeException>(() => new RetryHandler(99));
    }
}
