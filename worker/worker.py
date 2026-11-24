
import threading
import time
import uuid

import redis

from app.database import SessionLocal
from app.models import Job

from app.queue import (
    LEASE_MS,
    acknowledge_job,
    claim_job,
    move_job_to_dead_letter,
    renew_job_lease,
)
from worker.tasks import execute_task
from app.reconciler import reconcile_queued_jobs


# Renew well before the 60-second lease expires.
HEARTBEAT_INTERVAL = max(1, LEASE_MS / 3000)
RECONCILE_INTERVAL = 30
BASE_RETRY_DELAY = 2
MAX_RETRY_DELAY = 30


def heartbeat(
    claim: dict,
    worker_id: str,
    stop_event: threading.Event,
    ownership_lost: threading.Event,
) -> None:
    """Renew the Redis message lease while the task is running."""
    message_id = claim["message_id"]

    while not stop_event.wait(HEARTBEAT_INTERVAL):
        try:
            renewed = renew_job_lease(message_id, worker_id)

            if not renewed:
                print(
                    f"Lease renewal failed for message {message_id}; "
                    "this worker may no longer own it."
                )
                ownership_lost.set()
                return

        except redis.RedisError as error:
            print(f"Heartbeat Redis error: {error}")
            # Try again on the next heartbeat interval.

def process_job(job_id: str) -> bool | dict:
    """Process a job and return its outcome."""
    db = SessionLocal()

    try:
        job = (
            db.query(Job)
            .filter(Job.id == int(job_id))
            .with_for_update()
            .first()
            )

        if job is None:
            print(f"Job {job_id} not found in PostgreSQL.")
            return True

        if job.status == "completed":
            print(f"Job {job_id} is already completed.")
            return True
        if job.status == "cancelled":
            print(f"Job {job_id} was cancelled. Skipping execution.")
            return True

        if job.status == "failed":
            print(f"Job {job_id} is already failed.")

            return {
                "status": "failed",
                "job_id": job.id,
                "task_name": job.task_name,
                "attempts": job.attempts,
                "failure_reason": (
                    job.failure_reason or "Unknown failure"
                ),
            }

        if job.status not in ("queued", "processing"):
            print(
                f"Job {job_id} has unexpected status "
                f"'{job.status}'. Leaving it unacknowledged."
            )
            return False

        if job.status == "processing":
            print(f"Recovering previously claimed job {job_id}.")

        if job.attempts >= job.max_attempts:
            job.status = "failed"

            if not job.failure_reason:
                job.failure_reason = "Maximum attempts exhausted."

            db.commit()

            return {
                "status": "failed",
                "job_id": job.id,
                "task_name": job.task_name,
                "attempts": job.attempts,
                "failure_reason": job.failure_reason,
            }

        while job.attempts < job.max_attempts:
            job.attempts += 1
            job.status = "processing"
            db.commit()

            print(
                f"Processing job {job.id}: {job.task_name} "
                f"(attempt {job.attempts}/{job.max_attempts})"
            )

            try:
                execute_task(job.task_name)

                job.status = "completed"
                job.failure_reason = None
                db.commit()

                print(f"Job {job.id} completed successfully.")
                return True

            except Exception as error:
                failure_reason = str(error)

                db.rollback()
                job = db.get(Job, int(job_id))

                if job is None:
                    return True

                if job.attempts < job.max_attempts:
                    job.status = "queued"
                    db.commit()

                    print(
                        f"Job {job.id} failed on attempt "
                        f"{job.attempts}: {failure_reason}"
                    )

                    delay = min(
                        BASE_RETRY_DELAY * (2 ** (job.attempts - 1)),
                        MAX_RETRY_DELAY,
                    )

                    print(f"Retrying in {delay} seconds...")
                    time.sleep(delay)

                    

                    # Recheck the job status before the next retry.
                    job = (
                        db.query(Job)
                        .filter(Job.id == int(job_id))
                        .with_for_update()
                        .populate_existing()
                        .first()
                    )

                    if job is None:
                        return True

                    if job.status == "cancelled":
                        print(f"Job {job.id} was cancelled during retry delay.")
                        return True

                    if job.status != "queued":
                        print(f"Job {job.id} is no longer queued. Skipping retry.")
                        return False

                else:
                    job.status = "failed"
                    job.failure_reason = failure_reason
                    db.commit()

                    print(
                        f"Job {job.id} permanently failed after "
                        f"{job.attempts} attempts: {failure_reason}"
                    )

                    return {
                        "status": "failed",
                        "job_id": job.id,
                        "task_name": job.task_name,
                        "attempts": job.attempts,
                        "failure_reason": failure_reason,
                    }

        return False

    except Exception as error:
        db.rollback()
        print(f"Could not safely finish job {job_id}: {error}")
        return False

    finally:
        db.close()

def run_worker():
    worker_id = str(uuid.uuid4())
    next_reconciliation = 0

    print(f"HoshiQueue worker started: {worker_id}")
    print("Waiting for jobs in Redis Streams...")
    print(f"Heartbeat interval: {HEARTBEAT_INTERVAL:.1f} seconds")
    print(f"Reconciliation interval: {RECONCILE_INTERVAL} seconds")

    while True:
        if time.monotonic() >= next_reconciliation:
            try:
                recovered = reconcile_queued_jobs()

                print(
                    f"Reconciliation completed. "
                    f"Recovered jobs: {recovered}"
                )

            except Exception as error:
                print(f"Reconciliation error: {error}")

            next_reconciliation = (
                time.monotonic() + RECONCILE_INTERVAL
            )
        try:
            claim = claim_job(worker_id)

            if claim is None:
                continue

            job_id = claim["job_id"]
            message_id = claim["message_id"]

            print(f"Claimed job {job_id} (message {message_id}).")

            stop_event = threading.Event()
            ownership_lost = threading.Event()

            heartbeat_thread = threading.Thread(
                target=heartbeat,
                args=(
                    claim,
                    worker_id,
                    stop_event,
                    ownership_lost,
                ),
                daemon=True,
            )
            heartbeat_thread.start()

            try:
                outcome_saved = process_job(job_id)
            finally:
                stop_event.set()
                heartbeat_thread.join()

            if ownership_lost.is_set():
                print(
                    f"Job {job_id}: ownership was lost; "
                    "not acknowledging this message."
                )

            elif isinstance(outcome_saved, dict) and outcome_saved.get("status") == "failed":
                dead_letter_id = move_job_to_dead_letter(
                    claim=claim,
                    worker_id=worker_id,
                    job_id=outcome_saved["job_id"],
                    task_name=outcome_saved["task_name"],
                    attempts=outcome_saved["attempts"],
                    failure_reason=outcome_saved["failure_reason"],
                )

                if dead_letter_id:
                    print(
                        f"Job {job_id} moved to Dead Letter Queue. "
                        f"DLQ message: {dead_letter_id}"
                    )
                else:
                    print(
                        f"Job {job_id} could not be transferred to DLQ. "
                        "Original message remains unacknowledged."
                    )

            elif outcome_saved is True:
                acknowledge_job(claim)
                print(f"Job {job_id} acknowledged.")

            else:
                print(
                    f"Job {job_id} was not acknowledged; "
                    "it may be recovered after becoming idle."
                )

        except redis.RedisError as error:
            print(f"Redis connection error: {error}")
            print("Stopping worker. Check Redis and restart.")
            break

        except Exception as error:
            print(f"Unexpected worker error: {error}")
            time.sleep(1)


if __name__ == "__main__":
    run_worker()
