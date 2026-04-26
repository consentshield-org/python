using System;
using System.Net.Http;
using System.Net.Http.Headers;

using ConsentShield.Client.Api;

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace ConsentShield.Client.AspNetCore;

/// <summary>
/// Extension methods for wiring ConsentShield into ASP.NET Core's DI container
/// via <see cref="IHttpClientFactory"/>.
/// </summary>
public static class ServiceCollectionExtensions
{
    /// <summary>Named HttpClient logical name registered by AddConsentShield.</summary>
    public const string HttpClientName = "ConsentShield";

    /// <summary>
    /// Register ConsentShield with options bound from the given configuration
    /// section (defaults to <c>"ConsentShield"</c>) and a typed HttpClient that
    /// installs <see cref="RetryHandler"/> + Bearer auth + per-attempt timeout.
    /// </summary>
    public static IServiceCollection AddConsentShield(
        this IServiceCollection services,
        IConfiguration configuration,
        string sectionName = "ConsentShield")
    {
        if (services == null) throw new ArgumentNullException(nameof(services));
        if (configuration == null) throw new ArgumentNullException(nameof(configuration));

        services.AddOptions<ConsentShieldOptions>()
            .Bind(configuration.GetSection(sectionName))
            .Validate(o => !string.IsNullOrEmpty(o.ApiKey), "ConsentShield:ApiKey is required.")
            .Validate(o => o.ApiKey == null || o.ApiKey.StartsWith("cs_live_"), "ConsentShield:ApiKey must start with cs_live_.")
            .Validate(o => o.MaxRetries >= 0, "ConsentShield:MaxRetries must be >= 0.")
            .Validate(o => o.Timeout > TimeSpan.Zero, "ConsentShield:Timeout must be > 0.")
            .ValidateOnStart();

        services.AddTransient<RetryHandler>(sp =>
        {
            ConsentShieldOptions opts = sp.GetRequiredService<IOptions<ConsentShieldOptions>>().Value;
            return new RetryHandler(opts.MaxRetries);
        });

        services.AddHttpClient(HttpClientName, (sp, client) =>
        {
            ConsentShieldOptions opts = sp.GetRequiredService<IOptions<ConsentShieldOptions>>().Value;
            client.BaseAddress = new Uri(opts.BaseUrl.TrimEnd('/') + "/");
            client.Timeout = opts.Timeout;
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", opts.ApiKey);
        }).AddHttpMessageHandler<RetryHandler>();

        services.AddTransient<UtilityApi>(sp => CreateUtilityApi(sp));

        return services;
    }

    /// <summary>
    /// Overload that accepts an inline <see cref="Action{ConsentShieldOptions}"/>
    /// instead of binding from configuration. Prefer the configuration overload
    /// when the values come from <c>appsettings.json</c> / env vars.
    /// </summary>
    public static IServiceCollection AddConsentShield(
        this IServiceCollection services,
        Action<ConsentShieldOptions> configure)
    {
        if (services == null) throw new ArgumentNullException(nameof(services));
        if (configure == null) throw new ArgumentNullException(nameof(configure));

        services.AddOptions<ConsentShieldOptions>()
            .Configure(configure)
            .Validate(o => !string.IsNullOrEmpty(o.ApiKey), "ConsentShieldOptions.ApiKey is required.")
            .Validate(o => o.ApiKey == null || o.ApiKey.StartsWith("cs_live_"), "ConsentShieldOptions.ApiKey must start with cs_live_.")
            .Validate(o => o.MaxRetries >= 0, "ConsentShieldOptions.MaxRetries must be >= 0.")
            .Validate(o => o.Timeout > TimeSpan.Zero, "ConsentShieldOptions.Timeout must be > 0.");

        services.AddTransient<RetryHandler>(sp =>
        {
            ConsentShieldOptions opts = sp.GetRequiredService<IOptions<ConsentShieldOptions>>().Value;
            return new RetryHandler(opts.MaxRetries);
        });

        services.AddHttpClient(HttpClientName, (sp, client) =>
        {
            ConsentShieldOptions opts = sp.GetRequiredService<IOptions<ConsentShieldOptions>>().Value;
            client.BaseAddress = new Uri(opts.BaseUrl.TrimEnd('/') + "/");
            client.Timeout = opts.Timeout;
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", opts.ApiKey);
        }).AddHttpMessageHandler<RetryHandler>();

        services.AddTransient<UtilityApi>(sp => CreateUtilityApi(sp));

        return services;
    }

    private static UtilityApi CreateUtilityApi(IServiceProvider sp)
    {
        IHttpClientFactory factory = sp.GetRequiredService<IHttpClientFactory>();
        ConsentShieldOptions opts = sp.GetRequiredService<IOptions<ConsentShieldOptions>>().Value;
        HttpClient http = factory.CreateClient(HttpClientName);
        // Bearer auth lives on the HttpClient's DefaultRequestHeaders (set in
        // the AddHttpClient configurator), so the Api class only needs the
        // basePath to resolve relative URLs.
        return new UtilityApi(http, opts.BaseUrl.TrimEnd('/'));
    }
}
