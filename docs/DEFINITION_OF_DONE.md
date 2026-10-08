# Definition of Done

This is how I know I'm done, not just "it compiles." Each line below is something I can point at — a file, a log, a number — not a vibe.

One honesty note up front: this should've been written before I started, per the assessment. I didn't get to it until now. Still better to have it late than not at all, so here it is, with real evidence instead of a guess.

- [x] **Endpoint gives correct counts for a real task.**
  Hit `GET /api/test/annotation-counts?task_id=3` against task #3 (5,000 COCO val2017 images, 80 labels, real annotations). All 80 labels come back, zero-filled where there are no boxes of that class, and I hand-checked one class's count against the raw data. Code's in `cvat/apps/test/views.py`, the `annotation_counts` action.

- [x] **Page shows the graph, and handles no-data and error cleanly.**
  `annotation-counts-page.tsx`. Empty task → a friendly "no annotations yet" message instead of a blank chart. Backend failure → an error card with a Retry button. I tested the error path properly too — not by logging out (that just bounces you off the page via CVAT's own router, it never touches this page's error handling), but by hitting the backend with something it actually rejects, like a task id that doesn't exist.

- [x] **Measured the speed target properly — 5 runs, raw output, not vibes.**
  `docs/OBJECTIVES.md` has two full attempts, 5 timed `curl` runs each, pasted as-is, sorted, with median and spread worked out for both.

- [x] **Target met, or missed and I said why.**
  First attempt missed (median 1.48s vs. the 300ms I set) — but that run happened seconds after a Docker build had eaten all the RAM, so I said that plainly instead of burying it. Second attempt, same endpoint, same data, stack calm: 25ms median, about 12x inside target. Kept both in the doc, not just the one that looks good.

- [x] **Login is reused, and both the no-login and no-access cases are actually refused.**
  REST: real `admin` user (owns the task) gets in, real `outsider` user (no access) gets a 403, no login at all gets a 401. WebSocket: same two scenarios, checked again — and this mattered, because an earlier in-process-only test would've missed a real bug (see the WebSocket line below). Over the real network path: no cookie → rejected, owner → connects, no-access user → rejected, bad task id → rejected.

- [x] **A filter beyond plain count, and it's actually usable, not just a hidden API param.**
  `min_count` (hide labels under a threshold) and `percentage` (each label's share of the task), both as real buttons on the page, not just something you'd only see by hand-editing the URL. I'd originally planned a manual-vs-auto source filter, but the real data showed every annotation came from the same source, so that filter would've been correct code proving nothing — swapped it for something the data could actually back up.

- [x] **Live chart updates over WebSocket — and I mean actually verified, not "looked right once."**
  This one had a real bug, and I'm glad it did. First pass worked in an isolated test but silently failed for real browser connections — they were dying about 5 seconds after connecting, no visible error anywhere except the server's own log. Turned out to be a version mismatch between `channels-redis` and the pinned `redis-py`: one expects a clean timeout, the other throws instead. One line of config fixed it, and I re-ran the exact same real-world test afterward to prove it — the chart updates arrived, and the crash stopped happening. Full story's in `docs/PLAN.md` (item 8) and `Understanding.md`.

- [x] **Page reconnects and catches up if the connection drops.**
  If the socket dies, the page retries with a growing delay (1s, 2s, 4s... up to 30s), and the moment it's back it re-fetches the counts so nothing's missed. Tested it by restarting the backend container mid-session and watching it recover on its own.

- [x] **Decision record written into the Plan.**
  In `docs/PLAN.md`: why I built real push-based WebSocket updates instead of just polling the API every few seconds, and what that choice actually cost me (new dependencies, a few wiring bugs, and that whole timeout bug above) versus what the simpler option would've cost instead.

- [ ] **This document, written before I started.**
  Didn't happen — writing it now instead of pretending otherwise.

- [ ] **WebSocket auth working for org-scoped tasks.**
  It only handles the normal (non-organization) case right now. A websocket handshake doesn't give CVAT's usual middleware anything to run against, and building that properly felt like more risk than a stretch item warranted. Documented as a known gap in `cvat/apps/test/consumers.py`, not quietly skipped.

## Everything I didn't get to

- This doc, written late instead of upfront.
- Org-scoped tasks aren't supported over the websocket.
- No automated tests — everything was checked by hand (curl, a couple of raw-socket scripts, and the actual browser). It's all written down in the Plan and Understanding.md, but there's no single command that re-runs it for you.
- A few dead entries sitting in Redis's group-membership list, left over from earlier test scripts I force-killed before the websocket bug was fixed. Harmless — nothing's reading from them — just never cleaned up by hand.
