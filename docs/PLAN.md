# Plan — Annotation Analytics

> Committed before any code. Section 5.3 of the assessment.

## Context

| Field | Value |
|---|---|
| Feature | Per-class annotation counts for a task: API + web page with a graph |
| Branch | `dev-test01` |
| Backend home | new Django app `cvat/apps/test` |
| CVAT commit cloned | `28f5bffaf1b66b81c1e908d3ae626047a54279b0` |
| Machine | Apple M5, 10 cores, 16 GB RAM, macOS 26.2 (arm64); Docker: 10 CPUs, ~7.75 GB |
| Dataset | COCO 2017 val, imported as COCO 1.0. Image count used: _TBD — recorded after import_ |

## Goal

CVAT does not show how many annotations exist per class. Add an API that counts annotations per class for a task (**read from PostgreSQL**), a web page that calls it, and a graph of the result — with as much proven speed and reliability as the time allows, honestly reported.

## Order

Work the list in order. **Items 1–4 are the floor** — nothing past them is assessed until they work. **Items 8–9 are stretch** and are only started once the floor plus 5–7 are solid.

## Time budget (out of 8 hours)

| Step | Items | Est. |
|---|---|---|
| Docs: Plan first, before any code | 10 (plan) | 0:30 |
| Data setup: COCO download/extract, task creation, labels, annotation import | setup (not counted against the 8h, but real wall-clock was spent here) | — |
| API endpoint, counts from the DB | 1 | 1:00 |
| Web page + chart | 2, 3 | 1:00 |
| Empty/error states | 4 | 0:30 |
| **— floor complete —** | | **3:00** |
| Auth: 401 + 403, demonstrated | 5 | 0:45 |
| Speed objective: target, measure, report | 6 | 0:45 |
| Filter/grouping (`min_count`, `percentage`) | 7 | 0:30 |
| **— stretch from here —** | | |
| WebSocket live updates | 8 | 1:30 |
| Reconnect / recovery | 9 | 0:45 |
| Decision record, Definition of Done, final polish | 10 | 0:45 |
| **Total planned** | | **8:00** |

## How I plan to complete each of the 10 deliverables

### 1. API endpoint — annotations per class for a task, from the database
- Scaffold a new Django app `cvat/apps/test` (`apps.py`, `views.py`, `serializers.py`, `urls.py`), register it in `INSTALLED_APPS` (`cvat/settings/base.py:111-151`) and mount it under `api/` in the root `cvat/urls.py` (same conditional `path("api/", include(...))` pattern the other apps use).
- Endpoint: `GET /api/test/annotation-counts?task_id=<id>`, a DRF view following the `ServerViewSet` pattern (`engine/views.py:191`).
- Counts come from one ORM aggregate over the source-of-truth tables in Postgres:
  `LabeledShape.objects.filter(job__segment__task_id=task_id).values("label__name").annotate(count=Count("id"))`.
- Include the task's labels that have **zero** annotations (from `Task.get_labels()`) so every class shows, even at 0.
- Response is a serialized list of `{ name, count }`, documented with `@extend_schema`.
- Verify against a known task by cross-checking a couple of class counts by hand.

### 2. A page in the web interface that calls it
- New page component `cvat-ui/src/components/annotation-counts/annotation-counts-page.tsx`.
- Register the route inside the **authenticated** `<Switch>` in `cvat-app.tsx` (import near `:83`, `<Route exact path='/tasks/:tid/annotation-counts' .../>` after `:569`) — being in that switch makes it require login automatically. Read `:tid` with `useParams`.
- Add `getAnnotationCounts(taskID)` to `cvat-core/src/server-proxy.ts` (next to `getQualityReports`, `:2703`) and expose it on the core API object; the page calls it through `getCore()`. This reuses CVAT's axios layer (auth, CSRF, retry) instead of calling the endpoint raw.

### 3. The counts shown as a graph
- Render a bar chart with `react-chartjs-2`'s `<Bar>` (chart.js is already a dependency; no new library).
- Register the needed chart.js pieces (`CategoryScale, LinearScale, BarElement, Tooltip, Legend`), map `{name, count}` → `labels` + a single dataset, and optionally show value labels via the already-installed `chartjs-plugin-datalabels`.

### 4. The page handles two cases cleanly: no data, and a failed request
- Local `useState` for `data` / `fetching` / `error`, fetched in a `useEffect` with `try/catch/finally` (mirroring `quality-control-page.tsx`).
- **No data:** when the endpoint returns all-zero / empty counts, show an Ant Design `<Empty>` message instead of an empty chart.
- **Failed request:** on error show a `<Result status="error">` with a retry button and an `notification.error`, rather than a blank page.

### 5. Reuse CVAT's login; refuse no-login and no-access (show both)
- Keep the default `IsAuthenticated` so an unauthenticated call gets **401**; set `permission_classes=[IsAuthenticated]` on the view to avoid the `PolicyEnforcer` `iam_permission_class` assertion.
- Gate task access with the same call CVAT's own code uses:
  `if not TaskPermission.create_scope_view(request, task).check_access().allow: raise PermissionDenied` → **403** (runs the real `tasks.rego` policy, `engine/permissions.py:690`).
- Demonstrate both: a request with no credentials → 401; a logged-in user with no access to that task → 403; plus the page's handling of each.

### 6. One speed target — set, measure, report
- Define one measurable objective in `docs/OBJECTIVES.md`: median server-side latency of the counts endpoint for the imported task, with a target number I pick and justify.
- Measure 5 runs, paste the **raw** output, report **median + spread**, and record CPU/RAM/OS and the commit SHA. Target met, or missed with the reason written down.

### 7. One filter or grouping beyond the plain count
- Built two additions, verified against real task #3 data (5,000 images, 41,866 annotations): `?min_count=N` (drops labels below a threshold — real counts range from 10 to 12,451, so this fixes real chart clutter) and `percentage` on every entry (count as % of the task's total — actual analytics, not just a tally).
- Originally planned `?source=manual|auto`, changed after the data showed every annotation in task #3 has `source='file'` — that filter would be correct code with nothing real to demonstrate.
- Both wired into the page itself, not just the API: min-count preset buttons (`All / ≥10 / ≥50 / ≥100`), and a Count/Percentage toggle that switches chart type, not just the numbers on a bar chart — percentage as a bar chart is a linear rescale of count, so the bars look identical either way; switched percentage to a doughnut chart instead, where slice size actually represents the share. Both numbers are always in the tooltip regardless of view.

### 8. The graph updates live over WebSocket (stretch)
- Built as planned: `channels==4.2.0` + `channels-redis==4.2.1` added (new deps, verified against each other's real PyPI constraints first so the image build wouldn't fail on a bad version pair), `ASGI_APPLICATION` + `CHANNEL_LAYERS` added, `cvat/asgi.py` wraps the existing HTTP app in a `ProtocolTypeRouter` alongside `AuthMiddlewareStack(URLRouter(...))` for `/ws/`.
- `AnnotationCountsConsumer` (`cvat/apps/test/consumers.py`) re-runs the same `TaskPermission` check as the REST endpoint (item 5) before accepting a connection — reconstructing the IAM context CVAT's `ContextMiddleware` would normally build from an HTTP request, since a websocket handshake has none. **Known limitation**: only the sandbox (non-organization) case is replicated; an org-scoped task isn't supported here.
- Broadcast wired into **both** job-level (`put_job_data`/`patch_job_data`/`delete_job_data`) and task-level (`put_task_data`/`patch_task_data`) write paths in `dataset_manager/task.py`, via `transaction.on_commit` — our own COCO import goes through the task-level path, so job-level alone wouldn't have covered it.
- The page opens a socket on mount and re-fetches counts on any message (`cvat-ui/.../annotation-counts-page.tsx`).
- Verified end-to-end by hand-driving the real ASGI app in-process (no browser, no uvicorn) with minted Django sessions for two real users: unauthenticated → closes 4401; owner → accepts, and a simulated `group_send` correctly arrives as `{"type": "counts_changed", ...}`; no-access user → closes 4403; nonexistent task → closes 4403 (collapses what REST keeps as a 404/403 distinction — a deliberate simplification, not an oversight, since there's little value in telling a failed handshake *why*).
- Three real bugs found and fixed via this process, not guessed: a missing transitive dependency (`msgpack`, needed by `channels-redis` but never explicit in the hand-edited `base.txt`) broke the image build; the `CHANNEL_LAYERS` host config used `"address": (host, port)` (a tuple) where `channels-redis` expects either a URL string or plain `host`/`port` kwargs; and an `IntEnum` value passed as `db` silently broke `redis.asyncio`'s connection handshake despite working everywhere else in the codebase as a plain int.
- **Browser confirmation, resolved.** A real Chrome tab opens the socket correctly (`101`, correct cookie, chart renders), but a real annotation delete wasn't reaching it. Root-caused by replaying the exact failure outside the browser: a raw socket client doing the real handshake over the real network path (not an in-process test), connected, then fired a real `PATCH` via the REST API and watched for the broadcast frame. It never arrived, and server logs showed why: `redis.exceptions.TimeoutError: Timeout reading from cvat_redis_inmem:6379`, an unhandled exception that silently kills the consumer's receive loop a few seconds after every connect. Cause: `channels-redis==4.2.1`'s internal `BZPOPMIN` uses a 5s server-side blocking timeout and expects a clean `None` back when it elapses; `redis==8.1` (already pinned elsewhere in this project, not something I introduced) applies its own client-side `socket_timeout` that fires first, so the client raises instead of returning `None` — a version-compatibility gap between a 2023-era package and a current major `redis-py`. Fixed with one line in `CHANNEL_LAYERS`'s host config: `"socket_timeout": 10`, so the server's own blocking timeout wins. Re-ran the identical real-network test after the fix: the `counts_changed` frame arrived, and the earlier `TimeoutError` stopped appearing in the logs entirely. This also explains the 6+ stale Redis group entries noted earlier — those were connections whose receive loop had already silently died, so `disconnect()` never got a chance to clean them up; harmless now that connections stay alive, and no longer being added to.
- **Auth re-verified over the real network path**, not just in-process, after the above bug showed in-process tests alone aren't enough: no cookie → `403` at handshake; admin on an owned task → `101`; a second real user with no access to the task → `403`; a nonexistent task → `403`. The consumer rejects *before* calling `accept()`, so these surface as a plain HTTP 403 rather than a websocket close frame with the 4401/4403 codes — those codes only apply to a close *after* accept, which is an intentional, not accidental, simplification.

### 9. The page recovers when the connection drops and comes back (stretch)
- Built: `onclose` schedules a reconnect with exponential backoff (1s, 2s, 4s… capped at 30s); `onopen` after a reconnect (not the first connect) re-runs the REST GET to resync, since anything that changed while disconnected only ever reached the socket as a now-missed ping. Cleanup on unmount detaches `onclose` before closing so it doesn't try to reconnect after navigating away.
- No separate close-code handling needed here — any `onclose` (server restart, network blip, or our own item-8 close codes) is treated the same way: reconnect and resync.
- To demonstrate: open the page, `docker restart cvat_server` (or close the socket from DevTools), change an annotation while it's down, watch it reconnect and catch up once the server's back.

### 10. Decision record (written inside this Plan)
- At the end, the "Decision record" section below is filled with the approach taken, the approach rejected, and what rejecting it cost — consolidating the decisions already noted per item above.

## Deliberately skipped (and why)

- **Counting `LabeledTrack` / `LabeledImage` (video tracks, frame tags).** COCO box import produces only `LabeledShape`, so counting shapes is correct and complete here; the endpoint states its scope rather than silently missing them.
- **Caching / precomputed counts.** The objective measures the raw ORM aggregate; caching would hide what I want to measure. Revisit only if the target is missed.
- **A bespoke OPA `.rego` rule for the new endpoint** — reuse `tasks.rego` via `TaskPermission` instead.
- **3D / video-specific handling, result pagination, org-scoped nuances** — out of scope.

## Risks / unknowns

- Channels is greenfield; items 8–9 may not land. If so they will be listed as unfinished, not hidden.
- Dataset size affects the latency number; the actual image/annotation count is recorded in Objectives before measuring.

## Decision record (item 10)

To be written at the end if item 10 is reached: the approach taken, the approach rejected, and what rejecting it cost. Preliminary decisions are captured per item above; this section will consolidate the final one.

## Plan changes log

Deviations from this plan are appended here with the reason, as they happen.

- **Used all 5,000 val2017 images, not a small subset.** The Plan assumed a smaller sample for speed; in practice the machine handled the full set comfortably and importing the complete set avoided ambiguity about which classes would appear at all.
- **COCO annotation upload required predefining all 80 task labels first.** CVAT's "Upload annotations" on an existing task does not auto-create labels from the dataset; it fails per-image with `Label 'X' is not registered for this task` until every COCO category exists on the task beforehand (added via the Raw label editor, each with an explicit `type` and `attributes` field — both required or the editor rejects the JSON).
- **Verifying the backend required rebuilding Docker images, not just restarting containers.** An early verification approach (copying changed files into the already-running `cvat_server` container) was *not* durable: it's silently lost the moment that container restarts or is recreated, with no warning. Fixed by rebuilding the actual `cvat_server`/`cvat_ui` images via the `docker-compose.dev.yml` overlay (which adds the `build:` contexts missing from the base compose file) so changes persist in the image itself.
- **Corrected the test plan for item 4's "failed request" case.** The new page's route lives inside CVAT's authenticated route switch, so testing it by logging out exercises CVAT's own router redirect, not this page's error handling. The valid test is an in-session request that the *backend* rejects (e.g. a nonexistent task id), which reaches the page's own fetch/catch logic.
- **80-label chart is cluttered** (Chart.js auto-skips x-axis labels when there's no room) — not yet fixed; `?min_count=` is the likely fix, already built for item 7.
