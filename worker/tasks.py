
import time


def send_email():
    """Simulate sending an email."""
    print("Simulating email delivery...")
    print("Email task executed successfully.")


def slow_test():
    """Simulate a long-running task for recovery testing."""
    print("Slow test started...")
    time.sleep(90)
    print("Slow test finished.")


TASKS = {
    "send_email": send_email,
    "slow_test": slow_test,
}


def execute_task(task_name: str):
    task = TASKS.get(task_name)

    if task is None:
        raise ValueError(f"Unknown task: {task_name}")

    task()
