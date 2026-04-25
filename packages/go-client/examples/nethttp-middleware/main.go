// Standalone net/http demo. Build + run:
//
//	cd packages/go-client/examples/nethttp-middleware
//	CS_API_KEY=cs_live_... CS_PROPERTY_ID=PROP_UUID go run .
//
//	curl -X POST http://localhost:4040/api/marketing/send \
//	     -H 'Content-Type: application/json' \
//	     -d '{"email":"user@example.com"}'

//go:build ignore

package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	consentshield "github.com/consentshield-org/go-client"
	mw "github.com/consentshield-org/go-client/examples/nethttp-middleware"
)

func main() {
	apiKey := os.Getenv("CS_API_KEY")
	propID := os.Getenv("CS_PROPERTY_ID")
	if apiKey == "" || propID == "" {
		log.Fatal("CS_API_KEY and CS_PROPERTY_ID env vars are required")
	}

	client, err := consentshield.NewClient(consentshield.Config{APIKey: apiKey})
	if err != nil {
		log.Fatal(err)
	}

	verify := mw.Wrap(client, mw.Options{
		PropertyID:     propID,
		PurposeCode:    "marketing",
		IdentifierType: "email",
		GetIdentifier: func(r *http.Request) string {
			var body struct {
				Email string `json:"email"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			return body.Email
		},
	})

	mux := http.NewServeMux()
	mux.Handle("/api/marketing/send", verify(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"sent":true}`))
	})))

	log.Println("listening on :4040")
	log.Fatal(http.ListenAndServe(":4040", mux))
}
