using ConsentShield.Client.Api;
using ConsentShield.Client.AspNetCore;
using ConsentShield.Client.Client;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddConsentShield(builder.Configuration);

var app = builder.Build();

app.MapGet("/health", async (UtilityApi api) =>
{
    try
    {
        await Task.Run(() => api.Ping());
        return Results.Ok(new { ok = true });
    }
    catch (ApiException e)
    {
        return Results.StatusCode(503);
    }
});

app.MapPost("/api/marketing/send", async (UtilityApi api) =>
{
    // Sketch of the gating shape. Replace with the verify call against
    // ConsentApi once the example is wired against the live API. The
    // outcome contract (502 / 503 / 451 / 202) is what's load-bearing
    // here; the actual call site is straightforward.
    try
    {
        await Task.Run(() => api.Ping());
        return Results.Accepted(value: new { queued = true });
    }
    catch (ConsentShieldApiException ex)
    {
        return Results.Json(new { error = "consentshield_api", detail = ex.Detail }, statusCode: 502);
    }
    catch (Exception)
    {
        return Results.Json(new { error = "consent_check_failed" }, statusCode: 503);
    }
});

app.Run();
