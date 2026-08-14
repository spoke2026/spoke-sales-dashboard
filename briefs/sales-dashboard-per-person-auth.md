╔═══════════════════════════════════════════════════╗
║  PAM BRIEF                                        ║
║  Project: Sales dashboard — per-person auth + admin editing rebuild ║
║  Complexity: LARGE                                ║
║  Roscoe Sign-off: APPROVED ✓ (independent Roscoe review: APPROVE WITH CHANGES — required edits folded in) ║
╚═══════════════════════════════════════════════════╝

━━━ GOAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Replace the sales dashboard's shared Basic Auth popup and client-side PIN with per-person Supabase logins, and rebuild the target-editing surface into a clean, on-brand admin panel, so every team member signs in as themselves and can view the dashboard while only edward@spoke.nz can edit monthly sales budgets and KPI targets, enforced at the database with RLS rather than in the browser.

━━━ SCOPE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IN:
  • A new Spoke-branded sign-in page at /login (email + password) that replaces the browser's native Basic Auth popup.
  • Supabase session enforcement in middleware.js replacing the shared Basic Auth credential. Every page route requires a valid session; /login and static assets are public. Fails closed.
  • Two-tier authorisation: any authenticated user gets the read-only dashboard; only edward@spoke.nz can write targets and budgets.
  • Removal of the NEXT_PUBLIC_ADMIN_PIN gate, the 🔒/🔓 lock button, the PIN modal, and all related state. Admin edit affordances render only for the signed-in admin, with no unlock step.
  • RLS on the targets table: authenticated SELECT for all logged-in users; INSERT/UPDATE/DELETE restricted to admin via a SECURITY DEFINER public.is_admin() function. New migration file.
  • Rework the targets read/write paths so both run through the user's authenticated Supabase session (not the anon key): /api/targets POST does a server-side session + admin check before writing; /api/dashboard reads targets through the session and requires a valid session.
  • REBUILD the admin editing UX: replace the dense, inline-styled PIN-gated "Edit Targets" modal with a clean, design-system-compliant "Edit monthly targets" panel. Edit the sales budget and each rep's KPI targets (connected calls, face-to-face visits, pipeline value) with clear labelled fields, DM Mono numeric formatting, inline validation, an auto-calculated team total, an obvious Save, and a live dashboard refresh on save (no manual reload).
  • Sign out control on the dashboard header, replacing the lock/PIN button.
  • Adopt @supabase/ssr for cookie-based session handling (browser, server, and middleware clients).

OUT:
  • Self sign-up, open registration, or any invite UI. Edward provisions all accounts in the Supabase dashboard.
  • In-app self-service password reset / "forgot password" flow. Password management is handled by Edward in the Supabase dashboard (see Open Questions for rationale). No /reset or update-password pages in this build.
  • Any change to HubSpot data fetching (lib/hubspot.js), the 15-minute refresh schedule, the metrics maths, the charts, the drill-down modals (deal band, calls, pipeline), or the dashboard's read-only visuals beyond the auth controls and the admin edit panel.
  • Any change to the metric cards, the top sales card, the header brand row, or the month/rep selectors, beyond swapping the lock/PIN button for Sign out + admin-gated Edit targets.
  • Any change to the separate spoke-sales-confidence project.
  • Multi-role permissions beyond one-admin / everyone-else-read-only. Admin identity is not configurable.
  • DNS / Vercel domain config (dashboard.spoke.nz vs dashboard-sales.spoke.nz is a ship-time confirmation, not a build task).

━━━ SUCCESS CRITERIA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
App code is verified on the Vercel PREVIEW deployment before merge. DB CAVEAT: the project uses a single Supabase URL/key pair, so Preview and Production almost certainly point at the SAME Supabase project. Preview verifies the app code; it is NOT a database rollback boundary. Running the migration is a single, immediate, production-affecting action. The RLS acceptance tests below can only pass once the migration has run against the shared project — sequence per the deployment checklist.

Session perimeter (fail closed):
  □ In a fresh browser with no session, navigating to / redirects to /login within 2 seconds (no Basic Auth popup ever appears).
  □ With no session, navigating to /login renders the Spoke sign-in page (no redirect loop).
  □ With a Supabase env var unset in the preview, every page route returns a 503 deny and serves no dashboard content (restore env after testing).
  □ If the session check throws at runtime (e.g. Auth API unreachable), the request is denied (redirect to /login), never allowed through.

Sign in / sign out (happy + error):
  □ A team member enters their valid email and password on /login, clicks "Log in", and lands on / (the dashboard) within 3 seconds.
  □ A user enters a correct email but wrong password, stays on /login, and sees "Email or password is wrong. Try again." No redirect occurs.
  □ A user submits /login with an empty email or empty password: the browser's required-field validation blocks submission (form does not post).
  □ A signed-in user clicks "Sign out" in the header: the session is cleared and they land on /login. Navigating back to / then redirects to /login.

Read-only for all authenticated users:
  □ Any signed-in user sees the full dashboard (sales, calls, visits, pipeline, deal age) with live HubSpot data and current targets loaded from Supabase.
  □ A non-admin signed-in user does NOT see an "Edit targets" button in the header or mobile menu. There is no PIN button or lock icon anywhere.

Admin editing UX (edward@spoke.nz):
  □ Edward signs in and sees an "Edit targets" button in the header. Clicking it opens the "Edit monthly targets" panel with the current sales budget and each rep's calls, visits, and pipeline values pre-filled.
  □ The panel shows a clearly labelled field per value, dollar amounts formatted for reading (e.g. "$60,000"), and a read-only "Team total" that updates automatically as Ed's and Mark's numbers are changed.
  □ Edward changes the sales budget and a rep KPI, clicks "Save targets", sees a "Targets saved" confirmation, the panel closes, and the dashboard numbers (target lines, pace, budget) refresh live within ~2 seconds without a manual page reload.
  □ Entering a negative number or a blank in a required field shows an inline error ("Enter a number of 0 or more") and blocks save until corrected.
  □ Pressing Escape or clicking the scrim closes the panel without saving; reopening shows the last saved values, not the discarded edits.
  □ The panel is keyboard usable: the first field is focused on open, Tab cycles within the panel (focus trap), and Save can be triggered from the keyboard.

Admin write path (server-enforced):
  □ A direct POST to /api/targets carrying Edward's authenticated session cookie succeeds (HTTP 200, { success: true }) and the row is written.

SECURITY — admin surface not visible to anyone but the admin (Edward's explicit ask; these are the concrete tests for the security pass):
  □ A non-admin authenticated user's page contains NO admin edit affordance at all: no "Edit targets" button and no edit-panel markup in the DOM (the panel is conditionally rendered, not merely CSS-hidden). Inspect the DOM to confirm the form does not exist for them.
  □ A logged-out visitor never reaches a page that could render the edit panel (middleware redirects to /login first).
  □ No admin secret ships to the browser: a grep of the source AND the built client bundle (.next) finds no NEXT_PUBLIC_ADMIN_PIN and no PIN value. Admin identity for the write path is decided server-side only via rpc('is_admin'); the client isAdmin flag (email match) is cosmetic and non-security-bearing.
  □ Hiding the button is NOT the control — proven server-side: a direct POST to /api/targets with a NON-admin user's valid session cookie is rejected with HTTP 403 and no targets row is created or changed.
  □ A direct POST to /api/targets with no session cookie is rejected with HTTP 401 and writes nothing.
  □ A direct authenticated REST PATCH/POST on the targets table using a non-admin user's access token plus the anon apikey is rejected by RLS (no row created or changed).
  □ A direct authenticated REST SELECT on targets using a non-admin user's access token returns rows (viewing still works for non-admins).

Anon lockdown:
  □ A direct anon-key REST SELECT on the targets table (no user token) returns zero rows / is rejected by RLS.
  □ A GET to /api/dashboard with no session cookie is rejected with HTTP 401 and returns no HubSpot data (JSON, not an HTML redirect).

Cleanup / regression:
  □ Grep of the repo finds no DASHBOARD_PASSWORD, DASHBOARD_USERNAME, NEXT_PUBLIC_ADMIN_PIN, checkPin, handlePinInput, showPinModal, pinRefs, lockBtn, or Basic Auth "WWW-Authenticate" reference.
  □ No emoji anywhere in app/page.js (the 🔒/🔓 lock button glyphs are gone).
  □ lib/supabase.js no longer exists; lib/targets.js exists and both API routes import from it.
  □ The dashboard still refreshes HubSpot data on the 15-minute interval; month and rep selectors still work; the top sales card, all four metric cards, and all drill-down modals (deal band, calls, pipeline) still render and open/close unchanged.
  □ Production build succeeds and the dashboard, /login, and edit-targets panel render correctly at 900px and 600px.
  □ Pages load with no console errors.

━━━ BUILD CONTEXT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Brownfield change to a LIVE daily tool. Current state grounded from the code, not assumed:
  • middleware.js today enforces one shared HTTP Basic Auth credential (DASHBOARD_USERNAME/DASHBOARD_PASSWORD) on every non-/api route. Fully replaced.
  • app/page.js is a single 'use client' component. Target editing (approx lines 279-702) is gated by a 🔒/🔓 emoji lock button + a client-side 4-digit PIN modal (NEXT_PUBLIC_ADMIN_PIN, default "1234"), which ships to the browser. The "Edit Targets" modal (showTargetModal) is a dense stack of bare number inputs with heavy inline styles. All PIN/lock state and the PIN modal are removed; the edit modal is rebuilt on-brand.
  • app/dashboard.module.css holds the modal, .irow input rows, .btnSave (zest bg), .btnCancel, and the PIN styles (.pinRow, .pinDigit, .pinError) and .lockBtn. The PIN and lock styles are deleted; the edit panel gets its own new classes (see below).
  • app/layout.js loads DM Sans and DM Serif Display via next/font but NOT DM Mono. DM Mono must be added for numeric data per the design system.
  • lib/supabase.js does anon-key REST reads (getTargets) and writes (saveTargets, saveSalesBudget) with no per-user check. /api/targets POST calls these writes with no auth. /api/dashboard GET calls getTargets (anon read).
  • jsconfig maps @/* to the project root. There is no supabase/migrations directory yet, and no @supabase/ssr dependency.

Files to change / create:
  • package.json — add "@supabase/ssr" to dependencies (alongside existing @supabase/supabase-js).
  • lib/supabase/client.js (NEW) — browser client via createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY). Used by the login page and the dashboard client component for signInWithPassword, signOut, and getUser.
  • lib/supabase/server.js (NEW) — server client via createServerClient bound to next/headers cookies, anon key. Used by /api/targets and /api/dashboard to resolve the session and run queries AS the logged-in user so RLS is exercised. Mirror the Tools Hub src/lib/supabase/server.ts cookie getAll/setAll pattern (with the try/catch on setAll).
  • lib/supabase/middleware.js (NEW) — updateSession(request, response) that builds the request-bound createServerClient, calls supabase.auth.getUser() exactly once inside try/catch, and returns { response, user } (user null on absent session OR any error). Does NOT redirect and does NOT decide auth. Mirror Tools Hub src/lib/supabase/middleware.ts in plain JS.
  • middleware.js — REWRITE per the middleware contract below. Remove all Basic Auth logic.
  • lib/targets.js (NEW, renamed from lib/supabase.js) — same getTargets / saveTargets / saveSalesBudget behaviour, refactored so each takes the authenticated Supabase server client as its first argument and runs queries via the client query builder (client.from('targets')...) instead of raw anon-key fetch. Preserve the update-then-insert fallback and the getTargets shape (repMap with Ed/Mark/total/salesBudget and the mock fallback on error). NOTE: the update-then-insert fallback must use .update(...).select() and check for an EMPTY returned array to trigger the insert — the query builder does NOT error on zero rows affected (unlike the current raw-fetch !res.ok check), so a missing row would otherwise be silently skipped.
  • app/api/targets/route.js — build the server client, getUser(); if no user → 401; check admin via supabase.rpc('is_admin'); if not admin → 403 with { error: 'You do not have permission to edit targets.' }; only then call the refactored saveTargets/saveSalesBudget passing the authed client. Keep export const dynamic = 'force-dynamic'. FAIL CLOSED: treat any error from rpc('is_admin') identically to a false result — return 403. Mirror the explicit `if (error) return false` pattern from Tools Hub src/lib/auth.ts. This matters during the deploy window before the migration runs, when the RPC errors because is_admin() does not exist yet. No explicit CSRF token is required: this is a same-origin internal tool and Supabase auth cookies default to SameSite=Lax.
  • app/api/dashboard/route.js — build the server client, getUser(); if no user → 401; pass the authed client into getTargets(client, month). No other logic changes (HubSpot fetch untouched). Keep force-dynamic and no-store headers.
  • app/layout.js — add DM_Mono from next/font/google with variable '--font-mono' (weight 400/500) and append its variable to the <html> className, so numeric data can use var(--font-mono).
  • app/login/page.js (NEW) — Spoke-branded client-component sign-in page. Email + password form. On submit, call the browser client signInWithPassword; on success window.location.assign('/'); on error show "Email or password is wrong. Try again." If already signed in on mount, redirect to /.
  • app/login/login.module.css (NEW) — centred card layout using the CSS variables; page background stone, white card, 40px inputs/buttons, radius 8px on inputs/buttons, 3px zest focus ring. (login page needs its own scroll context because globals.css sets body overflow:hidden.)
  • app/page.js — (a) remove all PIN/lock state (pin, pinRefs, showPinModal, pinError, adminUnlocked, checkPin, handlePinInput) and the entire PIN modal and the 🔒/🔓 lock button in BOTH the header and the mobile menu; (b) on mount read the session user via the browser client and set isAdmin = (user email === 'edward@spoke.nz') and store the email; (c) add a "Sign out" button (browser client signOut → window.location.assign('/login')) shown to every user; (d) render the "Edit targets" button only when isAdmin; (e) REBUILD the target-edit modal as the on-brand "Edit monthly targets" panel per the edit-panel spec below, removing all inline styles in favour of dashboard.module.css classes; (f) preserve/improve the post-save loadData() live refresh; (g) handle 401 (session expired → redirect /login) and 403 ("You do not have permission to edit targets.") from /api/targets.
  • app/dashboard.module.css — delete .lockBtn, .pinRow, .pinDigit, .pinError. Introduce new, dedicated classes for the edit panel (e.g. .editPanel, .editPanelSection, .editField, .editActions) styled to the edit-panel spec. Do NOT modify .modal, .modalSub, .modalActions, .btnCancel, .dealList, .dealBadge, .badgeOk, or .badgeWarn — these are shared with the deal-band/calls/pipeline drill-down modals (app/page.js lines ~539-621) and restyling them regresses the read-only dashboard. Only .btnSave may be restyled (used solely by the target-edit modal and the PIN modal, the latter being deleted). .overlay may take the new scrim/blur treatment since it is a uniform cosmetic change across all modals. Do NOT alter any metric-card, chart, header brand row, or selector styles.
  • supabase/migrations/0001_targets_two_tier_rls.sql (NEW) — the RLS backbone (see migration spec). First migration in the repo; number it 0001. If a reviewer confirms existing numbering, use the next free number, but never edit a pre-existing migration.
  • .env.local.example — remove the NEXT_PUBLIC_ADMIN_PIN line; add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY with placeholder values (used today but undocumented). Leave HubSpot vars untouched. DASHBOARD_USERNAME/DASHBOARD_PASSWORD live only in Vercel and are on the deployment checklist.

Middleware contract (decide once here so Cole is not making a perimeter architecture call mid-build):
  • middleware.js OWNS the allow/deny decision and calls updateSession once.
  • Step 1: if NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing → return new NextResponse('Service unavailable', { status: 503 }) for ALL paths (including /login, so there is no redirect loop).
  • Step 2: const response = NextResponse.next({ request }); const { response: sessionResponse, user } = await updateSession(request, response).
  • Step 3: if pathname === '/login' → return sessionResponse (always reachable, session refreshed).
  • Step 4: if pathname startsWith '/api' → return sessionResponse (never redirect an API call to HTML; handlers self-enforce 401/403 and return JSON; still refreshes the session cookie for polling clients).
  • Step 5: if !user → redirect to /login (deny). Never NextResponse.next() on the error/absent path.
  • Step 6: else return sessionResponse (allow).
  • matcher: '/((?!_next/static|_next/image|favicon.ico|spoke-logo.png|.*\\.[\\w]+$).*)'.

Migration spec (write exactly this shape, wrapped in begin; ... commit;):
  • begin;
  • create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$ select exists (select 1 from auth.users u where u.id = auth.uid() and lower(u.email) = 'edward@spoke.nz') $$;  -- search_path MUST be pinned to public, pg_temp (privilege-escalation guard on the SECURITY DEFINER function).
  • revoke all on function public.is_admin() from public, anon;  grant execute on function public.is_admin() to authenticated;
  • alter table public.targets enable row level security;
  • Dynamically drop EVERY existing policy on public.targets before creating the new ones, so the anon-write hole is closed regardless of the pre-existing policy names (no manual audit required):
      do $$
      declare pol record;
      begin
        for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'targets'
        loop
          execute format('drop policy if exists %I on public.targets', pol.policyname);
        end loop;
      end $$;
  • create policy targets_select_authenticated on public.targets for select to authenticated using (true);
  • create policy targets_insert_admin on public.targets for insert to authenticated with check (public.is_admin());
  • create policy targets_update_admin on public.targets for update to authenticated using (public.is_admin()) with check (public.is_admin());
  • create policy targets_delete_admin on public.targets for delete to authenticated using (public.is_admin());
  • commit;

Edit-panel spec (the rebuilt "Edit monthly targets" admin surface — modal pattern, chosen over inline edit; see Open Questions):
  • Trigger: an "Edit targets" button in the header, rendered only when isAdmin, no emoji, with a 3px zest focus ring.
  • Overlay: scrim = mineral-tinted dark at ~50-60% opacity with a 2px backdrop blur; clicking the scrim closes without saving. (Applied via .overlay — a uniform cosmetic change shared by all modals.)
  • Panel (.editPanel): white card, radius 18px, warm mineral-tinted shadow, padding 48px desktop / 24px at 600px, max-width 500px, centred, max-height with internal scroll.
  • Title: "Edit monthly targets" in DM Serif Display italic weight 400. Subtitle (DM Sans, muted): "Set the sales budget and KPI targets for [Month YYYY]. Team totals update automatically."
  • Sections (.editPanelSection), each led by a 12px uppercase tracked eyebrow label: "Sales budget", "Ed Beatson", "Mark Beatson".
  • Fields (.editField): each is label (DM Sans 14px weight 500, sentence case) + numeric input (type="number", min="0", step appropriate; DM Mono value text; 40px tall; stone-50 bg; 1px soft border; radius 8px; 3px zest focus ring). Dollar fields (sales budget, pipeline value) show a helper line with the formatted value (e.g. "$60,000"). Field labels: "Monthly sales budget", "Connected calls", "Face to face visits", "Pipeline value".
  • Team total: a read-only summary (DM Mono numerals) that recomputes live as Ed/Mark values change: "Team total: calls X, visits Y, pipeline $Z".
  • Validation: values must be integers of 0 or more; invalid or blank required field shows an inline error ("Enter a number of 0 or more") in signal-danger and blocks Save until corrected.
  • Actions (.editActions): "Save targets" = primary button (mineral bg, stone text, 40px, radius 8px, 3px zest focus; may reuse restyled .btnSave). "Cancel" = secondary outline button (reuse existing .btnCancel unchanged). On desktop, actions right-aligned in a row; stacked full-width at 600px.
  • Save behaviour: POST to /api/targets (unchanged payload shape: { month, targets, salesBudget }). On 200 → show "Targets saved" (success colour, no emoji) briefly, then close the panel and call loadData() so the dashboard numbers refresh live without a manual reload. On 401 → redirect to /login (session expired). On 403 → show "You do not have permission to edit targets." On other errors → "We couldn't save the targets. Try again."
  • Keyboard/a11y: first field auto-focused on open; focus trapped within the panel; Escape closes; every control shows the 3px zest focus ring; labels use for/id pairing; error text linked via aria-describedby; success/error region uses role="status"/role="alert".

Patterns to follow:
  • Reuse the Tools Hub server.ts / middleware.ts cookie patterns (getAll/setAll, single getUser, { response, user }), translated to plain JS. Do not invent a new session pattern.
  • Login form structure and copy mirror Tools Hub LoginForm ("Log in", "Email or password is wrong. Try again."), implemented with the browser client to fit this client-heavy JS app.
  • The rebuilt panel reuses the existing modal open/close and save/loadData plumbing already in app/page.js (openTargetModal, saveTargets, editTargets/editSalesBudget state) — keep that data flow, replace the markup and styling. Do not rebuild the save request from scratch.

Hard constraints (must not break):
  • RLS is THE security boundary. The rpc('is_admin') check in /api/targets is a friendly-error convenience only. All target writes must run through the user's authenticated server client so RLS is actually exercised. Never write targets with the anon key or a service-role key.
  • The client isAdmin flag (email match) is cosmetic. It must ONLY conditionally render the edit affordance; it must never be the thing that authorises a write. The edit panel and button must be conditionally rendered (absent from the DOM), not CSS-hidden, for non-admins.
  • is_admin() is the single source of admin truth for both layers: RLS calls the SQL function directly; the app calls supabase.rpc('is_admin'). Do NOT introduce a second source such as an ADMIN_EMAIL env literal.
  • is_admin() must be SECURITY DEFINER, STABLE, with explicit set search_path = public, pg_temp (privilege-escalation guard), execute granted to authenticated only and revoked from public/anon.
  • The /api/targets admin check fails closed: any error from rpc('is_admin') is treated as not-admin (403), matching the Tools Hub `if (error) return false` pattern.
  • Middleware fails CLOSED on both modes: missing Supabase env → 503 for all paths; any exception resolving the session → treat as no user → redirect to /login. Never return an allowed response on an error path.
  • The migration is wrapped in a single begin;/commit; transaction so a mid-script failure cannot leave RLS enabled with no working policies (which would lock everyone, including Edward, out of writes on the live table).
  • Design system (login page, edit panel, and new header controls): DM Serif Display italic weight 400 for headings only (never roman, never bold); DM Sans for UI/body; DM Mono for numeric data and the target values; 8px spacing grid; inputs and modal buttons 40px tall with radius 8px; 3px zest focus ring on every interactive element; mineral/zest/stone palette; never pure black; zest reserved for accents/focus, not body backgrounds; copy in NZ English, sentence case, no em dashes; no emoji anywhere.
  • Header control deviation (deliberate): the header "Sign out" and "Edit targets" buttons match the existing ~30px header control height to stay visually consistent with the guardrailed month/rep selectors in the same dense dark control bar. The full 40px button standard applies to the edit panel and login surfaces. Both header controls still carry the 3px zest focus ring and no emoji.

Guardrails (do not touch):
  • Do not change lib/hubspot.js, the HubSpot fetch logic, the metrics maths, the charts, or the 15-minute refresh.
  • Do not change the drill-down modals (deal band, calls, pipeline), the top sales card, the four metric cards, the header brand row, or the month/rep selectors, beyond swapping the lock/PIN button for Sign out + admin-gated Edit targets. In CSS this means leaving .modal, .modalSub, .modalActions, .btnCancel, .dealList, .dealBadge, .badgeOk, .badgeWarn untouched (shared with the drill-downs).
  • Do not add features beyond scope: no sign-up, no invite UI, no in-app password reset, no multi-admin, no analytics, no new KPI types beyond the existing calls/visits/pipeline/budget.
  • Do not point DNS or change Vercel domain/region config from within the build.
  • Do not commit any secret. Env vars only.

━━━ EXECUTION STEPS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FOUNDATION (Cole builds directly and sequentially — the shared security substrate both streams depend on):
  1. Add @supabase/ssr to package.json and install. | SIMPLE
  2. Create lib/supabase/client.js, lib/supabase/server.js, and lib/supabase/middleware.js (updateSession returning { response, user }). | MODERATE
  3. Rewrite middleware.js per the middleware contract: single getUser, session required on all page routes, /login and /api passthrough, fail closed on missing env (503) and on session error (redirect /login). Remove all Basic Auth code. | COMPLEX
  4. Write supabase/migrations/0001_targets_two_tier_rls.sql per the migration spec (is_admin() + enable RLS + dynamic drop-all + two-tier policies, wrapped in one transaction). | COMPLEX

STREAMS (steps 5-7 run in the two parallel streams below — see WORK STREAMS for the 5A/6A/7A and 5B/6B breakdown).

FINISH (after both streams):
  8. Cole runs the full POST-BUILD VERIFICATION CHECKLIST against the Vercel preview, including the admin editing UX, the "not visible to anyone" DOM + client-bundle checks, the direct-POST 401/403 tests with real sessions, the admin write success test, the anon tests, and the fail-closed middleware tests. | COMPLEX

━━━ WORK STREAMS (LARGE BUILD) ━━━━━━━━━━━━━━━━━━━━
Steps 1–4 (FOUNDATION) and step 8 (FINISH) are built first/last, directly and sequentially — the session clients, the migration, and the middleware perimeter are the shared backbone. Once the foundation lands, the two streams below touch fully disjoint files and both only import (read-only) from lib/supabase/*. No shared file, no cross-stream dependency.

  Stream A — Sign-in + dashboard UI + admin editing rebuild (client surface)
    Files:  app/login/page.js (new),
            app/login/login.module.css (new),
            app/layout.js,
            app/page.js,
            app/dashboard.module.css
    Steps:  5A. Build the Spoke-branded /login page (email + password, browser-client signInWithPassword → "/", error copy, already-signed-in → "/").
            6A. In app/page.js: remove all PIN/lock state, the PIN modal, and the 🔒/🔓 buttons (header + mobile menu); compute isAdmin from the session; add "Sign out" for all users; render "Edit targets" only when admin; surface 401/403 from save.
            7A. Rebuild the "Edit monthly targets" panel per the edit-panel spec: add DM Mono in app/layout.js; add the new .editPanel/.editPanelSection/.editField/.editActions classes (and delete .lockBtn/.pin* styles) in app/dashboard.module.css WITHOUT modifying the shared drill-down modal classes; replace the inline-styled modal markup in app/page.js with the on-brand panel; preserve the post-save loadData() live refresh; add inline validation and the auto-calculated team total.

  Stream B — Server enforcement (targets read/write path)
    Files:  lib/targets.js (new, renamed from lib/supabase.js; delete lib/supabase.js),
            app/api/targets/route.js,
            app/api/dashboard/route.js,
            .env.local.example
    Steps:  5B. Rename lib/supabase.js → lib/targets.js and refactor getTargets/saveTargets/saveSalesBudget to take the authed server client and use the query builder; preserve the update-then-insert fallback (via .update(...).select() + empty-array check) and getTargets shape.
            6B. Update /api/targets (getUser → 401; rpc('is_admin') with fail-closed error handling → 403; write via authed client) and /api/dashboard (getUser → 401; read targets via authed client). Update .env.local.example.

If Cole judges the security stakes make parallel coordination risky, building A then B sequentially is acceptable — the streams are an optimisation, not a requirement.

━━━ RISK SURFACE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The hard 20%. This is a security change on a LIVE daily tool — treat every item as load-bearing.

  • Locking the team out during cutover (the top operational risk). The moment middleware requires a session, anyone without a Supabase account or an active session is bounced to /login. Mitigation: all team accounts must exist in Supabase Auth BEFORE the new middleware goes to production (deployment checklist, ordered first). Cole needs at least one admin and one non-admin test account to verify the preview.
  • The admin surface is a security control, not just UI. Non-admin users hold real sessions and the anon key, so they can hit the Supabase REST API and /api/targets directly. The pass/fail proof is: (a) the edit panel/button do not exist in a non-admin's DOM; (b) direct non-admin POST → 403; (c) direct non-admin REST write → RLS reject. Do not sign off on the button being hidden alone.
  • Conditional render vs CSS-hide. If the edit panel is rendered but hidden with CSS/display for non-admins, its form still exists in the DOM and can be triggered. It must be conditionally rendered (absent) for non-admins. Server refusal still backstops this, but the DOM must not carry the admin form.
  • Client bundle leakage of the old secret. Removing NEXT_PUBLIC_ADMIN_PIN from source is not enough if a stale build is served. Rebuild and grep the .next client bundle for the var and any literal PIN value; confirm zero. Also remove it from Vercel (deployment checklist).
  • rpc('is_admin') error during the deploy window. Before the migration runs, is_admin() does not exist and the RPC errors. The /api/targets handler MUST treat that error as not-admin (403), not crash or default-allow. This is the fail-closed requirement in the Build Context.
  • Query-builder zero-rows semantics. The current raw-fetch write detects "row missing" via !res.ok; the supabase-js .update() does NOT error on zero rows affected. lib/targets.js must use .update(...).select() and branch to insert on an empty returned array, or a first-time month/rep write is silently dropped.
  • Reads must move to the session, or enabling RLS breaks the dashboard. Once RLS requires authenticated SELECT on targets, the old anon-key read returns zero rows and getTargets silently falls back to MOCK data, showing wrong targets to everyone. /api/dashboard MUST read targets via the authenticated session. The mock fallback will MASK this failure — verify real (non-mock) target values load after the migration.
  • Deploy ordering / single shared Supabase project. Preview and Production share one Supabase project, so there is no DB rollback boundary and the migration is a single immediate production action. Safe order: (1) confirm all accounts exist; (2) deploy the new app code (session reads/writes); (3) run the migration; (4) verify Edward can save and a non-admin can view but not write against the live DB. Between (2) and (3), rpc('is_admin') fails until the function exists, so target editing is temporarily disabled for everyone — fail-closed and acceptable.
  • is_admin() hardening. SECURITY DEFINER without a pinned search_path is a privilege-escalation vector. It MUST set search_path = public, pg_temp, be STABLE, and have execute revoked from public/anon and granted only to authenticated.
  • RLS drop-all loop scope. The dynamic drop loop targets ONLY schemaname='public' AND tablename='targets'; confirm both predicates are present so no other table's policies are touched. It runs inside the transaction, before the four new policies are created.
  • Fail-closed must not loop or open. Missing env → 503 for ALL paths including /login. Session error → redirect to /login (deny), never allow. Env check at the very top; getUser wrapped in try/catch yielding null.
  • /api passthrough in middleware. Middleware deliberately does NOT redirect /api requests. Verify /api/dashboard and /api/targets return JSON status codes (401/403/200), not HTML redirects.
  • Browser-client session cookies reaching the server. Login/sign-out use the @supabase/ssr browser client, which writes auth cookies via JS. Middleware and the API server client read those same cookies. Verify end to end: after login, a page navigation is allowed by middleware AND /api/targets sees the session.
  • Renaming lib/supabase.js. Both API routes import from '@/lib/supabase'. After renaming to lib/targets.js, update both imports in the same step and build to confirm. Delete the old file so the new lib/supabase/ directory cannot resolve-collide with it.
  • Removing the PIN and lock cleanly. app/page.js references PIN/lock state in the header AND the mobile menu, plus the PIN modal and checkPin/handlePinInput; dashboard.module.css has .lockBtn/.pin* classes. Remove all, then grep for "pin", "Pin", and "lock" to confirm no dangling reference breaks the client build.
  • DM Mono font addition. Adding DM_Mono in layout.js changes the root layout; verify the font loads and the numeric values render in mono without a layout shift, and that DM Sans/DM Serif are unaffected. If the font fails to load, values should still be legible (mono fallback stack).
  • Edit-panel focus trap and Escape. A hand-built modal focus trap is easy to get subtly wrong (Tab escaping, Escape not bound, focus not restored). Verify keyboard behaviour explicitly, including focus returning to the "Edit targets" trigger on close.
  • Live refresh after save. The dashboard reads targets via /api/dashboard (now session-gated). After save, loadData() must succeed with the session and repaint the target-derived numbers. Verify the new values appear without a manual reload, and that a failed refresh does not silently show mock data.
  • dashboard.module.css is shared. It styles the whole dashboard. The edit panel uses NEW dedicated classes (.editPanel etc.); the shared drill-down modal classes (.modal, .modalSub, .modalActions, .btnCancel, .dealList, .dealBadge, .badgeOk, .badgeWarn) must be left untouched to avoid regressing the read-only dashboard. Only .btnSave (target-edit + deleted PIN modal) may be restyled; .overlay may take the shared scrim/blur update.

━━━ OPEN QUESTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
All resolved with defaults so the build is not blocked. Items marked (confirm) are safe to build as specified but Edward may override.

  • Admin model → RESOLVED: single-admin email equality inside a SECURITY DEFINER is_admin() function, NOT an admin_users table. Justification: there is one fixed, non-configurable admin (edward@spoke.nz); a table adds machinery (rows, seed, management) with no benefit here. The definer function keeps a single source of truth that both RLS and the app read. Revisit with a table only if multi-admin is ever needed. → Owner: Pam (resolved) / Roscoe (approved).
  • Edit pattern: inline vs modal → RESOLVED: a clean modal ("Edit monthly targets" panel), not inline editing. The targets are a small bounded set (budget + two reps × three KPIs) saved atomically in one POST; a focused panel keeps the edit surface off the dense, guardrailed read-only cards, matches the design-system modal spec, and preserves the existing single-POST save + loadData refresh. Inline edits scattered across the metric cards would clutter the display and complicate the guardrail. → Owner: Pam (resolved) / User (confirm).
  • Targets reads → RESOLVED: reads move server-side onto the authenticated session (via /api/dashboard); RLS grants SELECT to authenticated only, closing the current anon exposure. → Owner: Pam (resolved).
  • Targets writes → RESOLVED: writes route through /api/targets with a server-side session + rpc('is_admin') check (fail-closed on RPC error), then write via the authenticated client so RLS enforces admin-only. → Owner: Pam (resolved).
  • Save button colour → RESOLVED: "Save targets" is a PRIMARY (mineral) button, not zest. Zest is reserved for high-energy CTAs and focus rings per the design system; a routine admin save is primary. → Owner: Pam (resolved).
  • Password reset → RESOLVED (confirm): no in-app self-service reset in this build. Edward sets/resets passwords for the 4–5 known users in the Supabase dashboard. Building the email flow now adds a request page, an update-password page, Supabase email-template + redirect-URL config, and a link, for a small Edward-provisioned team on a security-sensitive cutover. Can be added later. → Owner: Pam (resolved) / User (confirm).
  • Account provisioning → RESOLVED (confirm): Edward creates each account in the Supabase dashboard (Authentication → Users → Add user). No self sign-up. At least one non-admin account is needed for the acceptance tests. → Owner: User (confirm the account list before cutover).
  • Middleware route matrix → RESOLVED: public = /login + static assets; session required = all other page routes; /api passthrough in middleware with self-enforcing 401/403 in the handlers. → Owner: Pam (resolved).
  • Existing policies on public.targets → RESOLVED by the migration's dynamic drop-all loop: it drops every existing policy on public.targets before creating the two-tier set, so the lockdown no longer depends on a manual audit of pre-existing policy names that Edward cannot perform. → Owner: Pam (resolved) / Roscoe (approved).
  • Live domain (dashboard.spoke.nz vs dashboard-sales.spoke.nz) → deferred to ship time; not a spec blocker. → Owner: User.

━━━ ROSCOE REVIEW NOTES ━━━━━━━━━━━━━━━━━━━━━━━━━━━
Independent Roscoe spec review: APPROVE WITH CHANGES. Architecture confirmed sound (single-admin is_admin() definer function, session-based reads/writes, fail-closed middleware, transactional migration, conditionally-rendered admin panel with server-enforced writes). Three required edits and four advisories folded in; no architecture rework needed.

  Required edits folded in:
  • REQ-1. CSS regression guard made enforceable: the edit panel now uses NEW dedicated classes (.editPanel/.editPanelSection/.editField/.editActions); the shared drill-down modal classes (.modal, .modalSub, .modalActions, .btnCancel, .dealList, .dealBadge, .badgeOk, .badgeWarn) must NOT be modified. Only .btnSave may be restyled; .overlay may take the shared scrim/blur update. Applied to the dashboard.module.css Build Context line, Guardrails, Risk Surface, and Step 7A.
  • REQ-2. RLS lockdown made unconditional: the migration now dynamically drops EVERY existing policy on public.targets (do-loop over pg_policies) before creating the four new policies, inside the single transaction — closing the anon-write hole regardless of pre-existing policy names. The corresponding Open Question moved from OPEN to resolved-by-loop.
  • REQ-3. Fail-closed admin check: /api/targets treats any rpc('is_admin') error as false → 403 (mirroring Tools Hub's `if (error) return false`), which matters during the deploy window before is_admin() exists. Added to the route Build Context, Hard Constraints, and Risk Surface.

  Advisories folded in:
  • ADV-1. is_admin() rationale corrected: dropped the "failed seed loses Edward write access" argument (Tools Hub wraps table+seed in one transaction, so it doesn't hold). Rationale is now purely "one fixed, non-configurable admin; a table adds machinery with no benefit here." search_path pinned to public, pg_temp is restated as the privilege-escalation guard in the migration spec and Hard Constraints.
  • ADV-2. lib/targets.js note added: the update-then-insert fallback must use .update(...).select() and branch to insert on an empty returned array, because the query builder does not error on zero rows affected.
  • ADV-3. CSRF note added to /api/targets Build Context: no explicit CSRF token needed — same-origin internal tool, Supabase auth cookies default to SameSite=Lax.
  • ADV-4. Execution Steps renumbered so Foundation (1–4), the stream steps (5–7 via 5A/6A/7A and 5B/6B), and the Finish step (8) read in order.

Status: APPROVE WITH CHANGES — all required edits and advisories applied. Cleared for Cole.

━━━ POST-BUILD VERIFICATION CHECKLIST ━━━━━━━━━━━━━
Cole verifies every item against the Vercel PREVIEW deployment before merge. The RLS/DB checks run against the one shared Supabase project and require the migration to have run.

Session perimeter:
  □ Fresh browser, no session, visit / → redirected to /login, NO Basic Auth popup.
  □ Visit /login with no session → the Spoke sign-in page renders, no redirect loop.
  □ With a Supabase env var unset in preview, every route returns 503 and serves no content (restore env after).
  □ Forced session-check error → redirect to /login, never an allowed response.
  □ No redirect loop on /login or on static assets (logo, fonts).

Sign in / out:
  □ Valid email + password → lands on /.
  □ Correct email, wrong password → stays on /login, shows "Email or password is wrong. Try again."
  □ Empty email or password → browser required-field validation blocks submit.
  □ "Sign out" clears the session and lands on /login; going back to / redirects to /login.

Admin editing UX (edward@spoke.nz):
  □ Signs in → sees "Edit targets" (no emoji) in the header; opening it shows the "Edit monthly targets" panel pre-filled with current budget and per-rep KPIs.
  □ Each field is labelled; dollar values show a formatted helper (e.g. "$60,000"); the read-only team total updates as Ed/Mark values change.
  □ Change budget + a KPI, "Save targets" → "Targets saved", panel closes, dashboard numbers refresh live within ~2s with no manual reload.
  □ Negative or blank required value → inline "Enter a number of 0 or more", Save blocked until fixed.
  □ Escape and scrim-click close without saving; reopening shows last saved values.
  □ First field focused on open; Tab stays within the panel; focus returns to the trigger on close.
  □ Direct POST to /api/targets with Edward's session cookie → 200 { success: true }, row written.
  □ First-time write for a month/rep with no existing row still saves (update-then-insert fallback works).

Security — not visible to anyone but admin:
  □ Non-admin signed-in user: NO "Edit targets" button and NO edit-panel markup in the DOM (inspect DOM to confirm the form is absent, not just hidden).
  □ Non-admin sees the full dashboard with real (non-mock) target values loaded after the migration; no PIN button, no lock icon.
  □ Grep of source AND the built .next client bundle → no NEXT_PUBLIC_ADMIN_PIN and no PIN literal.
  □ Direct POST to /api/targets with a non-admin session cookie → 403, no row changed.
  □ Direct POST to /api/targets with no session → 401, nothing written.
  □ Direct authenticated REST PATCH/POST on targets with a non-admin token + anon apikey → rejected by RLS, no row changed.
  □ Direct authenticated REST SELECT on targets with a non-admin token → returns rows (view works).

Anon lockdown:
  □ Direct anon-key SELECT on targets (no token) → zero rows / rejected.
  □ GET /api/dashboard with no session → 401, no HubSpot data (JSON, not HTML redirect).

Cleanup / regression:
  □ Grep finds no DASHBOARD_PASSWORD, DASHBOARD_USERNAME, NEXT_PUBLIC_ADMIN_PIN, checkPin, handlePinInput, showPinModal, pinRefs, lockBtn, or "WWW-Authenticate".
  □ No emoji in app/page.js.
  □ lib/supabase.js deleted; lib/targets.js present; both API routes import from it; production build passes.
  □ HubSpot 15-minute refresh still runs; month and rep selectors still work; top sales card, all four metric cards, and the deal-band/calls/pipeline drill-downs still render and open/close unchanged (shared modal classes untouched).
  □ /api/dashboard and /api/targets return JSON status codes, not HTML redirects.
  □ Pages load with no console errors.

Design + responsive:
  □ Login heading and edit-panel title in DM Serif Display italic; UI in DM Sans; target/numeric values in DM Mono; page background stone; cards white.
  □ 3px zest focus ring on login inputs/button, the header Sign out / Edit targets controls, and every edit-panel input and button; modal inputs/buttons 40px, radius 8px.
  □ No emoji anywhere; NZ English; no em dashes; sentence-case buttons and headings.
  □ Login, dashboard, and the edit-targets panel correct at 900px and 600px (panel buttons stack full-width at 600px).

━━━ DEPLOYMENT CHECKLIST ━━━━━━━━━━━━━━━━━━━━━━━━━━
Edward completes this before promoting to production. ORDER MATTERS — Preview and Production share ONE Supabase project, so the migration is a single immediate production-affecting DB change with no preview rollback boundary. Do not lock the team out.

  □ NEXT_PUBLIC_SUPABASE_URL set in Vercel (preview + production).
  □ NEXT_PUBLIC_SUPABASE_ANON_KEY set in Vercel (preview + production).
  □ All team members (admin + non-admins) have Supabase Auth accounts and can log in — CONFIRM THIS FIRST, before the new middleware goes live, or the team is locked out.
  □ Confirm edward@spoke.nz exists in Supabase Auth (is_admin() matches this exact email).
  □ Deploy the new app code to production BEFORE running the migration, so reads never fall back to mock data.
  □ Run supabase/migrations/0001_targets_two_tier_rls.sql against the (shared) Supabase project. It is one transaction (begin;/commit;) and drops all existing targets policies before creating the two-tier set. If it fails, nothing changes; fix and re-run.
  □ Verify against the LIVE DB: Edward can save a target; a non-admin can view but not write; real (non-mock) values load on the dashboard.
  □ Remove NEXT_PUBLIC_ADMIN_PIN from Vercel (preview + production) — no longer used.
  □ Remove DASHBOARD_USERNAME and DASHBOARD_PASSWORD from Vercel (preview + production) — Basic Auth is gone.
  □ Verify fail-closed: with a Supabase env var missing, the app denies (503) rather than opening.
  □ No secrets committed to the repo — verified with git diff before merge.
  □ (Ship-time, not a blocker) Confirm the live domain (dashboard.spoke.nz vs dashboard-sales.spoke.nz).

╔═══════════════════════════════════════════════════╗
║  STATUS: READY FOR COLE                           ║
╚═══════════════════════════════════════════════════╝
