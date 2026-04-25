package consentshield

// Client is the ConsentShield API client. Construct with NewClient
// and pass it through your service. Concurrency-safe.
type Client struct {
	cfg       *resolvedConfig
	transport *transport
}

// NewClient validates the config and returns a usable client.
//
//	client, err := consentshield.NewClient(consentshield.Config{
//	    APIKey: os.Getenv("CS_API_KEY"),
//	})
func NewClient(cfg Config) (*Client, error) {
	resolved, err := resolveConfig(cfg)
	if err != nil {
		return nil, err
	}
	return &Client{
		cfg:       resolved,
		transport: &transport{cfg: resolved},
	}, nil
}

// FailOpen reports the resolved fail-open posture (after env override
// + explicit option). Useful for log surfacing on boot.
func (c *Client) FailOpen() bool { return c.cfg.FailOpen }

// BaseURL reports the resolved API base URL.
func (c *Client) BaseURL() string { return c.cfg.BaseURL }

// WithFailOpen returns a copy of the config with FailOpen explicitly
// set; the explicit value wins over CONSENT_VERIFY_FAIL_OPEN.
func (c Config) WithFailOpen(v bool) Config {
	c.FailOpen = v
	c.failOpenSet = true
	return c
}
