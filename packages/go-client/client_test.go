package consentshield

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newTestClient(t *testing.T, srv *httptest.Server, opts ...func(*Config)) *Client {
	t.Helper()
	cfg := Config{
		APIKey:     "cs_live_test",
		BaseURL:    srv.URL,
		Timeout:    500 * time.Millisecond,
		MaxRetries: 1,
	}
	for _, opt := range opts {
		opt(&cfg)
	}
	c, err := NewClient(cfg)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	return c
}

func TestNewClient_RequiresLivePrefix(t *testing.T) {
	if _, err := NewClient(Config{APIKey: "cs_test_xyz"}); err == nil {
		t.Fatal("expected error for non-cs_live_ prefix")
	}
	if _, err := NewClient(Config{APIKey: ""}); err == nil {
		t.Fatal("expected error for empty key")
	}
	if _, err := NewClient(Config{APIKey: "cs_live_ok", Timeout: -1}); err == nil {
		t.Fatal("expected error for negative timeout")
	}
	if _, err := NewClient(Config{APIKey: "cs_live_ok", MaxRetries: -1}); err == nil {
		t.Fatal("expected error for negative MaxRetries")
	}
}

func TestNewClient_DefaultsApplied(t *testing.T) {
	c, err := NewClient(Config{APIKey: "cs_live_ok"})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	if c.BaseURL() != "https://api.consentshield.in" {
		t.Errorf("BaseURL = %q, want default", c.BaseURL())
	}
	if c.cfg.Timeout != 2*time.Second {
		t.Errorf("Timeout = %v, want 2s", c.cfg.Timeout)
	}
	if c.cfg.MaxRetries != 2 {
		t.Errorf("MaxRetries = %d, want 2", c.cfg.MaxRetries)
	}
}

func TestNewClient_BaseURLTrailingSlashTrimmed(t *testing.T) {
	c, err := NewClient(Config{APIKey: "cs_live_ok", BaseURL: "https://example.com/"})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	if c.BaseURL() != "https://example.com" {
		t.Errorf("BaseURL = %q, want trimmed", c.BaseURL())
	}
}

func TestNewClient_FailOpenEnvOverride(t *testing.T) {
	t.Setenv("CONSENT_VERIFY_FAIL_OPEN", "true")
	c, err := NewClient(Config{APIKey: "cs_live_ok"})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	if !c.FailOpen() {
		t.Error("env should have flipped FailOpen to true")
	}
}

func TestNewClient_FailOpenExplicitWinsOverEnv(t *testing.T) {
	t.Setenv("CONSENT_VERIFY_FAIL_OPEN", "true")
	c, err := NewClient(Config{APIKey: "cs_live_ok"}.WithFailOpen(false))
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	if c.FailOpen() {
		t.Error("explicit WithFailOpen(false) should win over env")
	}
}

func TestPing_OK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/_ping" {
			t.Errorf("path = %q, want /v1/_ping", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer cs_live_test" {
			t.Errorf("Authorization = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-CS-Trace-Id", "trace-123")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	out, err := c.Ping(context.Background())
	if err != nil {
		t.Fatalf("Ping: %v", err)
	}
	if out.Status != "ok" {
		t.Errorf("status = %q", out.Status)
	}
}

func TestTransport_RetriesOn5xxThenSucceeds(t *testing.T) {
	var attempts int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts++
		if attempts < 2 {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	if _, err := c.Ping(context.Background()); err != nil {
		t.Fatalf("Ping: %v", err)
	}
	if attempts != 2 {
		t.Errorf("attempts = %d, want 2", attempts)
	}
}

func TestTransport_4xxNeverRetries(t *testing.T) {
	for _, status := range []int{400, 401, 403, 404, 410, 422} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			var attempts int
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				attempts++
				w.Header().Set("Content-Type", "application/problem+json")
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"title":"bad","detail":"nope"}`))
			}))
			defer srv.Close()

			c := newTestClient(t, srv)
			_, err := c.Ping(context.Background())
			if err == nil {
				t.Fatal("expected error")
			}
			if !IsAPIError(err) {
				t.Errorf("error = %v, want APIError", err)
			}
			if attempts != 1 {
				t.Errorf("attempts = %d, want 1 (no retry on 4xx)", attempts)
			}
			var apiErr *APIError
			if !errors.As(err, &apiErr) || apiErr.Status != status {
				t.Errorf("status = %d, want %d", apiErr.Status, status)
			}
			if apiErr.Problem == nil || apiErr.Problem.Detail != "nope" {
				t.Errorf("problem detail not parsed: %+v", apiErr.Problem)
			}
		})
	}
}

func TestTransport_RetryExhaustionSurfacesLastError(t *testing.T) {
	var attempts int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts++
		http.Error(w, "boom", http.StatusBadGateway)
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	_, err := c.Ping(context.Background())
	if err == nil {
		t.Fatal("expected error")
	}
	if !IsAPIError(err) {
		t.Errorf("want APIError, got %T", err)
	}
	if attempts != 2 {
		t.Errorf("attempts = %d, want 2 (1 + maxRetries=1)", attempts)
	}
}

func TestTransport_TraceIDRoundTrip(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-CS-Trace-Id"); got != "abc-123" {
			t.Errorf("trace-id sent = %q", got)
		}
		w.Header().Set("X-CS-Trace-Id", "abc-123")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"property_id":"P","identifier_type":"email","purpose_code":"marketing","status":"granted","evaluated_at":"2026-04-25T00:00:00Z"}`))
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	out, err := c.Verify(context.Background(), VerifyParams{
		PropertyID:              "P",
		DataPrincipalIdentifier: "user@example.com",
		IdentifierType:          "email",
		PurposeCode:             "marketing",
		TraceID:                 "abc-123",
	})
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if out.Envelope == nil || out.Envelope.Status != "granted" {
		t.Errorf("envelope = %+v", out.Envelope)
	}
}

func TestVerify_FailClosedDefault(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	_, err := c.Verify(context.Background(), VerifyParams{
		PropertyID: "P", DataPrincipalIdentifier: "u", IdentifierType: "email", PurposeCode: "p",
	})
	if !IsVerifyError(err) {
		t.Fatalf("want VerifyError, got %v", err)
	}
}

func TestVerify_FailOpenReturnsEnvelope(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := newTestClient(t, srv, func(c *Config) { *c = c.WithFailOpen(true) })
	out, err := c.Verify(context.Background(), VerifyParams{
		PropertyID: "P", DataPrincipalIdentifier: "u", IdentifierType: "email", PurposeCode: "p",
	})
	if err != nil {
		t.Fatalf("expected nil error in fail-open, got %v", err)
	}
	if out.Open == nil {
		t.Fatal("expected Open envelope, got nil")
	}
	if out.Open.Cause != OpenCauseServerError {
		t.Errorf("cause = %q, want server_error", out.Open.Cause)
	}
	if !out.IsOpen() {
		t.Error("IsOpen() should report true")
	}
}

func TestVerify_4xxAlwaysSurfacesEvenWhenFailOpen(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/problem+json")
		http.Error(w, `{"title":"bad","detail":"key out of scope"}`, http.StatusForbidden)
	}))
	defer srv.Close()

	c := newTestClient(t, srv, func(c *Config) { *c = c.WithFailOpen(true) })
	_, err := c.Verify(context.Background(), VerifyParams{
		PropertyID: "P", DataPrincipalIdentifier: "u", IdentifierType: "email", PurposeCode: "p",
	})
	if !IsAPIError(err) {
		t.Fatalf("want APIError, got %v", err)
	}
}

func TestVerify_RequiresAllFields(t *testing.T) {
	c, _ := NewClient(Config{APIKey: "cs_live_ok"})
	if _, err := c.Verify(context.Background(), VerifyParams{}); err == nil {
		t.Error("expected error on empty params")
	}
}

func TestVerifyBatch_BoundaryAtCap(t *testing.T) {
	c, _ := NewClient(Config{APIKey: "cs_live_ok"})

	// 0 → error
	_, err := c.VerifyBatch(context.Background(), VerifyBatchParams{
		PropertyID: "P", IdentifierType: "email", PurposeCode: "p",
		Identifiers: []string{},
	})
	if err == nil || !strings.Contains(err.Error(), "at least one") {
		t.Errorf("empty: err = %v", err)
	}

	// > cap → error
	too := make([]string, MaxBatchIdentifiers+1)
	for i := range too {
		too[i] = "u"
	}
	_, err = c.VerifyBatch(context.Background(), VerifyBatchParams{
		PropertyID: "P", IdentifierType: "email", PurposeCode: "p", Identifiers: too,
	})
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Errorf("over: err = %v", err)
	}

	// non-empty entry validation
	_, err = c.VerifyBatch(context.Background(), VerifyBatchParams{
		PropertyID: "P", IdentifierType: "email", PurposeCode: "p",
		Identifiers: []string{"a", "", "c"},
	})
	if err == nil || !strings.Contains(err.Error(), "[1]") {
		t.Errorf("blank entry: err = %v", err)
	}
}

func TestVerifyBatch_FailOpen5xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := newTestClient(t, srv, func(c *Config) { *c = c.WithFailOpen(true) })
	out, err := c.VerifyBatch(context.Background(), VerifyBatchParams{
		PropertyID: "P", IdentifierType: "email", PurposeCode: "p",
		Identifiers: []string{"a@b.com"},
	})
	if err != nil {
		t.Fatalf("fail-open should not error: %v", err)
	}
	if out.Open == nil || out.Open.Cause != OpenCauseServerError {
		t.Errorf("open = %+v", out.Open)
	}
}

func TestRecordConsent_Body(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s", r.Method)
		}
		if r.URL.Path != "/v1/consent/record" {
			t.Errorf("path = %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"event_id":"e","created_at":"2026-04-25T00:00:00Z","artefact_ids":[],"idempotent_replay":false}`))
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	out, err := c.RecordConsent(context.Background(), RecordConsentParams{
		PropertyID: "P", DataPrincipalIdentifier: "u@example.com",
		IdentifierType: "email", PurposeDefinitionIDs: []string{"PD1", "PD2"},
		ClientRequestID: "req-1",
	})
	if err != nil {
		t.Fatalf("RecordConsent: %v", err)
	}
	if out.EventID != "e" {
		t.Errorf("event_id = %q", out.EventID)
	}
}

func TestRecordConsent_RequiresPurposes(t *testing.T) {
	c, _ := NewClient(Config{APIKey: "cs_live_ok"})
	_, err := c.RecordConsent(context.Background(), RecordConsentParams{
		PropertyID: "P", DataPrincipalIdentifier: "u", IdentifierType: "email",
	})
	if err == nil {
		t.Error("expected error on empty PurposeDefinitionIDs")
	}
}

func TestRevokeArtefact_PathEncoding(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// RawPath preserves %-escapes; net/http decodes URL.Path.
		got = r.URL.RawPath
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"artefact_id":"a/b","status":"revoked","revoked_at":"t","revocation_record_id":"rr"}`))
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	_, err := c.RevokeArtefact(context.Background(), RevokeArtefactParams{ArtefactID: "a/b"})
	if err != nil {
		t.Fatalf("RevokeArtefact: %v", err)
	}
	if got != "/v1/consent/artefacts/a%2Fb/revoke" {
		t.Errorf("RawPath = %q, want url-encoded id", got)
	}
}

func TestTriggerDeletion_RequiresPurposesOnConsentRevoked(t *testing.T) {
	c, _ := NewClient(Config{APIKey: "cs_live_ok"})
	_, err := c.TriggerDeletion(context.Background(), TriggerDeletionParams{
		PropertyID: "P", DataPrincipalIdentifier: "u", IdentifierType: "email",
		Reason: DeletionReasonConsentRevoked,
	})
	if err == nil || !strings.Contains(err.Error(), "PurposeCodes") {
		t.Errorf("err = %v, want PurposeCodes-required gate", err)
	}
}

func TestCreateRightsRequest_RequiresIdentityVerifiedBy(t *testing.T) {
	c, _ := NewClient(Config{APIKey: "cs_live_ok"})
	_, err := c.CreateRightsRequest(context.Background(), CreateRightsRequestParams{
		PropertyID: "P", DataPrincipalIdentifier: "u", IdentifierType: "email",
		RequestType: RightsRequestTypeAccess,
	})
	if err == nil || !strings.Contains(err.Error(), "IdentityVerifiedBy") {
		t.Errorf("err = %v, want IdentityVerifiedBy-required gate", err)
	}
}

func TestGetArtefact_NullBodyReturnsNil(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`null`))
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	out, err := c.GetArtefact(context.Background(), "unknown", "")
	if err != nil {
		t.Fatalf("GetArtefact: %v", err)
	}
	if out != nil {
		t.Errorf("expected nil for null body, got %+v", out)
	}
}

func TestArtefactPaginator_WalksTwoPages(t *testing.T) {
	var pages int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pages++
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Query().Get("cursor") {
		case "":
			_, _ = w.Write([]byte(`{"artefacts":[{"artefact_id":"a","property_id":"P","purpose_definition_id":"PD","purpose_code":"c","identifier_type":"email","data_principal_identifier":"u","status":"granted","granted_at":"t","revoked_at":null,"expires_at":null}],"next_cursor":"cur2"}`))
		case "cur2":
			_, _ = w.Write([]byte(`{"artefacts":[{"artefact_id":"b","property_id":"P","purpose_definition_id":"PD","purpose_code":"c","identifier_type":"email","data_principal_identifier":"u","status":"granted","granted_at":"t","revoked_at":null,"expires_at":null}],"next_cursor":null}`))
		}
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	it := c.IterateArtefacts(ListArtefactsParams{PropertyID: "P"})

	var collected []string
	for it.Next(context.Background()) {
		for _, a := range it.Page() {
			collected = append(collected, a.ArtefactID)
		}
	}
	if err := it.Err(); err != nil {
		t.Fatalf("paginator err: %v", err)
	}
	if len(collected) != 2 || collected[0] != "a" || collected[1] != "b" {
		t.Errorf("collected = %v", collected)
	}
	if pages != 2 {
		t.Errorf("pages = %d, want 2", pages)
	}
}

func TestEventPaginator_SinglePage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"events":[{"event_id":"e1","property_id":"P","identifier_type":"email","data_principal_identifier":"u","status":"granted","captured_at":"t"}],"next_cursor":null}`))
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	it := c.IterateEvents(ListEventsParams{})
	var n int
	for it.Next(context.Background()) {
		n += len(it.Page())
	}
	if it.Err() != nil {
		t.Fatalf("err: %v", it.Err())
	}
	if n != 1 {
		t.Errorf("events = %d, want 1", n)
	}
}

func TestDeletionReceiptsAndRightsAndAuditPaginators_Smoke(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/v1/deletion/receipts"):
			_, _ = w.Write([]byte(`{"receipts":[{"deletion_request_id":"dr","connector_id":"mailchimp","status":"completed","completed_at":"t","failure_reason":null}],"next_cursor":null}`))
		case strings.HasPrefix(r.URL.Path, "/v1/rights/requests"):
			_, _ = w.Write([]byte(`{"requests":[{"rights_request_id":"rr","request_type":"access","status":"open","created_at":"t"}],"next_cursor":null}`))
		case strings.HasPrefix(r.URL.Path, "/v1/audit"):
			_, _ = w.Write([]byte(`{"items":[{"audit_id":"al","occurred_at":"t","actor":"user","action":"a","subject":"s"}],"next_cursor":null}`))
		default:
			http.Error(w, "unhandled", http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := newTestClient(t, srv)

	dr := c.IterateDeletionReceipts(ListDeletionReceiptsParams{})
	if !dr.Next(context.Background()) || len(dr.Page()) != 1 {
		t.Errorf("deletion-receipts paginator failed: %v", dr.Err())
	}
	rr := c.IterateRightsRequests(ListRightsRequestsParams{})
	if !rr.Next(context.Background()) || len(rr.Page()) != 1 {
		t.Errorf("rights paginator failed: %v", rr.Err())
	}
	al := c.IterateAuditLog(ListAuditLogParams{})
	if !al.Next(context.Background()) || len(al.Page()) != 1 {
		t.Errorf("audit paginator failed: %v", al.Err())
	}
}

func TestErrors_TraceIDExposed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-CS-Trace-Id", "trace-xyz")
		w.Header().Set("Content-Type", "application/problem+json")
		http.Error(w, `{"title":"nope","detail":"bad"}`, http.StatusForbidden)
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	_, err := c.Ping(context.Background())
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("err = %v", err)
	}
	if apiErr.TraceID() != "trace-xyz" {
		t.Errorf("trace = %q", apiErr.TraceID())
	}
}

func TestTimeoutNeverRetries(t *testing.T) {
	var attempts int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts++
		time.Sleep(200 * time.Millisecond)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c, err := NewClient(Config{
		APIKey: "cs_live_test", BaseURL: srv.URL,
		Timeout: 50 * time.Millisecond, MaxRetries: 3,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	_, err = c.Ping(context.Background())
	if err == nil {
		t.Fatal("expected timeout error")
	}
	var toErr *TimeoutError
	if !errors.As(err, &toErr) {
		t.Errorf("want TimeoutError, got %T: %v", err, err)
	}
	if attempts != 1 {
		t.Errorf("attempts = %d, want 1 (no retry on timeout)", attempts)
	}
}
