from unittest.mock import MagicMock, patch

from app.reconciler import reconcile_queued_jobs


def test_reconciler_enqueues_missing_job():
    job = MagicMock()
    job.id = 101

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [
        job
    ]

    with (
        patch("app.reconciler.SessionLocal", return_value=mock_db),
        patch("app.reconciler.is_job_enqueued", return_value=False),
        patch("app.reconciler.enqueue_job") as mock_enqueue,
    ):
        result = reconcile_queued_jobs()

    mock_enqueue.assert_called_once_with(101)
    assert result == 1
    mock_db.close.assert_called_once()


def test_reconciler_skips_existing_job():
    job = MagicMock()
    job.id = 102

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [
        job
    ]

    with (
        patch("app.reconciler.SessionLocal", return_value=mock_db),
        patch("app.reconciler.is_job_enqueued", return_value=True),
        patch("app.reconciler.enqueue_job") as mock_enqueue,
    ):
        result = reconcile_queued_jobs()

    mock_enqueue.assert_not_called()
    assert result == 0
    mock_db.close.assert_called_once()