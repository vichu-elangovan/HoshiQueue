from app.database import SessionLocal
from app.models import Job
from app.queue import enqueue_job, is_job_enqueued


def reconcile_queued_jobs(batch_size: int = 100) -> int:
    """
    Find queued jobs missing from Redis and enqueue them again.
    Returns the number of jobs successfully re-enqueued.
    """
    db = SessionLocal()
    recovered_count = 0

    try:
        jobs = (
            db.query(Job)
            .filter(Job.status == "queued")
            .order_by(Job.id)
            .limit(batch_size)
            .all()
        )

        for job in jobs:
            if not is_job_enqueued(job.id):
                try:
                    enqueue_job(job.id)
                    recovered_count += 1
                    print(f"Reconciled job {job.id} into Redis.")
                except Exception as error:
                    print(
                        f"Could not reconcile job {job.id}: {error}"
                    )

        return recovered_count

    finally:
        db.close()