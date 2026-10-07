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
- Add a `?source=manual|auto` filter so counts can be split by how the annotation was made (human vs model).
- Chosen because it is the one breakdown that changes the *meaning* of the numbers for a labelling team (how much is hand-drawn vs auto-generated), and it maps to an existing field (`source`) on the shape — justification recorded in the docs.

### 8. The graph updates live over WebSocket (stretch)
- Greenfield: add `channels` + `channels_redis` (Redis already runs), set `ASGI_APPLICATION` + `CHANNEL_LAYERS`, and turn `cvat/asgi.py` into a `ProtocolTypeRouter` with a websocket route.
- A consumer joins group `task_<id>` only after an auth/permission check.
- Broadcast "task X changed" from the single annotation write choke point (`dataset_manager/task.py` `put_job_data`/`patch_job_data`) via `transaction.on_commit` → `group_send`.
- The page opens a socket for its task and re-fetches counts on each message.

### 9. The page recovers when the connection drops and comes back (stretch)
- Frontend socket with `onclose`/`onerror` → exponential-backoff reconnect.
- On reconnect, re-run the REST GET to resync (the socket is the live-delta channel; REST is the recovery path). Demonstrate by killing and restoring the connection and watching the chart catch up.

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
