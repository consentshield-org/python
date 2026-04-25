import type { MetadataRoute } from 'next'

// Confidential preview — fully blocked from indexing + AI training.
//
// The marketing site is gated to invited prospects only (Layer 2 — see
// the gate ADR). robots.txt is the public belt-and-braces declaration:
// every well-behaved crawler should refuse to index, and every named AI
// trainer should refuse to ingest. Layered with `<meta name="robots">`
// in the root layout and `X-Robots-Tag` in next.config.ts so non-
// compliant or sloppy bots still face server-side and document-level
// disallow.
//
// AI-crawler list curated from the public crawler-policy pages of each
// vendor as of 2026-04-25. Update on review when new ones surface.
export default function robots(): MetadataRoute.Robots {
  const aiCrawlers = [
    'GPTBot',
    'ChatGPT-User',
    'OAI-SearchBot',
    'ClaudeBot',
    'Claude-Web',
    'anthropic-ai',
    'CCBot',
    'Google-Extended',
    'Applebot-Extended',
    'PerplexityBot',
    'Perplexity-User',
    'Bytespider',
    'cohere-ai',
    'Diffbot',
    'FacebookBot',
    'Meta-ExternalAgent',
    'Meta-ExternalFetcher',
    'YouBot',
    'Amazonbot',
    'omgili',
    'omgilibot',
    'PetalBot',
    'Timpibot',
    'ImagesiftBot',
  ]

  return {
    rules: [
      // Generic search-engine crawlers — disallow site-wide.
      { userAgent: '*', disallow: '/' },
      // AI training / inference crawlers — explicit disallow per vendor.
      ...aiCrawlers.map((userAgent) => ({ userAgent, disallow: '/' })),
    ],
    // No sitemap surfaced — the site is not for indexing.
  }
}
