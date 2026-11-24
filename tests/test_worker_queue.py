
from unittest.mock import MagicMock

from worker import worker


def handle_claim(claim):
    """Process a claimed message and acknowledge only on success."""
    if worker.process_job(claim["job_id"]):
        worker.acknowledge_job(claim)
        return True

    return False


def test_worker_acknowledges_job_when_processing_succeeds(monkeypatch):
    claim = {
        "job_id": "201",
        "message_id": "12345-0",
    }

    monkeypatch.setattr(worker, "process_job", lambda job_id: True)
    acknowledge = MagicMock()
    monkeypatch.setattr(worker, "acknowledge_job", acknowledge)

    result = handle_claim(claim)

    assert result is True
    acknowledge.assert_called_once_with(claim)


def test_worker_does_not_acknowledge_when_processing_fails(monkeypatch):
    claim = {
        "job_id": "202",
        "message_id": "12346-0",
    }

    monkeypatch.setattr(worker, "process_job", lambda job_id: False)
    acknowledge = MagicMock()
    monkeypatch.setattr(worker, "acknowledge_job", acknowledge)

    result = handle_claim(claim)

    assert result is False
    acknowledge.assert_not_called()
