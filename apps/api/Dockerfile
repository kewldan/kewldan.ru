# syntax=docker/dockerfile:1.7
# Build context: apps/api

FROM rust:1-slim-bookworm AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked \
    && cp target/release/portfolio-api /portfolio-api

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /portfolio-api /portfolio-api
# A copy of the content for CONTENT_PATH; the binary also embeds it.
COPY content /content
ENV ADDR=0.0.0.0:8080
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s CMD ["/portfolio-api", "healthcheck"]
ENTRYPOINT ["/portfolio-api"]
