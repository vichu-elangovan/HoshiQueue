
from unittest.mock import MagicMock

import redis

from app import queue


def test_ensure_consumer_group_creates_group(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(queue, "redis_client", client)

    queue.ensure_consumer_group()

    client.xgroup_create.assert_called_once_with(
        name=queue.QUEUE_NAME,
        groupname=queue.GROUP_NAME,
        id="0-0",
        mkstream=True,
    )


def test_ensure_consumer_group_ignores_existing_group(monkeypatch):
    client = MagicMock()
    client.xgroup_create.side_effect = redis.ResponseError(
        "BUSYGROUP Consumer Group name already exists"
    )
    monkeypatch.setattr(queue, "redis_client", client)

    # Should not raise when the group already exists.
    queue.ensure_consumer_group()



def test_enqueue_job_adds_job_to_stream(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(queue, "redis_client", client)
    monkeypatch.setattr(queue, "ensure_consumer_group", MagicMock())

    client.eval.return_value = "12345-0"

    result = queue.enqueue_job(301)

    assert result == "12345-0"

    client.eval.assert_called_once_with(
        queue.ENQUEUE_SCRIPT,
        2,
        f"{queue.DEDUPLICATION_PREFIX}301",
        queue.QUEUE_NAME,
        "301",
    )


def test_enqueue_job_returns_none_for_duplicate(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(queue, "redis_client", client)
    monkeypatch.setattr(queue, "ensure_consumer_group", MagicMock())

    client.eval.return_value = None

    result = queue.enqueue_job(301)

    assert result is None
    client.eval.assert_called_once()



def test_claim_job_reads_new_message(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(queue, "redis_client", client)
    monkeypatch.setattr(queue, "ensure_consumer_group", MagicMock())

    client.xautoclaim.return_value = ("0-0", [], 0)
    client.xreadgroup.return_value = [
        (
            queue.QUEUE_NAME,
            [("12345-0", {"job_id": "301"})],
        )
    ]

    result = queue.claim_job("worker-test")

    assert result == {
        "message_id": "12345-0",
        "job_id": "301",
    }

    client.xreadgroup.assert_called_once_with(
        groupname=queue.GROUP_NAME,
        consumername="worker-test",
        streams={queue.QUEUE_NAME: ">"},
        count=1,
        block=1000,
    )


def test_claim_job_recovers_idle_message(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(queue, "redis_client", client)
    monkeypatch.setattr(queue, "ensure_consumer_group", MagicMock())

    client.xautoclaim.return_value = (
        "0-0",
        [("12345-0", {"job_id": "301"})],
        0,
    )

    result = queue.claim_job("worker-recovery")

    assert result == {
        "message_id": "12345-0",
        "job_id": "301",
    }

    # A recovered message means we should not read a new one.
    client.xreadgroup.assert_not_called()


def test_claim_job_returns_none_when_no_message(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(queue, "redis_client", client)
    monkeypatch.setattr(queue, "ensure_consumer_group", MagicMock())

    client.xautoclaim.return_value = ("0-0", [], 0)
    client.xreadgroup.return_value = []

    assert queue.claim_job("worker-test") is None


def test_acknowledge_job_acks_message(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(queue, "redis_client", client)

    claim = {
        "message_id": "12345-0",
        "job_id": "301",
    }

    queue.acknowledge_job(claim)

    client.eval.assert_called_once_with(
        queue.ACKNOWLEDGE_SCRIPT,
        2,
        queue.QUEUE_NAME,
        f"{queue.DEDUPLICATION_PREFIX}301",
        queue.GROUP_NAME,
        "12345-0",
    )
def test_move_job_to_dead_letter(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(queue, "redis_client", client)
    monkeypatch.setattr(queue, "ensure_consumer_group", MagicMock())

    client.eval.return_value = "999-0"

    claim = {
        "message_id": "12345-0",
        "job_id": "301",
    }

    result = queue.move_job_to_dead_letter(
        claim=claim,
        worker_id="worker-test",
        job_id=301,
        task_name="send_email",
        attempts=3,
        failure_reason="Simulated failure",
    )

    assert result == "999-0"

    client.eval.assert_called_once_with(
        queue.DEAD_LETTER_SCRIPT,
        4,
        queue.QUEUE_NAME,
        queue.DEAD_LETTER_QUEUE_NAME,
        f"{queue.DEDUPLICATION_PREFIX}301",
        f"{queue.DEAD_LETTER_TRANSFER_PREFIX}12345-0",
        queue.GROUP_NAME,
        "301",
        "send_email",
        "3",
        "Simulated failure",
        "12345-0",
        "worker-test",
    )

def test_move_job_to_dead_letter_returns_none_when_not_acknowledged(
    monkeypatch,
):
    
    client = MagicMock()
    monkeypatch.setattr(queue, "redis_client", client)
    monkeypatch.setattr(queue, "ensure_consumer_group", MagicMock())

    client.eval.return_value = None

    claim = {
        "message_id": "12345-0",
        "job_id": "301",
    }

    result = queue.move_job_to_dead_letter(
        worker_id="worker-test",
        claim=claim,
        job_id=301,
        task_name="send_email",
        attempts=3,
        failure_reason="Simulated failure",
    )

    assert result is None


def test_is_job_enqueued(monkeypatch):
    client = MagicMock()
    client.exists.return_value = 1

    monkeypatch.setattr(queue, "redis_client", client)

    assert queue.is_job_enqueued(301) is True

    client.exists.return_value = 0

    assert queue.is_job_enqueued(301) is False