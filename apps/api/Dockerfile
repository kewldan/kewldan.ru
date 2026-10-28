# syntax=docker/dockerfile:1.7
# Build context: apps/api

FROM rust:1-slim-bookworm AS build
# webauthn-rs verifies passkeys with OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked \
    && cp target/release/portfolio-api /portfolio-api \
    && mkdir /runtime-libs \
    && cp -L /usr/lib/*-linux-gnu/libssl.so.3 /usr/lib/*-linux-gnu/libcrypto.so.3 /runtime-libs/

# "cc" has libgcc_s for Rust; OpenSSL for webauthn-rs comes from the build stage.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /runtime-libs/ /usr/lib/
COPY --from=build /portfolio-api /portfolio-api
# A copy of the content for CONTENT_PATH; the binary also embeds it.
COPY content /content
ENV ADDR=0.0.0.0:8080
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s CMD ["/portfolio-api", "healthcheck"]
ENTRYPOINT ["/portfolio-api"]
