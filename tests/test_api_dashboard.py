import pytest
from api_helpers import add_jobs


def jobs_with(status, count):
    return [{"task_name": "send_email", "status": status} for _ in range(count)]


def get_stats(client):
    response = client.get("/dashboard/stats")
    assert response.status_code == 200
    return response.json()


def test_success_rate_is_null_when_there_are_no_jobs(client):
    assert get_stats(client) == {
        "total_jobs": 0,
        "queued": 0,
        "processing": 0,
        "completed": 0,
        "failed": 0,
        "success_rate": None,
    }


def test_success_rate_is_null_when_no_job_has_finished(client, session_factory):
    add_jobs(
        session_factory,
        *jobs_with("queued", 3),
        *jobs_with("processing", 2),
        *jobs_with("cancelled", 4),
    )

    stats = get_stats(client)

    assert stats["total_jobs"] == 9
    assert stats["success_rate"] is None


@pytest.mark.parametrize(
    "completed, failed, expected",
    [
        (1, 0, 100.0),
        (0, 1, 0.0),
        (3, 1, 75.0),
        (2, 1, 66.67),
        (1, 2, 33.33),
        (47, 14, 77.05),
    ],
)
def test_success_rate_is_completed_over_completed_plus_failed(
    client, session_factory, completed, failed, expected
):
    add_jobs(
        session_factory,
        *jobs_with("completed", completed),
        *jobs_with("failed", failed),
    )

    assert get_stats(client)["success_rate"] == expected


def test_queued_processing_and_cancelled_jobs_are_not_in_the_denominator(
    client, session_factory
):
    add_jobs(session_factory, *jobs_with("completed", 3), *jobs_with("failed", 1))
    assert get_stats(client)["success_rate"] == 75.0

    add_jobs(
        session_factory,
        *jobs_with("queued", 5),
        *jobs_with("processing", 4),
        *jobs_with("cancelled", 7),
    )

    stats = get_stats(client)
    assert stats["success_rate"] == 75.0
    assert stats["total_jobs"] == 20  # the job counts themselves are unchanged
    assert (stats["queued"], stats["processing"]) == (5, 4)
    assert (stats["completed"], stats["failed"]) == (3, 1)
