
import os
import uuid

import pytest
import redis

REDIS_URL = os.getenv("REDIS_URL") or "redis://localhost:6379/0"


@pytest.mark.skipif(
    os.getenv("RUN_REDIS_INTEGRATION") != "1",
    reason="Set RUN_REDIS_INTEGRATION=1 to run Redis integration tests",
)
def test_real_redis_enqueue_claim_and_acknowledge():
    client = redis.Redis.from_url(
        REDIS_URL,
        decode_responses=True,
    )

    stream_name = f"hoshi_queue:test:{uuid.uuid4().hex}"
    group_name = "test-workers"
    consumer_name = "test-consumer"

    try:
        client.ping()

        client.xgroup_create(
            name=stream_name,
            groupname=group_name,
            id="0-0",
            mkstream=True,
        )

        message_id = client.xadd(
            stream_name,
            {"job_id": "987654"},
        )

        messages = client.xreadgroup(
            groupname=group_name,
            consumername=consumer_name,
            streams={stream_name: ">"},
            count=1,
            block=1000,
        )

        assert messages
        received_id, fields = messages[0][1][0]

        assert received_id == message_id
        assert fields["job_id"] == "987654"

        pending = client.xpending(stream_name, group_name)
        assert pending["pending"] == 1

        acknowledged = client.xack(
            stream_name,
            group_name,
            message_id,
        )

        assert acknowledged == 1

        pending_after_ack = client.xpending(stream_name, group_name)
        assert pending_after_ack["pending"] == 0

    finally:
        client.delete(stream_name)
        client.close()

@pytest.mark.skipif(
    os.getenv("RUN_REDIS_INTEGRATION") != "1",
    reason="Set RUN_REDIS_INTEGRATION=1 to run Redis integration tests",
)
@pytest.mark.skipif(
    os.getenv("RUN_REDIS_INTEGRATION") != "1",
    reason="Set RUN_REDIS_INTEGRATION=1 to run Redis integration tests",
)
def test_real_redis_dead_letter_transfer():
    from app import queue

    client = redis.Redis.from_url(
        REDIS_URL,
        decode_responses=True,
    )

    suffix = uuid.uuid4().hex
    stream_name = f"hoshi_queue:test:{suffix}"
    dead_stream = f"hoshi_queue:dead:test:{suffix}"
    group_name = f"test-workers:{suffix}"
    dedup_key = f"hoshi_queue:enqueued:test:{suffix}"
    transfer_key = f"hoshi_queue:dead:transferred:test:{suffix}"

    try:
        client.ping()

        client.xgroup_create(
            name=stream_name,
            groupname=group_name,
            id="0-0",
            mkstream=True,
        )

        message_id = client.xadd(
            stream_name,
            {"job_id": "987654"},
        )

        client.set(dedup_key, "1")

        client.xreadgroup(
            groupname=group_name,
            consumername="test-consumer",
            streams={stream_name: ">"},
            count=1,
        )

        script = queue.DEAD_LETTER_SCRIPT

        args = [
            group_name,
            "987654",
            "send_email",
            "3",
            "Simulated permanent failure",
            message_id,
            "test-consumer",
        ]

        dead_letter_id = client.eval(
            script,
            4,
            stream_name,
            dead_stream,
            dedup_key,
            transfer_key,
            *args,
        )

        assert dead_letter_id

        dead_messages = client.xrange(dead_stream)
        assert len(dead_messages) == 1

        _, fields = dead_messages[0]

        assert fields["job_id"] == "987654"
        assert fields["task_name"] == "send_email"
        assert fields["attempts"] == "3"
        assert fields["failure_reason"] == "Simulated permanent failure"

        assert client.xpending(stream_name, group_name)["pending"] == 0
        assert client.exists(dedup_key) == 0

        # Repeating the transfer must not create another DLQ entry.
        repeated_result = client.eval(
            script,
            4,
            stream_name,
            dead_stream,
            dedup_key,
            transfer_key,
            *args,
        )

        assert repeated_result == dead_letter_id
        assert len(client.xrange(dead_stream)) == 1

    finally:
        client.delete(
            stream_name,
            dead_stream,
            dedup_key,
            transfer_key,
        )
        client.close()