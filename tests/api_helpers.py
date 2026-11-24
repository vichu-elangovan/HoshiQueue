from app.models import Job


def add_jobs(session_factory, *specs):
    """specs: dicts of Job column values. Returns the new ids in order."""
    db = session_factory()
    try:
        jobs = [Job(**spec) for spec in specs]
        db.add_all(jobs)
        db.commit()
        return [job.id for job in jobs]
    finally:
        db.close()
