# Lingora: one container serving the site and the API on the same origin (session cookies).
# ---- 1. build the front end (mocks off: it talks to this API) ----
FROM node:22-slim AS web
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src
ENV VITE_MOCK_AZURE=false VITE_RECOGNIZER=static
RUN npm run build

# ---- 2. API + static site ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/ ./
COPY src/api/seed /src/api/seed
COPY --from=web /web/dist /app/static
ENV LINGORA_STATIC_DIR=/app/static LINGORA_ENV=production LINGORA_COOKIE_SECURE=true \
    LINGORA_EXTRA_ORIGINS=https://asomiddins7.github.io
RUN useradd --create-home lingora && chown -R lingora /app
USER lingora
EXPOSE 8000
# Migrations run on deploy (spec section 12); the seed is idempotent.
CMD ["sh", "-c", "alembic upgrade head && python -m scripts.seed && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
