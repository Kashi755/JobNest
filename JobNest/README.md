# JobNest — Real-Time Job Discovery (Starter)

A responsive React + JavaScript (JSX) frontend starter for a job discovery portfolio project.

## Included in this starter

- Search jobs by role, company, skill, and location
- Filter by workplace type and experience level
- Sort by newest/oldest demo posting time
- Save jobs locally when signed out and to a private account list when signed in
- Email/password sign-up and sign-in with password recovery
- India job listings imported from Adzuna or configured public Greenhouse/Lever boards through Supabase Edge Functions
- Job details modal
- Responsive layout
- JavaScript + JSX source files (no TypeScript required)
- Sample job records clearly labeled as demo data

## Connect Supabase and authentication

1. Create a project in the Supabase dashboard.
2. Open **SQL Editor**, paste `supabase/schema.sql`, and run it. This creates the jobs and user-scoped saved-jobs tables, enables Row Level Security, and deactivates the old fictional Supabase seed listings. The script is safe to rerun.
3. In **Project Settings → API**, copy the project URL and publishable/anon key.
4. Copy `.env.example` to `.env.local` and fill in your values:

   ```env
   VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
   ```

5. Restart Vite after editing environment variables.

6. In **Authentication → Providers**, enable email/password sign-in. In **Authentication → URL Configuration**, set your Site URL and allow the deployed site's `/update-password` URL plus `http://localhost:5173/update-password` for local testing. Password-reset emails return to that route.

When configured, the app loads active jobs from Supabase and subscribes to changes on `public.jobs`. Saved jobs are associated with the signed-in user's ID and protected by row-level security. Signed-out saves remain in that browser.

**Security:** Use only the publishable/anon key in frontend code, never the `service_role` key. The server-side job sync uses the service-role key from Supabase's function environment; do not add it to `.env.local` or frontend code.

## Import India listings from Adzuna

JobNest imports source-linked India listings via a Supabase Edge Function. Adzuna requires an app ID and app key; register at [developer.adzuna.com](https://developer.adzuna.com/overview). Keep those values server-side.

1. Set the following secrets in **Supabase → Edge Functions → Secrets**:
   - `ADZUNA_APP_ID`
   - `ADZUNA_APP_KEY`
   - `JOB_SYNC_TOKEN` (generate a separate, long random token)
2. Deploy the function from this project with the Supabase CLI:

   ```bash
   supabase functions deploy sync-adzuna --no-verify-jwt
   ```

3. Trigger a sync with an authenticated server-side request to `POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/sync-adzuna`, including `x-job-sync-token: YOUR_JOB_SYNC_TOKEN`. Do not call the function from the browser or expose the token there.
4. Schedule that same POST request with Supabase Cron or another trusted scheduler. A successful sync stores up to 100 recent results, links applications to Adzuna, and deactivates listings older than 45 days.

The job board links back to Adzuna and asks applicants to confirm listing details on the employer site. Adzuna may require API approval or impose usage limits; follow the provider's current API terms. Without Adzuna credentials and a completed Adzuna sync, no Adzuna listings are imported.

## Import public Greenhouse and Lever listings

JobNest can also sync public job boards from employers using Greenhouse or Lever. This does not need provider API keys, but you must configure each employer board you want to include. Public endpoints and access do not guarantee permission for every reuse; check the relevant provider and employer terms.

1. Run `supabase/schema.sql` again in the Supabase SQL Editor. It adds the nullable `last_seen_at` field used to safely deactivate listings that disappear from a successfully fetched employer board.
2. Set `JOB_SYNC_TOKEN` in **Supabase → Edge Functions → Secrets**, using the same long random token as the Adzuna sync if desired.
3. Set `ATS_BOARDS` as a JSON array in **Supabase → Edge Functions → Secrets**. Each entry needs a provider, the employer's ATS board identifier, and the company name. `location` is an optional fallback:

   ```json
   [
     {
       "provider": "greenhouse",
       "board": "employer-board-token",
       "company": "Employer Name",
       "location": "India"
     },
     {
       "provider": "lever",
       "board": "employer-site-name",
       "company": "Another Employer"
     }
   ]
   ```

   These are placeholders; replace them with real board identifiers. Greenhouse identifiers come from the employer's Greenhouse job board URL, and Lever identifiers come from its Lever postings URL.
4. Deploy the function:

   ```bash
   supabase functions deploy sync-ats --no-verify-jwt
   ```

5. Trigger `POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/sync-ats` from a trusted server-side request with the `x-job-sync-token: YOUR_JOB_SYNC_TOKEN` header. Never put the token in frontend code. Schedule the same request with Supabase Cron or another trusted scheduler.

The function fetches all configured feeds before changing the database. It stores each board under its own source name, links directly to the employer's listing, and deactivates only that board's jobs missing from a successful feed. A failed feed does not cause its existing jobs to be deactivated.

Without Supabase credentials, the app uses local demo data and labels it as sample listings.

## Run locally

Requirements: Node.js 20+ recommended.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

To verify the production build:

```bash
npm run build
npm run preview
```

The local fallback listings in `src/data/jobs.js` are fictional demo data, not real vacancies. A configured app never falls back to those demo listings if the database or feed is unavailable.
