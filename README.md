# LinkedIn Profile Scraper

A TypeScript/TanStack Start application for extracting and normalizing LinkedIn profile data through authenticated sessions and configurable scraping providers.

## Features

- LinkedIn profile extraction through the Voyager API
- Public profile lookup through Firecrawl when no session is available
- Optional scraping-provider relays
- Structured profile normalization
- Cookie/session validation
- JSON and CSV export
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
