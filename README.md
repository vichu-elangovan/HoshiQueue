# HoshiQueue ✨

**A tiny star, coordinating a universe of background jobs.**

HoshiQueue is a background job queue with a monitoring dashboard. A FastAPI service accepts jobs and stores them in PostgreSQL, Redis Streams delivers them to one or more Python worker processes, and a React dashboard shows what is happening.

## Contents

1. [Overview](#1-project-overview) · 2. [Problem](#2-problem-statement) · 3. [Architecture](#3-architecture) · 4. [Tech stack](#4-technology-stack) · 5. [Features](#5-features) · 6. [Lifecycle](#6-job-processing-lifecycle) · 7. [Retries and failures](#7-retry-and-failure-handling) · 8. [API](#8-api-endpoints) · 9. [Environment](#9-environment-variables) · 10. [Installation](#10-installation) · 11. [Windows](#11-windows-setup-powershell) · 12. [Docker Compose](#12-docker-compose) · 13. [Running](#13-running-the-backend-workers-and-frontend) · 14. [Testing](#14-testing) · 15. [Multi-worker check](#15-multi-worker-verification) · 16. [Limitations](#16-known-limitations)

## 1. Project overview

Work that should not block a web request (sending an email, generating a report) is submitted as a *job*. HoshiQueue stores the job, hands it to a worker, retries it if it fails, records the outcome, and shows live statistics in a dashboard.

The only built-in tasks are demonstrations: `send_email` (simulated; it prints a message and sends nothing) and `slow_test` (sleeps for 90 seconds). The API accepts any task name; a name the worker does not know fails with `Unknown task: <name>`, which is a convenient way to see retries and the dead-letter queue in action.

## 2. Problem statement

Running slow or unreliable work inside a request handler makes APIs slow and loses work when something crashes. A job queue fixes that, but it has to answer practical questions: What if Redis is unavailable when a job is created? What if a worker dies mid-job? What if a job keeps failing? Can two workers take the same job? HoshiQueue is a compact, readable implementation that answers each of these with PostgreSQL as the source of truth and Redis Streams for delivery.

## 3. Architecture

```mermaid
flowchart LR
    UI["React dashboard<br/>Vite, Tailwind, Recharts"] -->|"REST / JSON"| API["FastAPI API"]
    API -->|"insert and update jobs"| PG[("PostgreSQL<br/>jobs table")]
    API -->|"XADD job id"| RS[["Redis stream<br/>hoshi_queue:jobs"]]
    RS -->|"XREADGROUP<br/>consumer group"| W1["Worker 1"]
    RS -->|"XREADGROUP<br/>consumer group"| W2["Worker N"]
    W1 -->|"status, attempts,<br/>failure reason"| PG
    W2 -->|"status, attempts,<br/>failure reason"| PG
    W1 -->|"permanent failures"| DLQ[["Redis stream<br/>hoshi_queue:dead"]]
    W2 -->|"permanent failures"| DLQ
    W1 -.->|"reconciler: re-enqueue queued<br/>jobs missing from Redis"| RS
```

* **PostgreSQL is the source of truth.** Every job is a row with its status, attempt count and failure reason.
* **Redis Streams is the delivery channel.** The stream carries only job IDs. A consumer group delivers each message to one worker at a time.
* **Workers** are plain Python processes. Run as many as you like; each registers as a consumer under its own random ID.
* **The reconciler** runs inside every worker every 30 seconds. If a job is `queued` in PostgreSQL but has no message in Redis (for example Redis was down when it was created), it is enqueued again.

## 4. Technology stack

| Layer | Technology |
|---|---|
| API | Python 3.12+, FastAPI, Uvicorn, Pydantic |
| Database | PostgreSQL 16, SQLAlchemy 2, psycopg 3 |
| Queue | Redis 7 Streams (consumer groups, `XAUTOCLAIM`), `redis-py` |
| Workers | Python (`python -m worker.worker`) |
| Frontend | React 19, Vite 8, Tailwind CSS 4, Recharts 3, Axios, lucide-react |
| Tests | pytest, httpx, Node's built-in test runner; ruff and oxlint for linting |
| Local infrastructure | Docker Compose (PostgreSQL and Redis only) |

## 5. Features

**Backend**
* Create jobs over HTTP; persisted in PostgreSQL and delivered through a Redis Stream.
* Any number of worker processes sharing one consumer group.
* Automatic retries with exponential backoff and a maximum number of attempts (default 3).
* Permanently failed jobs are recorded as `failed` in PostgreSQL **and** copied to a Redis dead-letter stream.
* Cancel a queued job and retry a failed job (**API only**, no dashboard buttons).
* Worker lease and heartbeat: a message abandoned by a crashed worker is reclaimed by another worker after 60 seconds.
* Reconciler that re-enqueues `queued` jobs missing from Redis.
* Health check for FastAPI, PostgreSQL and Redis; dashboard statistics; throughput analytics.

**Dashboard (React)**
* **Overview:** live counts, success rate, throughput chart with 60-minute, 24-hour and 7-day filters, infrastructure health cards, recent jobs, and a **New job** button.
* **Job Explorer:** search by task name or job ID, status filters (queued, processing, completed, failed, cancelled), pagination (10/25/50 per page), a details drawer (task, attempts, failure reason, created time), and automatic refresh every 5 seconds with a pause toggle.
* Responsive layout: sidebar on tablets and desktops, compact top bar on phones.

**Metric definitions**
* **Success rate = completed ÷ (completed + failed) × 100.** Queued, processing and cancelled jobs are excluded. When no job has finished, the API returns `null` and the dashboard shows **N/A**.
* **Throughput counts jobs *created*, not jobs completed.** Each job is counted in the time bucket of its creation time, whatever its current status.

## 6. Job processing lifecycle

```mermaid
stateDiagram-v2
    [*] --> queued: POST /jobs
    queued --> processing: a worker claims the job
    processing --> completed: the task succeeds
    processing --> queued: the task fails and attempts remain, then wait 2s, 4s
    processing --> failed: the task fails on its last attempt
    queued --> cancelled: POST /jobs/ID/cancel
    failed --> queued: POST /jobs/ID/retry
    completed --> [*]
    cancelled --> [*]
```

1. `POST /jobs` inserts a row (`queued`, `attempts = 0`, `max_attempts = 3`) and adds the job ID to the Redis stream. If Redis is unreachable the job stays in PostgreSQL, the API answers **503** ("saved but could not be queued"), and the reconciler enqueues it later.
2. A worker claims a message (first reclaiming any message idle for more than 60 s, otherwise waiting up to 1 s for a new one), locks the row, and increments `attempts`.
3. The task runs. Success sets `completed`. Failure follows [section 7](#7-retry-and-failure-handling).
4. When the job reaches a final outcome the worker acknowledges the message. A job that is already `completed` or `cancelled` when a worker sees it is skipped and acknowledged.

## 7. Retry and failure handling

* **Attempts:** a job runs at most `max_attempts` times (default 3).
* **Backoff:** after a failed attempt the job returns to `queued` and the worker waits `2 × 2^(attempt − 1)` seconds, capped at 30: **2 s after the first failure, 4 s after the second**. The wait happens inside the worker, so that worker handles nothing else meanwhile. The job's status is re-read after the wait, so a job cancelled during the wait is not retried.
* **Final failure:** after the last attempt the job becomes `failed` and `failure_reason` is saved. The reason is only stored at this point; a job that is still retrying has none.
* **Two different records of a failure:**
  * *PostgreSQL `failed` jobs* are rows with `status = 'failed'`. They are visible in the dashboard (Job Explorer, **Failed** filter) and through `GET /jobs?status=failed`.
  * *The Redis dead-letter queue (DLQ)* is the stream `hoshi_queue:dead`. Each permanent failure appends an entry (`job_id`, `task_name`, `attempts`, `failure_reason`). **There is no API endpoint and no dashboard view for the DLQ.** Inspect it with `redis-cli XRANGE hoshi_queue:dead - +`.
* **Retrying a failed job** (`POST /jobs/{id}/retry`) resets `attempts` to 0 and enqueues it again. If it fails again it is appended to the DLQ again, so one job can appear in the DLQ more than once.
* **Crashed worker:** the worker renews its message lease every 20 s while it works. If it dies, another worker reclaims the message after 60 s of inactivity. Delivery is therefore *at least once*: a task interrupted by a crash can run again, so real tasks should be idempotent.
* **Cancellation** works only on `queued` jobs. Processing, completed and failed jobs return **409**.

## 8. API endpoints

Base URL `http://127.0.0.1:8000`. Interactive documentation (Swagger UI) is served at `/docs`.

| Method and path | Purpose | Notes |
|---|---|---|
| `GET /health` | FastAPI, PostgreSQL and Redis status | Always HTTP 200. `status` is `healthy` or `degraded`; each component is `healthy` or `unhealthy`. |
| `POST /jobs` | Create a job | Body `{"task_name": "send_email"}` (1 to 100 characters). **201** on success, **503** if Redis could not queue it (the job is still saved). |
| `GET /jobs` | List jobs, newest first | Query: `status` (`queued`, `processing`, `completed`, `failed`, `cancelled`), `q` (task-name search, case-insensitive substring, up to 100 characters), `limit` (1 to 100, default 20), `offset`. Returns `{total, limit, offset, jobs[]}`. |
| `GET /jobs/{id}` | One job | `id, task_name, status, attempts, max_attempts, failure_reason, created_at`. **404** if missing. |
| `POST /jobs/{id}/cancel` | Cancel a queued job | **200**; cancelling an already cancelled job is also 200; **409** for any other status. |
| `POST /jobs/{id}/retry` | Retry a failed job | **200**; resets attempts. If Redis is down the message says the job was saved and will be enqueued when Redis returns. **409** unless the job is `failed`. |
| `GET /dashboard/stats` | Counts and success rate | `{total_jobs, queued, processing, completed, failed, success_rate}`. `success_rate` is `null` when nothing has finished. |
| `GET /analytics/throughput?period=` | Jobs **created** per time bucket | `period`: `last_60_minutes` (per minute), `last_24_hours` (per hour), `last_7_days` (per day). Returns `{period, total, data: [{time, jobs}]}`. **400** for any other period. |

Job IDs larger than 2,147,483,647 (the PostgreSQL integer limit) are rejected with **422**.

```bash
curl -X POST http://127.0.0.1:8000/jobs -H "Content-Type: application/json" -d '{"task_name":"send_email"}'
curl "http://127.0.0.1:8000/jobs?status=failed&q=email&limit=10"
curl -X POST http://127.0.0.1:8000/jobs/1/retry
```

## 9. Environment variables

Copy `.env.example` to `.env` for reference. **HoshiQueue does not read `.env` files itself**; set the variables in the shell that starts the API and the workers.

| Variable | Default | Used by |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://taskforge:taskforge@localhost:5432/taskforge` (matches `docker-compose.yml`) | API, workers |
| `REDIS_URL` | `redis://localhost:6379/0` (an empty value also uses the default) | API, workers, Redis integration tests |
| `RUN_REDIS_INTEGRATION` | unset | tests only; set to `1` to run the Redis integration tests |

The frontend calls the API at `http://127.0.0.1:8000` (set in `frontend/src/api.js`), and the API allows browser requests from `http://localhost:5173` and `http://127.0.0.1:5173`.

## 10. Installation

Requirements: Python 3.12+, Node.js 20.19+ or 22.12+ (Vite 8), and either Docker or locally installed PostgreSQL 16 and Redis 7.

```bash
git clone <your-repository-url> HoshiQueue && cd HoshiQueue

docker compose up -d                       # PostgreSQL and Redis (see section 12)

python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python -m app.init_db                      # creates the tables

cd frontend && npm ci && cd ..
```

## 11. Windows setup (PowerShell)

1. Install Python 3.12+, Node.js 22 LTS, Git, and Docker Desktop (WSL 2 backend).
2. In the project folder:

```powershell
docker compose up -d
docker compose ps                                  # both services should become healthy

py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1                       # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
pip install -e ".[dev]"
python -m app.init_db

cd frontend; npm ci; cd ..
```

To override a setting for the current window: `$env:REDIS_URL = "redis://localhost:6379/0"`.

## 12. Docker Compose

`docker-compose.yml` starts **only the infrastructure**:

| Service | Image | Port (localhost only) |
|---|---|---|
| `postgres` | `postgres:16`, database/user/password `taskforge` (development only) | `127.0.0.1:5432` |
| `redis` | `redis:7`, no persistence volume | `127.0.0.1:6379` |

The API, the workers and the frontend run on your machine, not in containers; there is no `Dockerfile`.

```bash
docker compose up -d            # start
docker compose ps               # status and health
docker compose logs -f redis    # logs
docker compose down             # stop, keep the PostgreSQL volume
docker compose down -v          # stop and delete the PostgreSQL data
```

## 13. Running the backend, workers and frontend

Use one terminal each (activate the virtual environment in the first two):

```bash
uvicorn app.main:app --port 8000        # API  (add --reload while developing)
python -m worker.worker                 # worker; start more terminals for more workers
cd frontend && npm run dev              # dashboard at http://localhost:5173
```

Stop each with `Ctrl+C`, then `docker compose down`. Production build of the dashboard: `npm run build`.

## 14. Testing

```bash
pytest                                  # backend, no external services needed for most tests
RUN_REDIS_INTEGRATION=1 pytest          # also runs the Redis integration tests (needs Redis at REDIS_URL)
ruff check app worker tests             # style checks; a few findings remain (see Known limitations)

cd frontend
npm ci
npm run lint
npm test                                # Node test runner
npm run build
```

PowerShell: `$env:RUN_REDIS_INTEGRATION = "1"; pytest`.

* The API tests use an in-memory SQLite database; the Redis integration tests use uniquely named streams and delete them afterwards.
* Currently: 81 backend tests (2 of them need Redis) and 10 frontend tests.
* `npm run test:e2e` is an optional browser layout check. It needs `npm install --no-save puppeteer-core` and a `CHROME_PATH` environment variable pointing to Chrome.

## 15. Multi-worker verification

Start two workers in separate terminals (`python -m worker.worker`), then submit eight jobs and inspect Redis.

```bash
for i in $(seq 8); do curl -s -X POST http://127.0.0.1:8000/jobs -H "Content-Type: application/json" -d '{"task_name":"send_email"}' > /dev/null; done
curl http://127.0.0.1:8000/dashboard/stats
docker compose exec redis redis-cli XINFO CONSUMERS hoshi_queue:jobs hoshi_queue:workers
docker compose exec redis redis-cli XPENDING hoshi_queue:jobs hoshi_queue:workers
```

```powershell
1..8 | ForEach-Object { Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/jobs -ContentType 'application/json' -Body '{"task_name":"send_email"}' | Out-Null }
Invoke-RestMethod http://127.0.0.1:8000/dashboard/stats
docker compose exec redis redis-cli XINFO CONSUMERS hoshi_queue:jobs hoshi_queue:workers
docker compose exec redis redis-cli XPENDING hoshi_queue:jobs hoshi_queue:workers
```

Expected: `completed` reaches 8, `XINFO CONSUMERS` lists two consumers, `XPENDING` reports 0, and each worker terminal shows the `Claimed job N` lines for the jobs it took.

Observed in the author's run (Linux, PostgreSQL 16 and Redis installed natively, two workers): 8 of 8 jobs completed, two registered consumers, 4 jobs per worker, 0 pending. The split varies from run to run because `send_email` finishes instantly. This verifies that two workers cooperate on one stream; it is not a throughput benchmark.

## 16. Known limitations

* **Docker covers only PostgreSQL and Redis.** The API, workers and frontend run on the host. Redis has no persistence volume, so stream messages and DLQ entries are lost when its container is removed; PostgreSQL keeps the jobs and the reconciler re-enqueues `queued` ones.
* **Retry and cancel are API-only.** The dashboard has no buttons for them.
* **The Redis DLQ has no API or UI.** Use `redis-cli`. Failed jobs in PostgreSQL are visible in the Job Explorer.
* **No scheduled, delayed, recurring or prioritised jobs.**
* **No authentication or authorisation;** CORS allows only the two local development origins, and the frontend's API address is fixed in `frontend/src/api.js`.
* **A worker runs one job at a time,** and retry backoff sleeps inside the worker. Scale by starting more workers.
* **At-least-once delivery:** a job interrupted by a worker crash can run again after the 60 s lease expires. Crash recovery is covered by unit tests but has not been load-tested.
* **Throughput counts jobs created,** not completed, in buckets that use the `Asia/Kolkata` time zone.
* **Only `created_at` is stored,** so the dashboard shows no start or finish times or per-job history, and a retrying job has no failure reason until its last attempt fails.
* **Logging uses `print()`,** not the `logging` module.
* **Demo tasks only:** `send_email` is simulated and `slow_test` just sleeps.
* **Lint:** `ruff` still reports style findings (FastAPI `Depends` defaults, intentional broad exceptions in the worker, import ordering), and the frontend ships as a single JavaScript bundle of about 690 kB.
* **Verified on Ubuntu with native PostgreSQL and Redis.** The Docker Compose and Windows commands above use the same services and ports, but were not executed in that verification environment.

## Project layout

```text
app/         FastAPI app: main.py (endpoints), queue.py (Redis Streams), models.py, database.py, reconciler.py, init_db.py
worker/      worker.py (processing loop, retries, heartbeat), tasks.py (demo tasks)
frontend/    React dashboard (src/pages, src/components, src/lib, src/hooks)
tests/       pytest suite
docker-compose.yml   PostgreSQL and Redis for local development
.env.example         configuration template (placeholders only)
```

## License

See [LICENSE](LICENSE).
