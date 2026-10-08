# Objectives

> The targets I set myself, and how I measured them. Section 6 of the assessment.

## Environment for all measurements

| Field | Value |
|---|---|
| CPU | Apple M5, 10 cores |
| RAM | 16 GB |
| OS | macOS 26.2 (arm64) |
| Docker | 10 CPUs allocated |
| CVAT commit cloned | `28f5bffaf1b66b81c1e908d3ae626047a54279b0` |
| Task measured against | Task #3 — 5,000 COCO val2017 images, 80 labels, real annotations imported |

## MO-1: Annotation-counts endpoint latency

| Field | Entry |
|---|---|
| What is measured | Round-trip time from sending `GET /api/test/annotation-counts?task_id=3` to receiving the full response. |
| How | `curl -w "%{time_total}"`, authenticated with a real token, through Traefik at `localhost:8080`, against the live Dockerized stack. |
| Target | Median of 5 runs at or below **300 ms**. |
| Conditions | Local Docker Compose stack, task #3 (5,000 images / 80 labels / real annotations), nothing else deliberately started alongside the requests. |
| Not included | Cold start immediately after a container restart; concurrent/simultaneous clients. |

**Why 300ms:** the endpoint runs a single indexed Postgres aggregate (`LabeledShape` joined through `job`→`segment`→`task`, grouped by `label__name`) returning ~80 small rows — no heavy computation, no N+1 queries. 300ms gives real headroom for Docker/Traefik overhead on a local dev stack without being a trivially loose bar.

### Attempt 1 — raw output (target missed, environment-constrained)

```
run 1: 2.316276s (HTTP 200)
run 2: 1.476171s (HTTP 200)
run 3: 9.042904s (HTTP 200)
run 4: 0.169066s (HTTP 200)
run 5: 0.121075s (HTTP 200)
```

Sorted: `0.121s, 0.169s, 1.476s, 2.316s, 9.043s`
**Median: 1.476s (1476 ms). Spread: 0.121s – 9.043s.**

**Target missed.** Taken minutes after a `cvat_ui` production build had failed with `ResourceExhausted: cannot allocate memory` in the same Docker Desktop VM (18 containers, including heavy ClickHouse/Grafana/Vector, sharing a constrained memory allocation). The 9.04s outlier is consistent with VM memory/CPU contention, not with the query itself — a single indexed aggregate over ~80 result rows has no algorithmic reason to take 9 seconds. Recorded honestly rather than discarded, since it's a real measurement under real (if non-ideal) conditions.

### Attempt 2 — raw output (target met)

Taken after the build contention had cleared and the stack was idle:

```
run 1: 0.080936s (HTTP 200)
run 2: 0.025614s (HTTP 200)
run 3: 0.022667s (HTTP 200)
run 4: 0.023278s (HTTP 200)
run 5: 0.025172s (HTTP 200)
```

Sorted: `22.7ms, 23.3ms, 25.2ms, 25.6ms, 80.9ms`
**Median: 25.2 ms. Spread: 22.7ms – 80.9ms** (run 1's 80.9ms is a minor warm-up effect, included rather than dropped).

**Target met — ~12x margin** (25.2ms vs. the 300ms target). This result, using the identical endpoint, task, and data as Attempt 1, confirms Attempt 1's miss was genuinely environmental (Docker resource contention at that moment), not a defect in the endpoint's own cost. The underlying query's actual latency is consistently in the 20-30ms range when the host isn't under memory pressure.

## Conclusion

The endpoint comfortably meets its stated speed target under normal conditions. The one honest caveat worth carrying forward: performance can degrade sharply (5-60x) when the local Docker Desktop VM is under heavy build/memory contention — this is an environment characteristic of local development, not something the endpoint's own code controls, and is noted here rather than hidden.
