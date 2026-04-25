package consentshield

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	defaultBaseURL    = "https://api.consentshield.in"
	defaultTimeoutMS  = 2000
	defaultMaxRetries = 2
)

// backoffSchedule mirrors the Node + Python SDKs: 100 / 400 / 1600 ms.
var backoffSchedule = []time.Duration{
	100 * time.Millisecond,
	400 * time.Millisecond,
	1600 * time.Millisecond,
}

// Config holds the immutable client configuration. APIKey is the only
// required field.
type Config struct {
	// APIKey must start with "cs_live_" (case-sensitive).
	APIKey string

	// BaseURL defaults to https://api.consentshield.in. Trailing
	// slashes are trimmed.
	BaseURL string

	// Timeout for a single HTTP attempt. Defaults to 2 seconds.
	Timeout time.Duration

	// MaxRetries on 5xx + transport errors. NEVER retries 4xx or
	// timeouts. Defaults to 2.
	MaxRetries int

	// FailOpen flips Verify / VerifyBatch into the fail-OPEN posture
	// when a timeout / network / 5xx outcome occurs. The default
	// (false) returns *VerifyError. CONSENT_VERIFY_FAIL_OPEN=true|1
	// in the process env overrides this when the field is left at
	// its zero value.
	FailOpen bool

	// failOpenSet records whether the caller explicitly set FailOpen
	// (so the env override doesn't stomp an explicit `false`).
	failOpenSet bool

	// HTTPClient lets callers swap the transport (testing, custom
	// retry, IPv6-only, mTLS). Defaults to a fresh http.Client.
	HTTPClient *http.Client
}

// resolveConfig validates and normalises Config. Returned config is
// immutable and used by Client.
type resolvedConfig struct {
	APIKey     string
	BaseURL    string
	Timeout    time.Duration
	MaxRetries int
	FailOpen   bool
	HTTPClient *http.Client
}

func resolveConfig(cfg Config) (*resolvedConfig, error) {
	if !strings.HasPrefix(cfg.APIKey, "cs_live_") {
		return nil, errors.New("consentshield: APIKey must begin with 'cs_live_'")
	}

	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = time.Duration(defaultTimeoutMS) * time.Millisecond
	}
	if timeout <= 0 {
		return nil, errors.New("consentshield: Timeout must be positive")
	}

	maxRetries := cfg.MaxRetries
	if maxRetries < 0 {
		return nil, errors.New("consentshield: MaxRetries must be >= 0")
	}
	if cfg.MaxRetries == 0 {
		maxRetries = defaultMaxRetries
	}

	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	baseURL = strings.TrimRight(baseURL, "/")

	failOpen := cfg.FailOpen
	if !cfg.failOpenSet && !cfg.FailOpen {
		switch strings.ToLower(os.Getenv("CONSENT_VERIFY_FAIL_OPEN")) {
		case "1", "true":
			failOpen = true
		}
	}

	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{}
	}

	return &resolvedConfig{
		APIKey:     cfg.APIKey,
		BaseURL:    baseURL,
		Timeout:    timeout,
		MaxRetries: maxRetries,
		FailOpen:   failOpen,
		HTTPClient: httpClient,
	}, nil
}

// httpRequest is the internal request shape produced by builders and
// dispatched by transport.do.
type httpRequest struct {
	Method  string
	Path    string
	Query   url.Values
	Body    any
	TraceID string
}

// httpResponse holds the parsed body + trace id of a successful 2xx
// response.
type httpResponse struct {
	StatusCode int
	Body       []byte
	TraceID    string
}

// transport is the retry-aware HTTP layer.
type transport struct {
	cfg *resolvedConfig
}

// do executes the request, retrying transport errors and 5xx up to
// MaxRetries times with exponential backoff. NEVER retries 4xx.
// NEVER retries on context cancellation / deadline exceeded.
func (t *transport) do(ctx context.Context, req *httpRequest) (*httpResponse, error) {
	var lastErr error
	for attempt := 0; attempt <= t.cfg.MaxRetries; attempt++ {
		if attempt > 0 {
			delay := backoffSchedule[min(attempt-1, len(backoffSchedule)-1)]
			select {
			case <-ctx.Done():
				return nil, ctxErr(ctx, "")
			case <-time.After(delay):
			}
		}

		resp, retry, err := t.attempt(ctx, req)
		if err == nil {
			return resp, nil
		}
		lastErr = err
		if !retry {
			return nil, err
		}
	}
	return nil, lastErr
}

// attempt runs a single request. The retry bool reports whether the
// caller should retry (transport error or 5xx).
func (t *transport) attempt(ctx context.Context, req *httpRequest) (*httpResponse, bool, error) {
	attemptCtx, cancel := context.WithTimeout(ctx, t.cfg.Timeout)
	defer cancel()

	u := t.cfg.BaseURL + req.Path
	if len(req.Query) > 0 {
		u += "?" + req.Query.Encode()
	}

	var bodyReader io.Reader
	if req.Body != nil {
		buf, err := json.Marshal(req.Body)
		if err != nil {
			return nil, false, err
		}
		bodyReader = bytes.NewReader(buf)
	}

	httpReq, err := http.NewRequestWithContext(attemptCtx, req.Method, u, bodyReader)
	if err != nil {
		return nil, false, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+t.cfg.APIKey)
	httpReq.Header.Set("Accept", "application/json")
	if req.Body != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	if req.TraceID != "" {
		httpReq.Header.Set("X-CS-Trace-Id", req.TraceID)
	}

	httpResp, err := t.cfg.HTTPClient.Do(httpReq)
	if err != nil {
		// Disambiguate context cancellation / timeout from transport
		// failure. Timeouts NEVER retry. Context cancellations NEVER
		// retry. Real transport failures (DNS / TCP / TLS reset) DO.
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			if errors.Is(err, context.DeadlineExceeded) && ctx.Err() == nil {
				// Per-attempt timeout — surface as TimeoutError.
				return nil, false, &TimeoutError{TimeoutMS: int(t.cfg.Timeout / time.Millisecond)}
			}
			return nil, false, ctxErr(ctx, "")
		}
		return nil, true, &NetworkError{Cause: err}
	}
	defer func() { _ = httpResp.Body.Close() }()

	traceID := httpResp.Header.Get("X-CS-Trace-Id")
	body, readErr := io.ReadAll(httpResp.Body)
	if readErr != nil {
		return nil, true, &NetworkError{Cause: readErr, traceID: traceID}
	}

	if httpResp.StatusCode >= 200 && httpResp.StatusCode < 300 {
		return &httpResponse{
			StatusCode: httpResp.StatusCode,
			Body:       body,
			TraceID:    traceID,
		}, false, nil
	}

	apiErr := &APIError{Status: httpResp.StatusCode, traceID: traceID}
	if len(body) > 0 && strings.Contains(httpResp.Header.Get("Content-Type"), "json") {
		var prob ProblemJSON
		if jsonErr := json.Unmarshal(body, &prob); jsonErr == nil {
			apiErr.Problem = &prob
		}
	}

	if httpResp.StatusCode >= 500 {
		return nil, true, apiErr
	}
	// 4xx: NEVER retry.
	return nil, false, apiErr
}

// ctxErr wraps a context cancellation as a NetworkError so callers
// see a uniform error surface.
func ctxErr(ctx context.Context, traceID string) error {
	if err := ctx.Err(); err != nil {
		return &NetworkError{Cause: err, traceID: traceID}
	}
	return &NetworkError{Cause: errors.New("context cancelled"), traceID: traceID}
}
