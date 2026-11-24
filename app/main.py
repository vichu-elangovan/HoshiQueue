
import redis
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from pydantic import BaseModel, Field
from datetime import datetime, timedelta, timezone

from app.database import SessionLocal, engine
from app.models import Job
from app.queue import enqueue_job, redis_client
from zoneinfo import ZoneInfo

# jobs.id is a PostgreSQL INTEGER. Larger values can never match a row and make
# the database raise an error, so they are rejected as invalid input (HTTP 422).
MAX_JOB_ID = 2_147_483_647


app = FastAPI(
    title="HoshiQueue",
    description="A distributed background job queue.",
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class JobCreate(BaseModel):
    task_name: str = Field(min_length=1, max_length=100)


@app.get("/health")
def health_check():
    health = {
        "fastapi": "healthy",
        "postgresql": "unknown",
        "redis": "unknown",
    }

    # Check PostgreSQL
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        health["postgresql"] = "healthy"

    except Exception:
        health["postgresql"] = "unhealthy"

    # Check Redis
    try:
        redis_client.ping()
        health["redis"] = "healthy"

    except redis.RedisError:
        health["redis"] = "unhealthy"

    overall_status = (
        "healthy"
        if all(status == "healthy" for status in health.values())
        else "degraded"
    )

    return {
        "status": overall_status,
        "service": "hoshi-queue",
        "components": health,
    }


@app.post("/jobs", status_code=201)
def create_job(
    job_data: JobCreate,
    db: Session = Depends(get_db),
):
    # Create a new job in PostgreSQL
    job = Job(task_name=job_data.task_name)

    db.add(job)
    db.commit()
    db.refresh(job)

    # Add the job ID to the Redis queue
    try:
        enqueue_job(job.id)
    except redis.RedisError:
        raise HTTPException(
            status_code=503,
            detail=f"Job {job.id} was saved but could not be queued.",
        )

    # Return the created job details
    return {
        "id": job.id,
        "task_name": job.task_name,
        "status": job.status,
        "attempts": job.attempts,
        "created_at": job.created_at,
    }

@app.get("/jobs")
def list_jobs(
    status: str | None = Query(
        default=None,
        pattern="^(queued|processing|completed|failed|cancelled)$",
    ),
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    query = db.query(Job)

    if status is not None:
        query = query.filter(Job.status == status)

    # Case-insensitive "contains" search on the task name. %, _ and \ are
    # escaped so they match literally instead of acting as LIKE wildcards.
    if q is not None and q.strip():
        term = (
            q.strip()
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        query = query.filter(Job.task_name.ilike(f"%{term}%", escape="\\"))

    total = query.count()

    jobs = (
        query
        .order_by(Job.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "jobs": [
            {
                "id": job.id,
                "task_name": job.task_name,
                "status": job.status,
                "attempts": job.attempts,
                "max_attempts": job.max_attempts,
                "failure_reason": job.failure_reason,
                "created_at": job.created_at,
            }
            for job in jobs
        ],
    }
@app.get("/jobs/{job_id}")
def get_job(
    job_id: int = Path(le=MAX_JOB_ID),
    db: Session = Depends(get_db),
):
    # Find the job in PostgreSQL
    job = db.get(Job, job_id)

    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Job not found",
        )

    return {
        "id": job.id,
        "task_name": job.task_name,
        "status": job.status,
        "attempts": job.attempts,
        "max_attempts": job.max_attempts,
        "failure_reason": job.failure_reason,
        "created_at": job.created_at,
    }
@app.post("/jobs/{job_id}/cancel")
def cancel_job(
    job_id: int = Path(le=MAX_JOB_ID),
    db: Session = Depends(get_db),
):
    job = (
        db.query(Job)
        .filter(Job.id == job_id)
        .with_for_update()
        .first()
    )

    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Job not found",
        )

    if job.status == "cancelled":
        return {
            "message": "Job is already cancelled.",
            "job_id": job.id,
            "status": job.status,
        }

    if job.status != "queued":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot cancel a job with status '{job.status}'.",
        )

    job.status = "cancelled"
    db.commit()
    db.refresh(job)

    return {
        "message": "Job cancelled successfully.",
        "job_id": job.id,
        "status": job.status,
    }
@app.post("/jobs/{job_id}/retry")
def retry_job(
    job_id: int = Path(le=MAX_JOB_ID),
    db: Session = Depends(get_db),
):
    job = (
        db.query(Job)
        .filter(Job.id == job_id)
        .with_for_update()
        .first()
    )

    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Job not found",
        )

    if job.status != "failed":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot retry a job with status '{job.status}'.",
        )

    job.status = "queued"
    job.attempts = 0
    job.failure_reason = None

    db.commit()
    db.refresh(job)

    try:
        enqueue_job(job.id)
        message = "Job queued for retry successfully."

    except redis.RedisError as error:
        print(
            f"Redis unavailable for job {job.id}: {error}. "
            "Reconciler will retry."
        )
        message = (
            "Job saved for retry. It will be enqueued "
            "when Redis becomes available."
        )

    return {
        "message": message,
        "job_id": job.id,
        "task_name": job.task_name,
        "status": job.status,
        "attempts": job.attempts,
    }
@app.get("/dashboard/stats")
def get_dashboard_stats(
    db: Session = Depends(get_db),
):
    total_jobs = db.query(func.count(Job.id)).scalar() or 0

    queued = db.query(func.count(Job.id)).filter(
        Job.status == "queued"
    ).scalar() or 0

    processing = db.query(func.count(Job.id)).filter(
        Job.status == "processing"
    ).scalar() or 0

    completed = db.query(func.count(Job.id)).filter(
        Job.status == "completed"
    ).scalar() or 0

    failed = db.query(func.count(Job.id)).filter(
        Job.status == "failed"
    ).scalar() or 0

    # Success rate = completed / (completed + failed) * 100. Queued, processing
    # and cancelled jobs have not finished (or never will), so they are left out.
    # It is None (JSON null) until at least one job has finished.
    finished = completed + failed
    success_rate = (
        round((completed / finished) * 100, 2)
        if finished > 0
        else None
    )

    return {
        "total_jobs": total_jobs,
        "queued": queued,
        "processing": processing,
        "completed": completed,
        "failed": failed,
        "success_rate": success_rate,
    }


@app.get("/analytics/throughput")
def get_throughput(
    period: str = "last_60_minutes",
    db: Session = Depends(get_db),
):
    india_tz = ZoneInfo("Asia/Kolkata")
    now = datetime.now(timezone.utc).astimezone(india_tz)

    configurations = {
        "last_60_minutes": {
            "unit": "minute",
            "count": 60,
            "delta": timedelta(minutes=59),
            "format": "%Y-%m-%d %H:%M",
            "label": "%H:%M",
        },
        "last_24_hours": {
            "unit": "hour",
            "count": 24,
            "delta": timedelta(hours=23),
            "format": "%Y-%m-%d %H",
            "label": "%H:00",
        },
        "last_7_days": {
            "unit": "day",
            "count": 7,
            "delta": timedelta(days=6),
            "format": "%Y-%m-%d",
            "label": "%d %b",
        },
    }

    if period not in configurations:
        raise HTTPException(
            status_code=400,
            detail="Invalid period. Choose last_60_minutes, last_24_hours, or last_7_days.",
        )

    config = configurations[period]
    unit = config["unit"]

    if unit == "minute":
        current_bucket = now.replace(second=0, microsecond=0)
    elif unit == "hour":
        current_bucket = now.replace(
            minute=0, second=0, microsecond=0
        )
    else:
        current_bucket = now.replace(
            hour=0, minute=0, second=0, microsecond=0
        )

    start_bucket = current_bucket - config["delta"]

    start_utc = start_bucket.astimezone(timezone.utc)

    results = db.execute(
        text(f"""
            SELECT
                date_trunc(
                    '{unit}',
                    created_at AT TIME ZONE 'Asia/Kolkata'
                ) AS bucket,
                COUNT(id) AS jobs
            FROM jobs
            WHERE created_at >= :start_time
            GROUP BY 1
            ORDER BY 1
        """),
        {"start_time": start_utc},
    ).all()

    job_counts = {
        bucket.strftime(config["format"]): count
        for bucket, count in results
    }

    throughput = []

    for i in range(config["count"]):
        bucket = start_bucket + (
            timedelta(minutes=i)
            if unit == "minute"
            else timedelta(hours=i)
            if unit == "hour"
            else timedelta(days=i)
        )

        key = bucket.strftime(config["format"])

        throughput.append({
            "time": bucket.strftime(config["label"]),
            "jobs": job_counts.get(key, 0),
        })

    return {
        "period": period,
        "total": sum(item["jobs"] for item in throughput),
        "data": throughput,
    }
