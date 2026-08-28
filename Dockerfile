# Build stage
FROM python:3.11-slim AS builder

WORKDIR /app

COPY src/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/

# Runtime stage
FROM python:3.11-slim

WORKDIR /app

COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /app/src ./src

COPY .env.example .env

EXPOSE 8000

CMD ["python", "-m", "src.backend.main"]
