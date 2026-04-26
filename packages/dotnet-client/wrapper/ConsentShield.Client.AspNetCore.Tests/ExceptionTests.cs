using System;
using System.Collections.Generic;

using Xunit;

namespace ConsentShield.Client.AspNetCore.Tests;

public class ExceptionTests
{
    [Fact]
    public void ApiExceptionCarriesAllFields()
    {
        var ex = new ConsentShieldApiException(
            status: 404,
            type: "/errors/not-found",
            title: "Not Found",
            detail: "property_id does not belong to your org",
            instance: "/v1/consent/verify",
            traceId: "abc-123",
            extensions: new Dictionary<string, object?> { ["hint"] = "double-check the property_id" });

        Assert.Equal(404, ex.Status);
        Assert.Equal("Not Found", ex.Title);
        Assert.Equal("property_id does not belong to your org", ex.Detail);
        Assert.Equal("abc-123", ex.TraceId);
        Assert.Equal("/v1/consent/verify", ex.Instance);
        Assert.Single(ex.Extensions);
        Assert.Contains("404", ex.Message);
    }

    [Fact]
    public void ApiExceptionToleratesNullExtensions()
    {
        var ex = new ConsentShieldApiException(400, null, null, null, null, null, null);
        Assert.NotNull(ex.Extensions);
        Assert.Empty(ex.Extensions);
    }

    [Fact]
    public void TimeoutExceptionPreservesCauseAndTraceId()
    {
        var inner = new TimeoutException("read timeout");
        var ex = new ConsentShieldTimeoutException("per-attempt timeout", inner, "trace-xyz");
        Assert.Equal("trace-xyz", ex.TraceId);
        Assert.Equal(inner, ex.InnerException);
    }

    [Fact]
    public void VerifyExceptionCarriesCauseDiscriminator()
    {
        var ex = new ConsentVerifyException(VerifyFailureCause.ServerError, "5xx after retries", null, "trace-xyz");
        Assert.Equal(VerifyFailureCause.ServerError, ex.Cause);
        Assert.Equal("trace-xyz", ex.TraceId);
    }

    [Fact]
    public void VerifyFailureCauseEnumValuesPresent()
    {
        Assert.Equal(VerifyFailureCause.ServerError, Enum.Parse<VerifyFailureCause>("ServerError"));
        Assert.Equal(VerifyFailureCause.Timeout, Enum.Parse<VerifyFailureCause>("Timeout"));
        Assert.Equal(VerifyFailureCause.Network, Enum.Parse<VerifyFailureCause>("Network"));
    }
}
