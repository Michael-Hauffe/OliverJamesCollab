# Profile Fetcher

https://github.com/Shreyaan/linkedin-profile-api?utm_source=chatgpt.com

Use the existing GitHub repository already imported into this Replit project as the foundation. Do not rebuild the application from scratch and do not replace working backend functionality unnecessarily.



Build this into a polished, standalone LinkedIn profile scraping application for a client.



IMPORTANT: Minimize Replit/Agent credit usage



- First inspect the existing repository and understand its current frontend/backend architecture.

- Reuse as much existing code as possible.

- Do not rewrite working backend scraping logic.

- Do not add unnecessary dependencies, databases, authentication systems, AI features, analytics, or paid services.

- Make targeted changes only where required.

- Do not create unnecessary files.

- Before making major architectural changes, prefer the simplest existing implementation.

- The application must remain deployable on Replit.



Core functionality



The application should allow the client to:



1. Enter a LinkedIn profile URL.

2. Scrape the profile.

3. Display the returned structured profile information clearly.

4. Show loading, success, empty, and error states.

5. Export the result as JSON and CSV where practical.

6. Clearly show whether the LinkedIn session is configured.



Use the repository's existing scraping implementation. Do not invent a different scraping system unless the current implementation is broken.



Frontend/UI



Create a professional, restrained UI that looks like software built by an experienced senior developer, NOT a generic AI-generated dashboard.



Use:



- clean typography

- strong spacing and hierarchy

- subtle borders

- restrained colors

- responsive layout

- polished tables/profile sections

- useful empty/loading/error states

- minimal animations

- no excessive gradients

- no oversized decorative cards

- no unnecessary dashboard widgets



Keep the UX simple so the client immediately understands what to do.



Suggested navigation:



Dashboard

Settings



Dashboard



Include:



- LinkedIn profile URL input

- Scrape button

- clear scraping status

- results area

- profile information

- experience

- education

- skills

- certifications

- languages

- export controls



Do not display sections that have no data.



Settings



Create a clean Settings page with:



LinkedIn Session



- Cookie Header input

- masked/password-style display

- Save/Update button

- Test Connection button

- connection status



The current repository uses LinkedIn session cookies for its Voyager-based scraping. Preserve that behavior.



The cookie header must NEVER be:



- exposed in the frontend source

- printed to logs

- included in error messages

- committed to Git

- unnecessarily persisted in browser localStorage



If the existing architecture supports request-scoped cookies, preserve that approach.



Proxy



Add optional proxy configuration only if the existing backend can safely support it without a major rewrite.



Fields:



- Enable Proxy

- Proxy URL

- Test Proxy



Proxy should be OFF by default.



Do not implement proxy rotation, anti-detection, CAPTCHA bypass, or mechanisms designed to evade LinkedIn security/rate limits.



Scraping



Include only useful existing configuration such as:



- request timeout

- reasonable request limit/rate setting

- cache on/off if already supported



Do not add unnecessary settings.



Export



Allow choosing the preferred export format if this can be implemented simply.



Backend



Preserve the existing FastAPI backend and scraping implementation.



Make sure:



- frontend communicates correctly with backend

- API errors are handled cleanly

- health check works

- CORS is correctly configured for the deployed frontend

- environment variables are documented

- secrets are never hardcoded

- the application can run correctly on Replit



If the repository does not require an environment variable for normal scraping, do not invent one.



Testing



After implementation:



1. Start the application.

2. Test frontend → backend communication.

3. Test health endpoint.

4. Test the scraper with a valid LinkedIn session when available.

5. Test missing-cookie behavior.

6. Test invalid LinkedIn URL behavior.

7. Test export.

8. Test Settings save/update behavior.

9. Fix any errors you introduce.

10. Confirm the production/deployment configuration works on Replit.



Critical constraint



Do NOT claim the scraper works if it has not actually been tested.



At the end, give me a concise report containing:



- files changed

- dependencies added, if any

- environment variables actually required

- how to run it

- what was tested

- any remaining limitation



Prioritize working functionality, simplicity, reliability, and low Replit credit usage over adding extra features.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/430ac8b6-8050-4307-b67b-f4cd5db7b58b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
