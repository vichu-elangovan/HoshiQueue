import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REDIS_URL = "redis://localhost:6379/0"


def redis_client_settings(redis_url=None):
    """Create app.queue.redis_client in a fresh interpreter and report its settings.

    A subprocess keeps each case independent of modules already imported by
    other tests. Creating the client does not connect, so no Redis is needed.
    """
    env = {key: value for key, value in os.environ.items() if key != "REDIS_URL"}
    if redis_url is not None:
        env["REDIS_URL"] = redis_url

    code = (
        "import json; from app.queue import redis_client as c; "
        "print(json.dumps(c.connection_pool.connection_kwargs, default=str))"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def read_env_example():
    values = {}
    for line in (ROOT / ".env.example").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            key, _, value = line.partition("=")
            values[key] = value
    return values


# ---------- REDIS_URL ----------

def test_redis_defaults_to_local_redis_when_redis_url_is_unset():
    settings = redis_client_settings()

    assert (settings["host"], settings["port"], settings["db"]) == ("localhost", 6379, 0)
    assert settings["decode_responses"] is True


def test_redis_url_environment_variable_overrides_the_default():
    settings = redis_client_settings("redis://redis.example.test:6380/3")

    assert (settings["host"], settings["port"], settings["db"]) == (
        "redis.example.test",
        6380,
        3,
    )
    assert settings["decode_responses"] is True  # the other client options are kept


def test_blank_redis_url_falls_back_to_the_default():
    settings = redis_client_settings("")

    assert (settings["host"], settings["port"], settings["db"]) == ("localhost", 6379, 0)


# ---------- Docker Compose ----------

def test_docker_services_publish_their_ports_on_localhost_only():
    compose = (ROOT / "docker-compose.yml").read_text()

    mappings = re.findall(r'^\s*-\s*"([^"]*\d+:\d+)"\s*$', compose, re.MULTILINE)

    assert sorted(mapping.rsplit(":", 2)[-2:] for mapping in mappings) == [
        ["5432", "5432"],
        ["6379", "6379"],
    ]
    for mapping in mappings:
        assert mapping.startswith("127.0.0.1:"), f"{mapping} is exposed beyond localhost"


# ---------- .env.example ----------

def test_env_example_documents_only_the_variables_the_app_reads():
    assert set(read_env_example()) == {"DATABASE_URL", "REDIS_URL"}


def test_env_example_contains_placeholders_not_credentials():
    text = (ROOT / ".env.example").read_text()
    values = read_env_example()

    assert "YOUR_DB_USER" in values["DATABASE_URL"]
    assert "YOUR_DB_PASSWORD" in values["DATABASE_URL"]
    assert "taskforge" not in text.lower()  # the development credentials
    assert values["REDIS_URL"] == DEFAULT_REDIS_URL


def test_gitignore_keeps_real_env_files_out_of_git():
    patterns = {line.strip() for line in (ROOT / ".gitignore").read_text().splitlines()}

    assert ".env" in patterns


# ---------- .gitattributes ----------

def test_gitattributes_normalises_text_line_endings():
    lines = {line.strip() for line in (ROOT / ".gitattributes").read_text().splitlines()}

    assert "* text=auto" in lines
