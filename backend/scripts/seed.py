"""Seed sample data: the candidate signs, the phrasebook and placeholder consent texts.
Idempotent. Usage: python -m scripts.seed

Signs and phrases come from the same seed files the front end's mock server uses
(src/api/seed/*.json), so dev, mock mode and the database agree.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import ConsentText, Phrase, Sign

SEED = Path(__file__).resolve().parents[2] / "src" / "api" / "seed"

# [PLACEHOLDER] consent texts. Legal text must be reviewed by a qualified person (section 7).
CONSENTS = {
    "account": {
        "en": "[PLACEHOLDER] I agree that Lingora stores my email, display name and language to run my account. I can download or delete my data at any time.",
        "ru": "[PLACEHOLDER] Я согласен, что Lingora хранит мою почту, отображаемое имя и язык для работы учётной записи. Я могу скачать или удалить свои данные в любое время.",
        "uz": "[PLACEHOLDER] Lingora hisobimni yuritish uchun pochtam, ismim va tilimni saqlashiga roziman. Maʼlumotlarimni istalgan vaqtda yuklab olishim yoki oʻchirishim mumkin.",
    },
    "contribute_data": {
        "en": "[PLACEHOLDER] I agree to share recorded clips of hand and upper-body points (no video, face or audio) to train Lingora. If I withdraw, my clips are deleted, except clips already used to train an activated model; those are kept and flagged.",
        "ru": "[PLACEHOLDER] Я согласен передавать записанные клипы точек рук и верхней части тела (без видео, лица и звука) для обучения Lingora. Если я отзову согласие, мои клипы удаляются, кроме клипов, уже использованных для обучения активной модели; они сохраняются и помечаются.",
        "uz": "[PLACEHOLDER] Lingorani oʻqitish uchun qoʻl va tananing yuqori qismi nuqtalari yozilgan kliplarni (video, yuz va ovozsiz) berishga roziman. Rozilikni qaytarib olsam, kliplarim oʻchiriladi, faol modelni oʻqitishda allaqachon ishlatilganlari bundan mustasno; ular saqlanadi va belgilanadi.",
    },
    "voice": {
        "en": "[PLACEHOLDER] I agree that my speech is turned into text on screen. It is not stored.",
        "ru": "[PLACEHOLDER] Я согласен, что моя речь превращается в текст на экране. Она не сохраняется.",
        "uz": "[PLACEHOLDER] Nutqim ekranda matnga aylantirilishiga roziman. U saqlanmaydi.",
    },
}


def seed(db: Session) -> dict:
    counts = {"signs": 0, "phrases": 0, "consent_texts": 0}
    for row in json.loads((SEED / "signs.json").read_text(encoding="utf-8"))["items"]:
        if not db.execute(select(Sign.id).where(Sign.slug == row["slug"])).first():
            db.add(Sign(slug=row["slug"], labels=row["labels"], scenario=row["scenario"], status=row["status"], sort_order=row["sort_order"]))
            counts["signs"] += 1
    for i, row in enumerate(json.loads((SEED / "phrases.json").read_text(encoding="utf-8"))["items"]):
        if not db.execute(select(Phrase.id).where(Phrase.slug == row["slug"])).first():
            db.add(Phrase(slug=row["slug"], texts=row["texts"], sort_order=i))
            counts["phrases"] += 1
    now = datetime.now(timezone.utc)
    for ctype, texts in CONSENTS.items():
        for lang, body in texts.items():
            exists = db.execute(select(ConsentText.id).where(ConsentText.type == ctype, ConsentText.language == lang, ConsentText.version == 1)).first()
            if not exists:
                db.add(ConsentText(type=ctype, version=1, language=lang, body=body, published_at=now))
                counts["consent_texts"] += 1
    db.flush()
    return counts


if __name__ == "__main__":
    with SessionLocal() as s:
        print(seed(s))
        s.commit()
