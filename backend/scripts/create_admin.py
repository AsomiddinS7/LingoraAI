"""Create (or promote) an admin. Admins are created only from this command line script, never from the UI.

Usage:
    python -m scripts.create_admin --email admin@example.org --name "Admin"
The password is read from LINGORA_ADMIN_PASSWORD or asked interactively (never passed as an argument).
"""
import argparse
import getpass
import os
import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.models import AuditLog, User
from app.security import hash_password, password_problem


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--email", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--language", default="uz", choices=["uz", "ru", "en"])
    a = p.parse_args()
    email = a.email.strip().lower()
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.email == email)).scalars().first()
        if user:
            user.role = "admin"
            action = "admin.promote"
        else:
            pw = os.environ.get("LINGORA_ADMIN_PASSWORD") or getpass.getpass("Admin password: ")
            problem = password_problem(pw, email)
            if problem:
                print(f"error: {problem}", file=sys.stderr)
                return 1
            user = User(email=email, password_hash=hash_password(pw), display_name=a.name[:40], language=a.language, role="admin")
            db.add(user)
            action = "admin.create"
        db.flush()
        db.add(AuditLog(actor_id=None, action=action, target_type="user", target_id=str(user.id), meta={"via": "cli"}))
        db.commit()
        print(f"{action}: {email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
