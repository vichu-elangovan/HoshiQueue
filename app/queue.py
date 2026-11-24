
import os

import redis

QUEUE_NAME = "hoshi_queue:jobs"
GROUP_NAME = "hoshi_queue:workers"
DEAD_LETTER_QUEUE_NAME = "hoshi_queue:dead"
DEAD_LETTER_TRANSFER_PREFIX = "hoshi_queue:dead:transferred:"

# A message idle for 60 seconds can be reclaimed.
# Long-running tasks use heartbeat renewal.
LEASE_MS = 60_000

DEDUPLICATION_PREFIX = "hoshi_queue:enqueued:"


# Set the REDIS_URL environment variable to use another Redis. The default is
# the Redis container started by docker-compose.yml. An empty value is ignored.
REDIS_URL = os.getenv("REDIS_URL") or "redis://localhost:6379/0"

redis_client = redis.Redis.from_url(
    REDIS_URL,
    decode_responses=True,
    socket_timeout=None,
)

def is_job_enqueued(job_id: int) -> bool:
    """Check whether a job currently has a Redis deduplication key."""
    return bool(
        redis_client.exists(
            f"{DEDUPLICATION_PREFIX}{job_id}"
        )
    )


# Atomically prevent duplicate messages for the same job.
ENQUEUE_SCRIPT = """
local existing = redis.call('SET', KEYS[1], '1', 'NX')

if existing then
    return redis.call(
        'XADD',
        KEYS[2],
        '*',
        'job_id',
        ARGV[1]
    )
end

return false
"""
ACKNOWLEDGE_SCRIPT = """
local acknowledged = redis.call(
    'XACK',
    KEYS[1],
    ARGV[1],
    ARGV[2]
)

if acknowledged == 1 then
    redis.call('DEL', KEYS[2])
end

return acknowledged
"""
DEAD_LETTER_SCRIPT = """
-- Check whether this message was already transferred.
local existing = redis.call('GET', KEYS[4])

if existing then
    return existing
end

-- Verify that the message is still pending.
local pending = redis.call(
    'XPENDING',
    KEYS[1],
    ARGV[1],
    ARGV[6],
    ARGV[6],
    1
)

if #pending == 0 then
    return false
end

-- Only the worker currently owning the message may transfer it.
if pending[1][2] ~= ARGV[7] then
    return false
end

-- Add the failed job to the dead-letter stream.
local dead_id = redis.call(
    'XADD',
    KEYS[2],
    '*',
    'job_id', ARGV[2],
    'task_name', ARGV[3],
    'attempts', ARGV[4],
    'failure_reason', ARGV[5]
)

-- Acknowledge the original message.
local acknowledged = redis.call(
    'XACK',
    KEYS[1],
    ARGV[1],
    ARGV[6]
)

if acknowledged == 1 then
    redis.call('DEL', KEYS[3])
    redis.call('SET', KEYS[4], dead_id)
    return dead_id
end

-- Remove the new entry if acknowledgement failed.
redis.call('XDEL', KEYS[2], dead_id)

return false
"""


def ensure_consumer_group() -> None:
    try:
        redis_client.xgroup_create(
            name=QUEUE_NAME,
            groupname=GROUP_NAME,
            id="0-0",
            mkstream=True,
        )
    except redis.ResponseError as error:
        if "BUSYGROUP" not in str(error):
            raise


def enqueue_job(job_id: int) -> str | None:
    """Enqueue a job only if it has not already been enqueued."""
    ensure_consumer_group()

    result = redis_client.eval(
        ENQUEUE_SCRIPT,
        2,
        f"{DEDUPLICATION_PREFIX}{job_id}",
        QUEUE_NAME,
        str(job_id),
    )

    return result if result else None


def claim_job(worker_id: str) -> dict | None:
    ensure_consumer_group()

    # First recover a message abandoned by another worker.
    result = redis_client.xautoclaim(
        name=QUEUE_NAME,
        groupname=GROUP_NAME,
        consumername=worker_id,
        min_idle_time=LEASE_MS,
        start_id="0-0",
        count=1,
    )

    messages = result[1]

    if messages:
        message_id, fields = messages[0]

        return {
            "message_id": message_id,
            "job_id": fields["job_id"],
        }

    # Otherwise wait for a new message.
    batches = redis_client.xreadgroup(
        groupname=GROUP_NAME,
        consumername=worker_id,
        streams={QUEUE_NAME: ">"},
        count=1,
        block=1000,
    )

    if not batches:
        return None

    _, messages = batches[0]
    message_id, fields = messages[0]

    return {
        "message_id": message_id,
        "job_id": fields["job_id"],
    }


def acknowledge_job(claim: dict) -> None:
    """Atomically acknowledge a message and release its deduplication key."""
    redis_client.eval(
        ACKNOWLEDGE_SCRIPT,
        2,
        QUEUE_NAME,
        f"{DEDUPLICATION_PREFIX}{claim['job_id']}",
        GROUP_NAME,
        claim["message_id"],
    )
def move_job_to_dead_letter(
    claim: dict,
    worker_id: str,
    job_id: int,
    task_name: str,
    attempts: int,
    failure_reason: str,
) -> str | None:
    """Transfer a failed job to DLQ with ownership verification."""

    ensure_consumer_group()

    result = redis_client.eval(
        DEAD_LETTER_SCRIPT,
        4,
        QUEUE_NAME,
        DEAD_LETTER_QUEUE_NAME,
        f"{DEDUPLICATION_PREFIX}{job_id}",
        (
            f"{DEAD_LETTER_TRANSFER_PREFIX}"
            f"{claim['message_id']}"
        ),
        GROUP_NAME,
        str(job_id),
        task_name,
        str(attempts),
        failure_reason,
        claim["message_id"],
        worker_id,
    )

    return result if result else None

def renew_job_lease(message_id: str, worker_id: str) -> bool:
    """Renew the lease only if this worker still owns the message."""
    pending_messages = redis_client.xpending_range(
        name=QUEUE_NAME,
        groupname=GROUP_NAME,
        min=message_id,
        max=message_id,
        count=1,
    )

    if not pending_messages:
        return False

    if pending_messages[0]["consumer"] != worker_id:
        return False

    result = redis_client.xclaim(
        name=QUEUE_NAME,
        groupname=GROUP_NAME,
        consumername=worker_id,
        min_idle_time=0,
        message_ids=[message_id],
        idle=0,
    )

    return bool(result)
