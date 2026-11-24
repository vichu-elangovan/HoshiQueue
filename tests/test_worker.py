
from types import SimpleNamespace
from unittest.mock import MagicMock

from worker import worker


def configure_database_mock(db, job):
    """Configure the mocked SQLAlchemy query and row lock."""
    db.get.return_value = job

    locked_query = (
        db.query.return_value
        .filter.return_value
        .with_for_update.return_value
    )

    locked_query.first.return_value = job
    locked_query.populate_existing.return_value.first.return_value = job


def test_successful_job_is_marked_completed(monkeypatch):
    job = SimpleNamespace(
        id=101,
        task_name="send_email",
        status="queued",
        attempts=0,
        max_attempts=3,
    )

    db = MagicMock()
    configure_database_mock(db, job)

    monkeypatch.setattr(worker, "SessionLocal", lambda: db)
    monkeypatch.setattr(
        worker,
        "execute_task",
        lambda task_name: None,
    )

    worker.process_job("101")

    assert job.status == "completed"
    assert job.attempts == 1
    db.commit.assert_called()


def test_failed_task_retries_until_limit(monkeypatch):
    job = SimpleNamespace(
        id=102,
        task_name="unknown_task",
        status="queued",
        attempts=0,
        max_attempts=3,
    )

    db = MagicMock()
    configure_database_mock(db, job)

    monkeypatch.setattr(worker, "SessionLocal", lambda: db)
    monkeypatch.setattr(
        worker,
        "execute_task",
        lambda task_name: (_ for _ in ()).throw(
            ValueError("simulated failure")
        ),
    )

    retry_delays = []

    monkeypatch.setattr(
        worker.time,
        "sleep",
        lambda seconds: retry_delays.append(seconds),
    )

    worker.process_job("102")

    assert job.status == "failed"
    assert job.attempts == 3
    assert db.commit.call_count >= 3
    assert retry_delays == [2, 4]


def test_retry_delay_is_capped_at_30_seconds():
    delays = [
        min(
            worker.BASE_RETRY_DELAY * (2 ** (attempt - 1)),
            worker.MAX_RETRY_DELAY,
        )
        for attempt in range(1, 7)
    ]

    assert delays == [2, 4, 8, 16, 30, 30]
