
import pytest

from worker.tasks import execute_task


def test_send_email_executes_successfully(capsys):
    execute_task("send_email")

    captured = capsys.readouterr()

    assert "Simulating email delivery..." in captured.out
    assert "Email task executed successfully." in captured.out


def test_slow_test_executes_successfully(monkeypatch, capsys):
    # Avoid waiting 90 seconds during an automated test.
    monkeypatch.setattr("worker.tasks.time.sleep", lambda seconds: None)

    execute_task("slow_test")

    captured = capsys.readouterr()

    assert "Slow test started..." in captured.out
    assert "Slow test finished." in captured.out


def test_unknown_task_raises_value_error():
    with pytest.raises(ValueError, match="Unknown task: unknown_task"):
        execute_task("unknown_task")
