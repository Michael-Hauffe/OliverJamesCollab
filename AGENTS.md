<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- LinkedIn scraping lives in `src/lib/linkedin/scraper.server.ts` (a port of Shreyaan/linkedin-profile-api), exposed via `src/lib/linkedin.functions.ts`; the cookie header is sent per request from tab sessionStorage and never stored server-side or logged — keeps the app stateless and the secret off disk.
- Optional scraping-API relay (key auto-detected in `src/lib/linkedin/providers.ts`) is tried first per scrape and falls back stickily to direct session fetch on provider failure; key/proxy live in tab sessionStorage like the cookie — keeps secrets off the server.
- With no session and no user relay key, scraping uses a Firecrawl search of the public listing (LinkedIn blocks server IPs with 999); no exact slug match returns `session_required` so the UI tells the user to add a session.
