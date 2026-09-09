"""Run real Alembic migrations on disposable SQLite files, never configured data."""

import os
import sqlite3
import subprocess
import sys
from uuid import uuid4

import pytest


@pytest.mark.parametrize("existing", [False, True])
def test_upgrade_and_model_consistency(tmp_path, existing):
    database = tmp_path / "migration.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{database.as_posix()}"}

    def alembic(*args):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", *args],
            env=env,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stdout + result.stderr

    uid, cid, mid = (uuid4().hex for _ in range(3))
    if existing:
        alembic("upgrade", "20260906_0001")
        with sqlite3.connect(database) as connection:
            connection.execute(
                "INSERT INTO users (id,email,password_hash,is_active,created_at,updated_at) VALUES (?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
                (uid, "migration@example.com", "test-only"),
            )
            connection.execute(
                "INSERT INTO conversations (id,user_id,mode,title,created_at,updated_at) VALUES (?,?,'chat','existing',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
                (cid, uid),
            )
            connection.execute(
                "INSERT INTO messages (id,conversation_id,sequence_no,role,content,status,source,created_at,updated_at) VALUES (?,?,1,'user','preserved','complete','server',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
                (mid, cid),
            )
    alembic("upgrade", "head")
    alembic("check")
    if existing:
        with sqlite3.connect(database) as connection:
            assert connection.execute(
                "SELECT title,import_request_id,import_fingerprint FROM conversations WHERE id=?",
                (cid,),
            ).fetchone() == ("existing", None, None)
            assert connection.execute(
                "SELECT content FROM messages WHERE id=?", (mid,)
            ).fetchone() == ("preserved",)
