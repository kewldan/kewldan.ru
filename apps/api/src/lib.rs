//! Portfolio API: site content, the live pixel board and the Watched list.

pub mod config;
pub mod content;
pub mod pixels;
pub mod watched;

use std::{
    net::{IpAddr, SocketAddr},
    sync::{Arc, RwLock},
};

use axum::{
    Json, Router,
    extract::{ConnectInfo, FromRequestParts, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header, request::Parts},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use serde_json::json;
use tower_http::{compression::CompressionLayer, trace::TraceLayer};

pub use config::Config;
use content::Snapshot;
use pixels::Hub;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub content: Arc<RwLock<Arc<Snapshot>>>,
    pub hub: Arc<Hub>,
    pub watched: Arc<watched::Store>,
}

impl AppState {
    pub async fn new(config: Config) -> anyhow::Result<Self> {
        let content = Snapshot::load(config.content_path.as_deref()).await?;
        let hub = Hub::start(config.valkey_url.as_deref(), &config.valkey_namespace).await?;
        let watched =
            watched::Store::open(config.valkey_url.as_deref(), &config.valkey_namespace).await?;
        Ok(Self {
            config: Arc::new(config),
            content: Arc::new(RwLock::new(Arc::new(content))),
            hub,
            watched: Arc::new(watched),
        })
    }
}

pub fn router(state: AppState) -> Router {
    let admin = Router::new()
        // Lets the site check a pasted token before showing the editor.
        .route("/check", get(|| async { StatusCode::NO_CONTENT }))
        .route("/content/reload", post(reload_content))
        .route("/watched", post(watched::create))
        .route(
            "/watched/{id}",
            put(watched::update).delete(watched::delete),
        )
        .route("/pixels/clear", post(pixels::clear))
        .route("/pixels/reset", post(pixels::reset))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_admin));

    let api = Router::new()
        .route("/health", get(health))
        .route("/content", get(get_content))
        .route("/pixels", get(pixels::board))
        .route("/pixels/ws", get(pixels::ws))
        .route("/watched", get(watched::list))
        .nest("/admin", admin);

    Router::new()
        .nest("/api", api)
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn health(State(app): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "board": app.hub.backend_name() }))
}

/// `GET /api/content`, with ETag revalidation.
async fn get_content(State(app): State<AppState>, headers: HeaderMap) -> Response {
    let snapshot = Arc::clone(&app.content.read().unwrap());
    let etag = HeaderValue::from_str(&snapshot.etag).expect("etag is ascii");
    let cache = HeaderValue::from_static("public, max-age=60, stale-while-revalidate=600");
    if headers.get(header::IF_NONE_MATCH) == Some(&etag) {
        return (
            StatusCode::NOT_MODIFIED,
            [(header::ETAG, etag), (header::CACHE_CONTROL, cache)],
        )
            .into_response();
    }
    (
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            ),
            (header::ETAG, etag),
            (header::CACHE_CONTROL, cache),
        ],
        snapshot.json.to_string(),
    )
        .into_response()
}

/// `POST /api/admin/content/reload`: re-reads `CONTENT_PATH`; a broken file
/// is rejected and the current content stays live.
async fn reload_content(State(app): State<AppState>) -> Response {
    match Snapshot::load(app.config.content_path.as_deref()).await {
        Ok(next) => {
            let etag = next.etag.clone();
            *app.content.write().unwrap() = Arc::new(next);
            tracing::info!(%etag, "content reloaded");
            Json(json!({ "etag": etag })).into_response()
        }
        Err(err) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "error": format!("{err:#}") })),
        )
            .into_response(),
    }
}

async fn require_admin(State(app): State<AppState>, req: Request, next: Next) -> Response {
    let Some(token) = app.config.admin_token.as_deref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let given = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    match given {
        Some(given) if constant_time_eq(given.as_bytes(), token.as_bytes()) => next.run(req).await,
        _ => StatusCode::UNAUTHORIZED.into_response(),
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The caller's IP: the socket peer, or the first `X-Forwarded-For` hop when
/// `TRUST_PROXY` is set.
pub struct ClientIp(pub IpAddr);

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut Parts,
        app: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if app.config.trust_proxy {
            let forwarded = parts
                .headers
                .get("x-forwarded-for")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.split(',').next())
                .and_then(|v| v.trim().parse().ok());
            if let Some(ip) = forwarded {
                return Ok(Self(ip));
            }
        }
        parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ConnectInfo(addr)| Self(addr.ip()))
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)
    }
}
