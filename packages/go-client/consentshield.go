// Package consentshield is the official Go client library for the
// ConsentShield DPDP compliance API.
//
// The package mirrors the @consentshield/node and `consentshield`
// (Python) SDKs 1:1 — same 14-method surface, same compliance
// contract, same fail-CLOSED default.
//
// # Quickstart
//
//	client, err := consentshield.NewClient(consentshield.Config{
//	    APIKey: os.Getenv("CS_API_KEY"),
//	})
//	if err != nil { log.Fatal(err) }
//
//	out, err := client.Verify(ctx, consentshield.VerifyParams{
//	    PropertyID:              "PROP_UUID",
//	    DataPrincipalIdentifier: "user@example.com",
//	    IdentifierType:          "email",
//	    PurposeCode:             "marketing",
//	})
//	if err != nil { /* fail-CLOSED: 503 your caller */ }
//	if out.Status != "granted" { /* 451 your caller */ }
//
// # Compliance contract (non-negotiable)
//
//   - 4xx ALWAYS returns error (caller bug / scope / 422 / 404 / 413).
//   - timeout / network / 5xx + FailOpen=false (default) returns
//     ConsentVerifyError wrapping the cause.
//   - timeout / network / 5xx + FailOpen=true returns a non-nil
//     OpenFailure on VerifyOutcome (Status="open_failure" + Cause).
//
// The fail-CLOSED default is the safe one — when ConsentShield is
// briefly unreachable, your service stops marketing/analytics writes
// rather than silently default-granting consent that may have been
// withdrawn 30 seconds ago.
package consentshield

// Version is the consentshield-go module version.
const Version = "1.0.0"
