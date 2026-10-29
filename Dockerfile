# Linux build/test environment; gitowl runs natively for host drive access.
FROM node:26-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run lint && npm run build

FROM rust:1.99.1-slim-bookworm AS check
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY build.rs ./
COPY src/ ./src/
COPY --from=frontend /app/frontend/dist ./frontend/dist/
RUN cargo test --locked --no-default-features
CMD ["cargo", "test", "--locked", "--no-default-features"]
