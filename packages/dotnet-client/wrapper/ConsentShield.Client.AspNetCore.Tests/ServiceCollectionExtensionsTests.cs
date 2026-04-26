using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;

using ConsentShield.Client.Api;

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

using Xunit;

namespace ConsentShield.Client.AspNetCore.Tests;

public class ServiceCollectionExtensionsTests
{
    [Fact]
    public void OptionsOverloadValidatesApiKeyPresence()
    {
        IServiceCollection services = new ServiceCollection();
        services.AddConsentShield(o => { /* no ApiKey */ });

        ServiceProvider sp = services.BuildServiceProvider();
        var ex = Assert.ThrowsAny<OptionsValidationException>(() => sp.GetRequiredService<IOptions<ConsentShieldOptions>>().Value);
        Assert.Contains("ApiKey is required", ex.Message);
    }

    [Fact]
    public void OptionsOverloadValidatesApiKeyPrefix()
    {
        IServiceCollection services = new ServiceCollection();
        services.AddConsentShield(o => { o.ApiKey = "not-cs-prefixed"; });

        ServiceProvider sp = services.BuildServiceProvider();
        var ex = Assert.ThrowsAny<OptionsValidationException>(() => sp.GetRequiredService<IOptions<ConsentShieldOptions>>().Value);
        Assert.Contains("cs_live_", ex.Message);
    }

    [Fact]
    public void OptionsOverloadResolvesNamedHttpClient()
    {
        IServiceCollection services = new ServiceCollection();
        services.AddConsentShield(o => { o.ApiKey = "cs_live_abc123"; });

        ServiceProvider sp = services.BuildServiceProvider();
        IHttpClientFactory factory = sp.GetRequiredService<IHttpClientFactory>();
        HttpClient http = factory.CreateClient(ServiceCollectionExtensions.HttpClientName);

        Assert.NotNull(http.BaseAddress);
        Assert.Equal("https://api.consentshield.in/v1/", http.BaseAddress!.ToString());
        Assert.Equal("Bearer", http.DefaultRequestHeaders.Authorization!.Scheme);
        Assert.Equal("cs_live_abc123", http.DefaultRequestHeaders.Authorization.Parameter);
    }

    [Fact]
    public void ConfigurationOverloadBindsAllProperties()
    {
        IConfiguration configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConsentShield:ApiKey"] = "cs_live_abc123",
                ["ConsentShield:BaseUrl"] = "https://example.test/v1/",
                ["ConsentShield:Timeout"] = "00:00:05",
                ["ConsentShield:MaxRetries"] = "2",
                ["ConsentShield:FailOpen"] = "true",
            })
            .Build();

        IServiceCollection services = new ServiceCollection();
        services.AddConsentShield(configuration);

        ServiceProvider sp = services.BuildServiceProvider();
        ConsentShieldOptions opts = sp.GetRequiredService<IOptions<ConsentShieldOptions>>().Value;

        Assert.Equal("cs_live_abc123", opts.ApiKey);
        Assert.Equal("https://example.test/v1/", opts.BaseUrl);
        Assert.Equal(TimeSpan.FromSeconds(5), opts.Timeout);
        Assert.Equal(2, opts.MaxRetries);
        Assert.True(opts.FailOpen);
    }

    [Fact]
    public void RegistersUtilityApi()
    {
        IServiceCollection services = new ServiceCollection();
        services.AddConsentShield(o => { o.ApiKey = "cs_live_abc123"; });

        ServiceProvider sp = services.BuildServiceProvider();
        UtilityApi api = sp.GetRequiredService<UtilityApi>();
        Assert.NotNull(api);
    }

    [Fact]
    public void NullArgumentsRejected()
    {
        IServiceCollection services = new ServiceCollection();
        Assert.Throws<ArgumentNullException>(() => services.AddConsentShield((Action<ConsentShieldOptions>)null!));
        Assert.Throws<ArgumentNullException>(() => services.AddConsentShield((IConfiguration)null!));
    }

    [Fact]
    public void OptionsObjectDefaultsAreSensible()
    {
        var o = new ConsentShieldOptions();
        Assert.Equal("https://api.consentshield.in/v1", o.BaseUrl);
        Assert.Equal(TimeSpan.FromSeconds(2), o.Timeout);
        Assert.Equal(3, o.MaxRetries);
        Assert.False(o.FailOpen);
    }
}
