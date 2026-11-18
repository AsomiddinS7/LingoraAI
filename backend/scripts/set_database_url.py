"""Writes LINGORA_DATABASE_URL into backend/.env from the Supabase "Session pooler" URI.

The password is typed hidden (getpass), URL-encoded (so $ ? , @ are safe) and written only to
the git-ignored .env file. It is never printed.

Usage:  python -m scripts.set_database_url
"""
import getpass
import re
import sys
from pathlib import Path
from urllib.parse import quote

ENV = Path(__file__).resolve().parents[1] / ".env"


def main() -> int:
    if len(sys.argv) > 1:
        uri = sys.argv[1].strip()
    else:
        print("Supabase -> Connect -> Session pooler -> copy the URI and paste it here.")
        uri = input("Supabase URI: ").strip()
    m = re.match(r"^postgres(?:ql)?(?:\+psycopg)?://([^:@/]+)(?::[^@]*)?@([^/?]+)/([^?]+)", uri)
    if not m or "supabase" not in m.group(2):
        print("That does not look like a Supabase connection URI (postgresql://postgres.xxx:...@...supabase.com:5432/postgres).")
        return 1
    user, host, db = m.groups()
    pw = getpass.getpass("Database password (hidden while you type): ")
    if not pw:
        print("No password entered.")
        return 1
    url = f"postgresql+psycopg://{user}:{quote(pw, safe='')}@{host}/{db}?sslmode=require"

    lines = ENV.read_text(encoding="utf-8").splitlines() if ENV.exists() else []
    out, done = [], False
    for line in lines:
        if line.startswith("LINGORA_DATABASE_URL="):
            out.append(f"LINGORA_DATABASE_URL={url}")
            done = True
        else:
            out.append(line)
    if not done:
        out.append(f"LINGORA_DATABASE_URL={url}")
    ENV.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"Saved to {ENV} (user {user}, host {host}). The password was not printed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
