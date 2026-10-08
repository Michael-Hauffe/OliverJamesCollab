# LinkedIn Profile Scraper

A TypeScript/TanStack Start application for extracting and normalizing LinkedIn profile data through authenticated sessions and configurable scraping providers.

## Features

- LinkedIn profile extraction through the Voyager API
- Public profile lookup through Firecrawl when no session is available
- Optional scraping-provider relays (ScrapingBee, ScraperAPI, ZenRows) for public pages
- Structured profile normalization
- Cookie/session validation
- JSON and CSV export
- Batch scraping from an imported `Profiles.csv`
- People search that writes new profile links to `profilesv2.csv`
- Proxy pool for cookie-session requests: sticky per session, automatic failover

## Batch scraping

On the Dashboard, **Import CSV** loads a `Profiles.csv` whose column A is headed `Profile Link`, with one LinkedIn profile URL per row. Duplicate profiles are dropped on import. **Scrape all** scrapes each profile with the selected mode (public, API key or cookie session), pausing 5 seconds ± a random 0–3 seconds between profiles. The batch stops early on errors that would fail every remaining row (missing or expired session, verification challenge, rate limiting). **Export all** downloads every result as JSON or long-format CSV, keyed by the input link; failed rows are included with their error code.

## Proxies

Cookie-session requests to LinkedIn (profile, skills, contact info and the session test) can go out through HTTP(S) proxies instead of the server's own IP.

- **Where proxies come from:** a list saved in **Settings → Proxies** (kept in that browser tab and sent with each request) replaces the server pool set in `PROXY_URLS`. With neither, requests go direct, unless `PROXY_REQUIRED=true`, in which case they are refused.
- **Sticky sessions:** each LinkedIn session (identified by a hash of its `li_at` cookie) keeps the same proxy, because a logged-in session that keeps changing IP is more likely to hit a verification checkpoint.
- **Failover:** a proxy that fails to connect, rejects its credentials (HTTP 407) or gets blocked by LinkedIn (HTTP 999/429) is benched for 10 minutes, doubling on repeat failures up to an hour, and the request is retried through the next healthy proxy (up to 3 tries). Once proxies are configured, requests never silently fall back to a direct connection.
- **Test proxies** in Settings shows each proxy's exit IP (via api.ipify.org), latency and whether LinkedIn answers through it.
- **Safety:** proxies sent from a browser may not resolve to loopback or private network addresses (set `ALLOW_PRIVATE_PROXIES=true` on a self-hosted instance to allow that). Proxy credentials are never logged or shown in error messages.

Public lookup (Firecrawl) and the scraping-API mode are not proxied: those requests already run through the provider's own infrastructure. Proxying relies on Node's networking (undici), so it needs the default Node server deployment rather than an edge/worker runtime. SOCKS proxies are not supported.

## Profile search

Under **Find profiles**, describe the people you want (for example `data science recruiters`) and press **Create profilesv2.csv**. The server searches for matching `linkedin.com/in/` profiles through Firecrawl, removes duplicates and any profile already in the imported `Profiles.csv`, and downloads `profilesv2.csv` with a single `Profile Link` column. Requires `FIRECRAWL_API_KEY`.
- Server-side execution for provider credentials and session data

## Requirements

- Bun
- A Firecrawl API key for public lookup
- An OpenAI API key for optional public-web enrichment

## Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Required for public lookup:

```env
FIRECRAWL_API_KEY=
```

Optional proxies (see [Proxies](#proxies)):

```env
PROXY_URLS=
PROXY_REQUIRED=false
```

Optional AI enrichment:

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5
```

Provider API keys can also be supplied through the application's Settings UI.

## Development

```bash
bun install
bun run dev
```

## Verification

```bash
bun run check
bun run build
```

## Architecture

The application keeps scraping orchestration on the server:

```text
UI
  |
  v
Server Functions
  |
  +--> LinkedIn Voyager client
  |       |
  |       +--> entity resolution
  |       +--> section parsers
  |       +--> profile normalization
  |
  +--> Public web research
          |
          +--> Firecrawl
          +--> optional AI extraction
```

Sensitive credentials and LinkedIn session cookies are never required in client-side environment variables. Server functions receive request-scoped credentials and pass them only to the relevant provider.

## Data handling

LinkedIn session cookies are treated as request credentials and should never be committed to source control or logged. Use a short-lived development session where possible and rotate credentials if they are exposed.

## Limitations

LinkedIn's internal Voyager APIs are undocumented and may change without notice. Public profile visibility, upstream rate limits, provider availability, and account/session state can affect extraction completeness.

Use the application only where you have the right to access and process the requested data and in accordance with applicable platform terms and laws.
