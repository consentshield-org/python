package consentshield

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Cover the error-string surfaces + TraceID accessors. Compliance-
// audit logs depend on these formatting consistently.
func TestErrorStringSurfaces(t *testing.T) {
	apiErr := &APIError{
		Status:  500,
		Problem: &ProblemJSON{Title: "T", Detail: "D"},
		traceID: "tr",
	}
	if !strings.Contains(apiErr.Error(), "500") || !strings.Contains(apiErr.Error(), "D") {
		t.Errorf("APIError.Error = %q", apiErr.Error())
	}
	if apiErr.TraceID() != "tr" {
		t.Errorf("APIError.TraceID = %q", apiErr.TraceID())
	}

	apiErr2 := &APIError{Status: 503, Problem: &ProblemJSON{Title: "only-title"}}
	if !strings.Contains(apiErr2.Error(), "only-title") {
		t.Errorf("title fallback failed: %q", apiErr2.Error())
	}
	apiErr3 := &APIError{Status: 504}
	if !strings.Contains(apiErr3.Error(), "HTTP 504") {
		t.Errorf("HTTP fallback failed: %q", apiErr3.Error())
	}

	netErr := &NetworkError{Cause: errors.New("dns"), traceID: "n"}
	if !strings.Contains(netErr.Error(), "dns") || netErr.TraceID() != "n" {
		t.Errorf("NetworkError surface: %q / %q", netErr.Error(), netErr.TraceID())
	}
	if !errors.Is(netErr, netErr.Cause) {
		t.Error("Unwrap should chain")
	}

	toErr := &TimeoutError{TimeoutMS: 50, traceID: "t"}
	if !strings.Contains(toErr.Error(), "50") || toErr.TraceID() != "t" {
		t.Errorf("TimeoutError surface: %q", toErr.Error())
	}

	veErr := &VerifyError{Cause: errors.New("upstream"), traceID: "v"}
	if !strings.Contains(veErr.Error(), "upstream") || veErr.TraceID() != "v" {
		t.Errorf("VerifyError surface: %q", veErr.Error())
	}
	if !errors.Is(veErr, veErr.Cause) {
		t.Error("VerifyError Unwrap should chain")
	}
}

// Verify.IsOpen / VerifyBatch.IsOpen branches when neither side is set.
func TestVerifyOutcome_IsOpenZeroValue(t *testing.T) {
	if (VerifyOutcome{}).IsOpen() {
		t.Error("zero VerifyOutcome should not report IsOpen")
	}
	if (VerifyBatchOutcome{}).IsOpen() {
		t.Error("zero VerifyBatchOutcome should not report IsOpen")
	}
}

// IteratePaginator.Err returns the recorded error when Next surfaces
// a 4xx mid-walk.
func TestPaginatorErrorOnHTTPFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "denied", http.StatusForbidden)
	}))
	defer srv.Close()

	c := newTestClient(t, srv)

	for _, walk := range []func() error{
		func() error {
			it := c.IterateArtefacts(ListArtefactsParams{})
			for it.Next(context.Background()) {
			}
			return it.Err()
		},
		func() error {
			it := c.IterateEvents(ListEventsParams{})
			for it.Next(context.Background()) {
			}
			return it.Err()
		},
		func() error {
			it := c.IterateDeletionReceipts(ListDeletionReceiptsParams{})
			for it.Next(context.Background()) {
			}
			return it.Err()
		},
		func() error {
			it := c.IterateRightsRequests(ListRightsRequestsParams{})
			for it.Next(context.Background()) {
			}
			return it.Err()
		},
		func() error {
			it := c.IterateAuditLog(ListAuditLogParams{})
			for it.Next(context.Background()) {
			}
			return it.Err()
		},
	} {
		if err := walk(); err == nil {
			t.Error("paginator should propagate 4xx as Err()")
		}
	}
}

// Exercises every query()-side branch + Limit/Cursor + propagates
// query-string filters end-to-end.
func TestListEndpoints_QueryStringComposition(t *testing.T) {
	var lastQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lastQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/v1/consent/artefacts"):
			_, _ = w.Write([]byte(`{"artefacts":[],"next_cursor":null}`))
		case strings.HasPrefix(r.URL.Path, "/v1/consent/events"):
			_, _ = w.Write([]byte(`{"events":[],"next_cursor":null}`))
		case strings.HasPrefix(r.URL.Path, "/v1/deletion/receipts"):
			_, _ = w.Write([]byte(`{"receipts":[],"next_cursor":null}`))
		case strings.HasPrefix(r.URL.Path, "/v1/rights/requests"):
			_, _ = w.Write([]byte(`{"requests":[],"next_cursor":null}`))
		case strings.HasPrefix(r.URL.Path, "/v1/audit"):
			_, _ = w.Write([]byte(`{"items":[],"next_cursor":null}`))
		}
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	ctx := context.Background()

	if _, err := c.ListArtefacts(ctx, ListArtefactsParams{
		PropertyID: "P", DataPrincipalIdentifier: "u@x", IdentifierType: "email",
		Status: "granted", Cursor: "cur", Limit: 50,
	}); err != nil {
		t.Fatalf("ListArtefacts: %v", err)
	}
	for _, want := range []string{"property_id=P", "identifier_type=email", "status=granted", "cursor=cur", "limit=50"} {
		if !strings.Contains(lastQuery, want) {
			t.Errorf("ListArtefacts query missing %q: %s", want, lastQuery)
		}
	}

	if _, err := c.ListEvents(ctx, ListEventsParams{
		PropertyID: "P", DataPrincipalIdentifier: "u@x", IdentifierType: "email",
		Cursor: "c2", Limit: 25,
	}); err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
	for _, want := range []string{"property_id=P", "limit=25", "cursor=c2"} {
		if !strings.Contains(lastQuery, want) {
			t.Errorf("ListEvents query missing %q: %s", want, lastQuery)
		}
	}

	if _, err := c.ListDeletionReceipts(ctx, ListDeletionReceiptsParams{
		DeletionRequestID: "dr-1", Cursor: "c3", Limit: 10,
	}); err != nil {
		t.Fatalf("ListDeletionReceipts: %v", err)
	}
	for _, want := range []string{"deletion_request_id=dr-1", "limit=10"} {
		if !strings.Contains(lastQuery, want) {
			t.Errorf("ListDeletionReceipts query missing %q: %s", want, lastQuery)
		}
	}

	if _, err := c.ListRightsRequests(ctx, ListRightsRequestsParams{
		PropertyID: "P", Status: "open", RequestType: "access", Cursor: "c4", Limit: 5,
	}); err != nil {
		t.Fatalf("ListRightsRequests: %v", err)
	}
	for _, want := range []string{"status=open", "request_type=access", "cursor=c4"} {
		if !strings.Contains(lastQuery, want) {
			t.Errorf("ListRightsRequests query missing %q: %s", want, lastQuery)
		}
	}

	if _, err := c.ListAuditLog(ctx, ListAuditLogParams{
		Action: "create", Subject: "s-1", Cursor: "c5", Limit: 20,
	}); err != nil {
		t.Fatalf("ListAuditLog: %v", err)
	}
	for _, want := range []string{"action=create", "subject=s-1", "limit=20"} {
		if !strings.Contains(lastQuery, want) {
			t.Errorf("ListAuditLog query missing %q: %s", want, lastQuery)
		}
	}
}

// Exercises TriggerDeletion happy path with full optional set so
// every body branch is covered.
func TestTriggerDeletion_HappyPathFullBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"deletion_request_id":"dr","reason":"consent_revoked","created_at":"t","initial_status":"queued"}`))
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	out, err := c.TriggerDeletion(context.Background(), TriggerDeletionParams{
		PropertyID: "P", DataPrincipalIdentifier: "u", IdentifierType: "email",
		Reason: DeletionReasonConsentRevoked, PurposeCodes: []string{"marketing"},
		ScopeOverride: "org", ActorType: "operator", ActorRef: "op-1",
		ClientRequestID: "req-1", TraceID: "tr",
	})
	if err != nil {
		t.Fatalf("TriggerDeletion: %v", err)
	}
	if out.DeletionRequestID != "dr" {
		t.Errorf("dr = %q", out.DeletionRequestID)
	}
}

// Exercises CreateRightsRequest happy path with all optional fields.
func TestCreateRightsRequest_HappyPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"rights_request_id":"rr","status":"open","created_at":"t"}`))
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	out, err := c.CreateRightsRequest(context.Background(), CreateRightsRequestParams{
		PropertyID: "P", DataPrincipalIdentifier: "u", IdentifierType: "email",
		RequestType: RightsRequestTypeAccess, IdentityVerifiedBy: "otp",
		CapturedVia: "portal", Notes: "x", ClientRequestID: "rq",
	})
	if err != nil {
		t.Fatalf("CreateRightsRequest: %v", err)
	}
	if out.RightsRequestID != "rr" {
		t.Errorf("rr = %q", out.RightsRequestID)
	}
}

func TestRecordConsent_FullOptionalsAndRejected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"event_id":"e","created_at":"t","artefact_ids":[],"idempotent_replay":true}`))
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	_, err := c.RecordConsent(context.Background(), RecordConsentParams{
		PropertyID: "P", DataPrincipalIdentifier: "u", IdentifierType: "email",
		PurposeDefinitionIDs:         []string{"PD1"},
		RejectedPurposeDefinitionIDs: []string{"PD2"},
		CapturedAt:                   "2026-04-25T00:00:00Z",
		CapturedVia:                  "banner",
		NoticeVersionID:              "nv-1",
		ClientRequestID:              "req-1",
		TraceID:                      "tr",
	})
	if err != nil {
		t.Fatalf("RecordConsent: %v", err)
	}
}

func TestRecordConsent_InvalidEntries(t *testing.T) {
	c, _ := NewClient(Config{APIKey: "cs_live_ok"})
	cases := []RecordConsentParams{
		{PropertyID: "", DataPrincipalIdentifier: "u", IdentifierType: "email", PurposeDefinitionIDs: []string{"a"}},
		{PropertyID: "P", DataPrincipalIdentifier: "", IdentifierType: "email", PurposeDefinitionIDs: []string{"a"}},
		{PropertyID: "P", DataPrincipalIdentifier: "u", IdentifierType: "", PurposeDefinitionIDs: []string{"a"}},
		{PropertyID: "P", DataPrincipalIdentifier: "u", IdentifierType: "email", PurposeDefinitionIDs: []string{""}},
		{PropertyID: "P", DataPrincipalIdentifier: "u", IdentifierType: "email", PurposeDefinitionIDs: []string{"a"}, RejectedPurposeDefinitionIDs: []string{""}},
	}
	for i, p := range cases {
		if _, err := c.RecordConsent(context.Background(), p); err == nil {
			t.Errorf("case %d: expected error", i)
		}
	}
}

func TestVerifyBatch_HappyPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"property_id":"P","identifier_type":"email","purpose_code":"p","evaluated_at":"t","results":[{"identifier":"a","status":"granted","active_artefact_id":null,"revoked_at":null,"revocation_record_id":null,"expires_at":null}]}`))
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	out, err := c.VerifyBatch(context.Background(), VerifyBatchParams{
		PropertyID: "P", IdentifierType: "email", PurposeCode: "p",
		Identifiers: []string{"a", "b"}, TraceID: "tr",
	})
	if err != nil {
		t.Fatalf("VerifyBatch: %v", err)
	}
	if out.Envelope == nil || len(out.Envelope.Results) != 1 {
		t.Errorf("envelope = %+v", out.Envelope)
	}
}

func TestVerifyBatch_4xxAlwaysSurfacesEvenWhenFailOpen(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/problem+json")
		http.Error(w, `{"title":"bad","detail":"422"}`, http.StatusUnprocessableEntity)
	}))
	defer srv.Close()

	c := newTestClient(t, srv, func(c *Config) { *c = c.WithFailOpen(true) })
	_, err := c.VerifyBatch(context.Background(), VerifyBatchParams{
		PropertyID: "P", IdentifierType: "email", PurposeCode: "p",
		Identifiers: []string{"a"},
	})
	if !IsAPIError(err) {
		t.Errorf("want APIError, got %v", err)
	}
}

func TestRevokeArtefact_Validates(t *testing.T) {
	c, _ := NewClient(Config{APIKey: "cs_live_ok"})
	if _, err := c.RevokeArtefact(context.Background(), RevokeArtefactParams{}); err == nil {
		t.Error("expected error on missing ArtefactID")
	}
}

func TestVerifyBatch_RequiresFields(t *testing.T) {
	c, _ := NewClient(Config{APIKey: "cs_live_ok"})
	cases := []VerifyBatchParams{
		{IdentifierType: "email", PurposeCode: "p", Identifiers: []string{"a"}},
		{PropertyID: "P", PurposeCode: "p", Identifiers: []string{"a"}},
		{PropertyID: "P", IdentifierType: "email", Identifiers: []string{"a"}},
	}
	for i, p := range cases {
		if _, err := c.VerifyBatch(context.Background(), p); err == nil {
			t.Errorf("case %d: expected error", i)
		}
	}
}

func TestGetArtefact_BasicHappyPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"artefact_id":"a","property_id":"P","purpose_definition_id":"PD","purpose_code":"c","identifier_type":"email","data_principal_identifier":"u","status":"granted","granted_at":"t","expires_at":null,"revocation":null}`))
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	out, err := c.GetArtefact(context.Background(), "a", "tr")
	if err != nil {
		t.Fatalf("GetArtefact: %v", err)
	}
	if out == nil || out.ArtefactID != "a" {
		t.Errorf("out = %+v", out)
	}
}

func TestGetArtefact_RequiresID(t *testing.T) {
	c, _ := NewClient(Config{APIKey: "cs_live_ok"})
	if _, err := c.GetArtefact(context.Background(), "", ""); err == nil {
		t.Error("expected error")
	}
}

func TestTransport_NetworkErrorThenFailOpenSurfacesNetworkCause(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Hijack and close to provoke a transport-level error.
		hj, ok := w.(http.Hijacker)
		if !ok {
			http.Error(w, "no hijack", 500)
			return
		}
		conn, _, _ := hj.Hijack()
		_ = conn.Close()
	}))
	defer srv.Close()

	c := newTestClient(t, srv, func(c *Config) { *c = c.WithFailOpen(true) })
	out, err := c.Verify(context.Background(), VerifyParams{
		PropertyID: "P", DataPrincipalIdentifier: "u", IdentifierType: "email", PurposeCode: "p",
	})
	if err != nil {
		t.Fatalf("fail-open should swallow network error: %v", err)
	}
	if out.Open == nil || out.Open.Cause != OpenCauseNetwork {
		t.Errorf("open = %+v", out.Open)
	}
}
