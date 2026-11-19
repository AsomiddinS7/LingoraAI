"""Small window to create (or promote) the Lingora admin in the configured database.
Admins are created only from this machine-side script, never from the web UI (section 7).
Usage: pythonw -m scripts.create_admin_gui
"""
import tkinter as tk
from tkinter import messagebox

from sqlalchemy import select

from app.db import SessionLocal
from app.models import AuditLog, User
from app.security import hash_password, password_problem


def create_or_promote(email: str, name: str, password: str) -> str:
    email = email.strip().lower()
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.email == email)).scalars().first()
        if user:
            user.role = "admin"
            action = "admin.promote"
        else:
            user = User(email=email, password_hash=hash_password(password), display_name=name.strip()[:40], language="uz", role="admin")
            db.add(user)
            action = "admin.create"
        db.flush()
        db.add(AuditLog(actor_id=None, action=action, target_type="user", target_id=str(user.id), meta={"via": "cli"}))
        db.commit()
    return action


def main() -> None:
    root = tk.Tk()
    root.title("Lingora - Admin")
    root.attributes("-topmost", True)
    root.geometry("440x330")
    font = ("Segoe UI", 11)
    fields = {}
    for key, label, show in (
        ("email", "Email / Pochta", None),
        ("name", "Ism / Name", None),
        ("pw", "Admin paroli / Password (10+)", "*"),
        ("pw2", "Parolni takrorlang / Repeat", "*"),
    ):
        tk.Label(root, text=label, font=font, anchor="w").pack(fill="x", padx=20, pady=(10, 0))
        e = tk.Entry(root, show=show or "", font=("Segoe UI", 12))
        e.pack(fill="x", padx=20)
        fields[key] = e
    fields["email"].focus_force()

    def ok(_=None):
        email, name, pw, pw2 = (fields[k].get() for k in ("email", "name", "pw", "pw2"))
        if "@" not in email or not name.strip():
            return messagebox.showwarning("Lingora", "Pochta va ismni kiriting / Enter email and name")
        if pw != pw2:
            return messagebox.showwarning("Lingora", "Parollar mos emas / Passwords do not match")
        problem = password_problem(pw, email)
        if problem:
            return messagebox.showwarning("Lingora", problem)
        try:
            action = create_or_promote(email, name, pw)
        except Exception as ex:  # show the reason, never the password
            return messagebox.showerror("Lingora", f"Xato / Error: {type(ex).__name__}")
        messagebox.showinfo("Lingora", ("Admin yaratildi / Admin created" if action == "admin.create" else "Admin huquqi berildi / Promoted to admin") + f"\n{email.strip().lower()}")
        root.destroy()

    root.bind("<Return>", ok)
    tk.Button(root, text="Yaratish / Create", command=ok, font=font, width=18).pack(pady=16)
    root.mainloop()


if __name__ == "__main__":
    main()
