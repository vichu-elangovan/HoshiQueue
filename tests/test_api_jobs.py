import pytest
import redis
from api_helpers import add_jobs

from app.models import Job


def ids(response):
    return [job["id"] for job in response.json()["jobs"]]


# ---------- GET /jobs: status filter ----------

@pytest.mark.parametrize(
    "status",
    ["queued", "processing", "completed", "failed", "cancelled"],
)
def test_list_jobs_accepts_every_job_status(client, session_factory, status):
    add_jobs(
        session_factory,
        {"task_name": "send_email", "status": status},
        {"task_name": "send_email", "status": "queued" if status != "queued" else "failed"},
    )

    response = client.get("/jobs", params={"status": status})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert [job["status"] for job in body["jobs"]] == [status]


def test_list_jobs_rejects_unknown_status(client):
    assert client.get("/jobs", params={"status": "bogus"}).status_code == 422


def test_list_jobs_without_filters_is_unchanged(client, session_factory):
    first, second = add_jobs(
        session_factory,
        {"task_name": "send_email", "status": "completed", "attempts": 1},
        {"task_name": "slow_test", "status": "failed", "attempts": 3,
         "failure_reason": "boom"},
    )

    response = client.get("/jobs")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"total", "limit", "offset", "jobs"}
    assert (body["total"], body["limit"], body["offset"]) == (2, 20, 0)
    assert ids(response) == [second, first]  # newest first
    assert set(body["jobs"][0]) == {
        "id", "task_name", "status", "attempts",
        "max_attempts", "failure_reason", "created_at",
    }


# ---------- GET /jobs: task-name search (q) ----------

def test_q_matches_substring_case_insensitively(client, session_factory):
    email, slow = add_jobs(
        session_factory,
        {"task_name": "send_email"},
        {"task_name": "slow_test"},
    )

    assert ids(client.get("/jobs", params={"q": "EMAIL"})) == [email]
    assert ids(client.get("/jobs", params={"q": "slow"})) == [slow]
    assert ids(client.get("/jobs", params={"q": "nomatch"})) == []


def test_q_treats_like_wildcards_literally(client, session_factory):
    underscore, other, percent = add_jobs(
        session_factory,
        {"task_name": "a_b"},
        {"task_name": "axb"},
        {"task_name": "100%"},
    )

    assert ids(client.get("/jobs", params={"q": "_"})) == [underscore]
    assert ids(client.get("/jobs", params={"q": "%"})) == [percent]
    assert other not in ids(client.get("/jobs", params={"q": "a_b"}))


def test_q_treats_backslash_literally(client, session_factory):
    backslashed, _plain = add_jobs(
        session_factory,
        {"task_name": "path\\to"},
        {"task_name": "plain"},
    )

    assert ids(client.get("/jobs", params={"q": "\\"})) == [backslashed]


def test_blank_q_is_ignored(client, session_factory):
    add_jobs(session_factory, {"task_name": "send_email"}, {"task_name": "slow_test"})

    for blank in ("", "   "):
        response = client.get("/jobs", params={"q": blank})
        assert response.status_code == 200
        assert response.json()["total"] == 2


def test_q_is_trimmed(client, session_factory):
    (email,) = add_jobs(session_factory, {"task_name": "send_email"})

    assert ids(client.get("/jobs", params={"q": "  send_email  "})) == [email]


def test_q_longer_than_task_name_column_is_rejected(client):
    assert client.get("/jobs", params={"q": "x" * 101}).status_code == 422
    assert client.get("/jobs", params={"q": "x" * 100}).status_code == 200


def test_q_combines_with_status_and_pagination(client, session_factory):
    created = add_jobs(
        session_factory,
        *[{"task_name": "send_email", "status": "failed"} for _ in range(5)],
        {"task_name": "send_email", "status": "completed"},
        {"task_name": "slow_test", "status": "failed"},
    )
    failed_emails = created[:5]

    response = client.get(
        "/jobs",
        params={"q": "email", "status": "failed", "limit": 2, "offset": 1},
    )

    body = response.json()
    assert body["total"] == 5  # total reflects the filters, not the page
    assert ids(response) == [failed_emails[3], failed_emails[2]]
    assert (body["limit"], body["offset"]) == (2, 1)


# ---------- GET /jobs/{id} ----------

def test_get_job_includes_retry_details(client, session_factory):
    (job_id,) = add_jobs(
        session_factory,
        {"task_name": "send_email", "status": "failed", "attempts": 3,
         "max_attempts": 3, "failure_reason": "SMTP timeout"},
    )

    response = client.get(f"/jobs/{job_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["max_attempts"] == 3
    assert body["failure_reason"] == "SMTP timeout"
    # the original fields are all still there
    assert {"id", "task_name", "status", "attempts", "created_at"} <= set(body)
    assert body["id"] == job_id and body["attempts"] == 3


def test_get_job_failure_reason_is_null_when_none(client, session_factory):
    (job_id,) = add_jobs(session_factory, {"task_name": "send_email"})

    body = client.get(f"/jobs/{job_id}").json()

    assert body["failure_reason"] is None
    assert body["max_attempts"] == 3


def test_get_job_returns_404_for_unknown_id(client):
    response = client.get("/jobs/999")

    assert response.status_code == 404
    assert response.json() == {"detail": "Job not found"}


# ---------- POST /jobs/{id}/retry: response must match what really happened ----------

FAILED_JOB = {
    "task_name": "send_email",
    "status": "failed",
    "attempts": 3,
    "failure_reason": "SMTP timeout",
}


def get_job_row(session_factory, job_id):
    db = session_factory()
    try:
        job = db.get(Job, job_id)
        db.expunge(job)
        return job
    finally:
        db.close()


def test_retry_reports_a_successful_enqueue(client, session_factory, monkeypatch):
    (job_id,) = add_jobs(session_factory, FAILED_JOB)
    enqueued = []
    monkeypatch.setattr("app.main.enqueue_job", enqueued.append)

    response = client.post(f"/jobs/{job_id}/retry")

    assert response.status_code == 200
    body = response.json()
    assert body["message"] == "Job queued for retry successfully."
    assert (body["job_id"], body["status"], body["attempts"]) == (job_id, "queued", 0)
    assert enqueued == [job_id]


def test_retry_reports_a_redis_failure_instead_of_claiming_success(
    client, session_factory, monkeypatch
):
    (job_id,) = add_jobs(session_factory, FAILED_JOB)

    def redis_is_down(_job_id):
        raise redis.RedisError("connection refused")

    monkeypatch.setattr("app.main.enqueue_job", redis_is_down)

    response = client.post(f"/jobs/{job_id}/retry")

    assert response.status_code == 200
    body = response.json()
    assert body["message"] == (
        "Job saved for retry. It will be enqueued when Redis becomes available."
    )
    assert "successfully" not in body["message"]
    assert body["status"] == "queued"

    # The job is safely stored as queued, so the reconciler can enqueue it later.
    row = get_job_row(session_factory, job_id)
    assert (row.status, row.attempts, row.failure_reason) == ("queued", 0, None)


def test_retry_still_rejects_jobs_that_are_not_failed(client, session_factory):
    (job_id,) = add_jobs(session_factory, {"task_name": "send_email", "status": "completed"})

    response = client.post(f"/jobs/{job_id}/retry")

    assert response.status_code == 409
    assert response.json() == {"detail": "Cannot retry a job with status 'completed'."}


# ---------- Job IDs beyond the database's INTEGER range ----------

JOB_ID_ENDPOINTS = [
    ("get", "/jobs/{job_id}"),
    ("post", "/jobs/{job_id}/cancel"),
    ("post", "/jobs/{job_id}/retry"),
]


@pytest.mark.parametrize("method, path", JOB_ID_ENDPOINTS)
@pytest.mark.parametrize("job_id", [2_147_483_648, 99_999_999_999, 10**30])
def test_oversized_job_id_is_a_422_validation_error(client, method, path, job_id):
    response = getattr(client, method)(path.format(job_id=job_id))

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["path", "job_id"]


@pytest.mark.parametrize("method, path", JOB_ID_ENDPOINTS)
@pytest.mark.parametrize("job_id", [2_147_483_647, 999, 0, -1])
def test_other_unknown_job_ids_are_still_404(client, method, path, job_id):
    response = getattr(client, method)(path.format(job_id=job_id))

    assert response.status_code == 404
    assert response.json() == {"detail": "Job not found"}
