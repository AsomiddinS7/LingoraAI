"""Small window to enter the Supabase database password (shown as *), saved URL-encoded into
the git-ignored backend/.env. Usage: pythonw -m scripts.set_password_gui <supabase-uri-without-password>"""
import re
import sys
import tkinter as tk
from pathlib import Path
from tkinter import messagebox
from urllib.parse import quote

ENV = Path(__file__).resolve().parents[1] / ".env"


def save(uri: str, pw: str) -> str:
    m = re.match(r"^postgres(?:ql)?(?:\+psycopg)?://([^:@/]+)(?::[^@]*)?@([^/?]+)/([^?]+)", uri)
    if not m:
        raise ValueError("bad URI")
    user, host, db = m.groups()
    url = f"postgresql+psycopg://{user}:{quote(pw.strip(), safe='')}@{host}/{db}?sslmode=require"
    lines = ENV.read_text(encoding="utf-8").splitlines()
    lines = [f"LINGORA_DATABASE_URL={url}" if l.startswith("LINGORA_DATABASE_URL=") else l for l in lines]
    ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return host


def main() -> None:
    uri = sys.argv[1]
    root = tk.Tk()
    root.title("Lingora - Supabase")
    root.attributes("-topmost", True)
    root.geometry("460x170")
    tk.Label(root, text="Supabase database password\n(Ctrl+V bilan joylashtiring / paste with Ctrl+V):", font=("Segoe UI", 11)).pack(pady=(14, 6))
    entry = tk.Entry(root, show="*", width=40, font=("Segoe UI", 12))
    entry.pack()
    entry.focus_force()

    def ok(_=None):
        pw = entry.get()
        if not pw.strip():
            messagebox.showwarning("Lingora", "Parol bo'sh / Password is empty")
            return
        host = save(uri, pw)
        messagebox.showinfo("Lingora", f"Saqlandi / Saved\n{host}")
        root.destroy()

    entry.bind("<Return>", ok)
    tk.Button(root, text="Saqlash / Save", command=ok, font=("Segoe UI", 11), width=16).pack(pady=12)
    root.mainloop()


if __name__ == "__main__":
    main()
