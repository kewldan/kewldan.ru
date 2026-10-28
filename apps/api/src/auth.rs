//! Admin sign-in with passkeys (WebAuthn).
//!
//! There is one admin. The first passkey is added while signed in with
//! `ADMIN_TOKEN`; after that the passkey is enough. A successful sign-in sets
//! an HttpOnly session cookie that the admin routes accept in place of the
//! token. Passkeys and sessions live in Valkey (in memory without it); the
//! short-lived ceremony state stays in this process.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use anyhow::Context;
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use redis::{AsyncCommands, aio::ConnectionManager};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;
use webauthn_rs::prelude::{
    CreationChallengeResponse, Passkey, PasskeyAuthentication, PasskeyRegistration,
    PublicKeyCredential, RegisterPublicKeyCredential, RequestChallengeResponse, Url, Webauthn,
    WebauthnBuilder,
};

use crate::AppState;

const COOKIE: &str = "kd_admin";
const SESSION_TTL: Duration = Duration::from_secs(30 * 24 * 3600);
const CEREMONY_TTL: Duration = Duration::from_secs(5 * 60);
const MAX_PENDING: usize = 64;
/// The one admin's WebAuthn user handle; stable so every passkey belongs to them.
const ADMIN_USER: Uuid = Uuid::from_u128(0x6b65_776c_6461_6e2d_6164_6d69_6e00_0001);

/// A registered passkey plus what the admin page shows about it.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Stored {
    name: String,
    created_at: u64,
    passkey: Passkey,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyInfo {
    id: String,
    name: String,
    created_at: u64,
}

enum Backend {
    Memory {
        passkeys: Mutex<HashMap<String, Stored>>,
        sessions: Mutex<HashMap<String, Instant>>,
    },
    Valkey {
        conn: ConnectionManager,
        ns: String,
    },
}

pub struct Auth {
    webauthn: Webauthn,
    backend: Backend,
    secure_cookie: bool,
    registering: Mutex<HashMap<String, (PasskeyRegistration, Instant)>>,
    signing_in: Mutex<HashMap<String, (PasskeyAuthentication, Instant)>>,
}

impl Auth {
    /// `origin` is where the site is served (`https://kewldan.ru`); its host
    /// is the relying-party id passkeys are bound to.
    pub async fn open(origin: &str, valkey_url: Option<&str>, ns: &str) -> anyhow::Result<Self> {
        let origin = Url::parse(origin).context("WEBAUTHN_ORIGIN must be a URL")?;
        let rp_id = origin
            .host_str()
            .context("WEBAUTHN_ORIGIN needs a host")?
            .to_owned();
        let webauthn = WebauthnBuilder::new(&rp_id, &origin)?
            .rp_name(&rp_id)
            .build()?;
        let backend = match valkey_url {
            None => Backend::Memory {
                passkeys: Mutex::default(),
                sessions: Mutex::default(),
            },
            Some(url) => Backend::Valkey {
                conn: ConnectionManager::new(redis::Client::open(url)?).await?,
                ns: ns.to_owned(),
            },
        };
        Ok(Self {
            webauthn,
            backend,
            secure_cookie: origin.scheme() == "https",
            registering: Mutex::default(),
            signing_in: Mutex::default(),
        })
    }

    async fn passkeys(&self) -> anyhow::Result<Vec<(String, Stored)>> {
        Ok(match &self.backend {
            Backend::Memory { passkeys, .. } => passkeys
                .lock()
                .unwrap()
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            Backend::Valkey { conn, ns } => {
                let raw: HashMap<String, String> =
                    conn.clone().hgetall(format!("{ns}:passkeys")).await?;
                raw.into_iter()
                    .filter_map(|(k, v)| Some((k, serde_json::from_str(&v).ok()?)))
                    .collect()
            }
        })
    }

    async fn put_passkey(&self, id: &str, stored: &Stored) -> anyhow::Result<()> {
        match &self.backend {
            Backend::Memory { passkeys, .. } => {
                passkeys
                    .lock()
                    .unwrap()
                    .insert(id.to_owned(), stored.clone());
            }
            Backend::Valkey { conn, ns } => {
                let _: () = conn
                    .clone()
                    .hset(format!("{ns}:passkeys"), id, serde_json::to_string(stored)?)
                    .await?;
            }
        }
        Ok(())
    }

    async fn remove_passkey(&self, id: &str) -> anyhow::Result<bool> {
        Ok(match &self.backend {
            Backend::Memory { passkeys, .. } => passkeys.lock().unwrap().remove(id).is_some(),
            Backend::Valkey { conn, ns } => {
                conn.clone()
                    .hdel::<_, _, u32>(format!("{ns}:passkeys"), id)
                    .await?
                    > 0
            }
        })
    }

    /// Issues a session and returns the raw token for the cookie; only its
    /// hash is stored.
    async fn new_session(&self) -> anyhow::Result<String> {
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let key = hash(&token);
        match &self.backend {
            Backend::Memory { sessions, .. } => {
                sessions
                    .lock()
                    .unwrap()
                    .insert(key, Instant::now() + SESSION_TTL);
            }
            Backend::Valkey { conn, ns } => {
                let _: () = conn
                    .clone()
                    .set_ex(format!("{ns}:session:{key}"), 1, SESSION_TTL.as_secs())
                    .await?;
            }
        }
        Ok(token)
    }

    pub async fn session_valid(&self, token: &str) -> bool {
        let key = hash(token);
        match &self.backend {
            Backend::Memory { sessions, .. } => sessions
                .lock()
                .unwrap()
                .get(&key)
                .is_some_and(|until| *until > Instant::now()),
            Backend::Valkey { conn, ns } => conn
                .clone()
                .exists(format!("{ns}:session:{key}"))
                .await
                .unwrap_or(false),
        }
    }

    async fn end_session(&self, token: &str) {
        let key = hash(token);
        match &self.backend {
            Backend::Memory { sessions, .. } => {
                sessions.lock().unwrap().remove(&key);
            }
            Backend::Valkey { conn, ns } => {
                let _: Result<(), _> = conn.clone().del(format!("{ns}:session:{key}")).await;
            }
        }
    }

    fn cookie(&self, value: &str, max_age: u64) -> HeaderValue {
        let secure = if self.secure_cookie { "; Secure" } else { "" };
        HeaderValue::from_str(&format!(
            "{COOKIE}={value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age={max_age}{secure}"
        ))
        .expect("cookie is ascii")
    }
}

fn hash(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Remembers a ceremony for a few minutes under a fresh id.
fn remember<T>(map: &Mutex<HashMap<String, (T, Instant)>>, state: T) -> String {
    let mut map = map.lock().unwrap();
    map.retain(|_, (_, at)| at.elapsed() < CEREMONY_TTL);
    if map.len() >= MAX_PENDING {
        // Someone is spamming starts: drop the oldest rather than grow.
        if let Some(oldest) = map
            .iter()
            .min_by_key(|(_, (_, at))| *at)
            .map(|(k, _)| k.clone())
        {
            map.remove(&oldest);
        }
    }
    let id = Uuid::new_v4().simple().to_string();
    map.insert(id.clone(), (state, Instant::now()));
    id
}

fn take<T>(map: &Mutex<HashMap<String, (T, Instant)>>, id: &str) -> Option<T> {
    map.lock()
        .unwrap()
        .remove(id)
        .filter(|(_, at)| at.elapsed() < CEREMONY_TTL)
        .map(|(s, _)| s)
}

/// The session token from the request's cookie, if any.
pub fn session_cookie(headers: &HeaderMap) -> Option<&str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|c| c.trim().strip_prefix(COOKIE)?.strip_prefix('='))
        .filter(|v| !v.is_empty())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn fail(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({ "error": code }))).into_response()
}

fn internal(err: anyhow::Error) -> Response {
    tracing::error!(error = %format!("{err:#}"), "auth failed");
    fail(StatusCode::INTERNAL_SERVER_ERROR, "save")
}

/// `GET /api/auth/passkey`: whether signing in with a passkey is possible.
pub async fn available(State(app): State<AppState>) -> Response {
    match app.auth.passkeys().await {
        Ok(list) => Json(json!({ "available": !list.is_empty() })).into_response(),
        Err(err) => internal(err),
    }
}

#[derive(Serialize)]
pub struct LoginStart {
    id: String,
    options: RequestChallengeResponse,
}

/// `POST /api/auth/passkey/login/start`
pub async fn login_start(State(app): State<AppState>) -> Response {
    let passkeys: Vec<Passkey> = match app.auth.passkeys().await {
        Ok(list) => list.into_iter().map(|(_, s)| s.passkey).collect(),
        Err(err) => return internal(err),
    };
    if passkeys.is_empty() {
        return fail(StatusCode::NOT_FOUND, "no_passkeys");
    }
    match app.auth.webauthn.start_passkey_authentication(&passkeys) {
        Ok((options, state)) => {
            let id = remember(&app.auth.signing_in, state);
            Json(LoginStart { id, options }).into_response()
        }
        Err(err) => internal(err.into()),
    }
}

#[derive(Deserialize)]
pub struct LoginFinish {
    id: String,
    credential: PublicKeyCredential,
}

/// `POST /api/auth/passkey/login/finish`: verifies the assertion and sets
/// the session cookie.
pub async fn login_finish(State(app): State<AppState>, Json(body): Json<LoginFinish>) -> Response {
    let Some(state) = take(&app.auth.signing_in, &body.id) else {
        return fail(StatusCode::BAD_REQUEST, "expired");
    };
    let result = match app
        .auth
        .webauthn
        .finish_passkey_authentication(&body.credential, &state)
    {
        Ok(r) => r,
        Err(err) => {
            tracing::warn!(%err, "passkey sign-in rejected");
            return fail(StatusCode::UNAUTHORIZED, "passkey");
        }
    };
    // Keep the signature counter and backup flags current.
    if let Ok(list) = app.auth.passkeys().await {
        for (id, mut stored) in list {
            if stored.passkey.update_credential(&result) == Some(true) {
                let _ = app.auth.put_passkey(&id, &stored).await;
            }
        }
    }
    match app.auth.new_session().await {
        Ok(token) => {
            tracing::info!("admin signed in with a passkey");
            (
                StatusCode::NO_CONTENT,
                [(
                    header::SET_COOKIE,
                    app.auth.cookie(&token, SESSION_TTL.as_secs()),
                )],
            )
                .into_response()
        }
        Err(err) => internal(err),
    }
}

/// `POST /api/auth/logout`
pub async fn logout(State(app): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(token) = session_cookie(&headers) {
        app.auth.end_session(token).await;
    }
    (
        StatusCode::NO_CONTENT,
        [(header::SET_COOKIE, app.auth.cookie("", 0))],
    )
        .into_response()
}

#[derive(Serialize)]
pub struct RegisterStart {
    id: String,
    options: CreationChallengeResponse,
}

/// `POST /api/admin/passkeys/register/start`
pub async fn register_start(State(app): State<AppState>) -> Response {
    let existing = match app.auth.passkeys().await {
        Ok(list) => list
            .iter()
            .map(|(_, s)| s.passkey.cred_id().clone())
            .collect(),
        Err(err) => return internal(err),
    };
    match app.auth.webauthn.start_passkey_registration(
        ADMIN_USER,
        "kewldan",
        "Daniel (kewldan)",
        Some(existing),
    ) {
        Ok((options, state)) => {
            let id = remember(&app.auth.registering, state);
            Json(RegisterStart { id, options }).into_response()
        }
        Err(err) => internal(err.into()),
    }
}

#[derive(Deserialize)]
pub struct RegisterFinish {
    id: String,
    credential: RegisterPublicKeyCredential,
    /// "MacBook", "iPhone"... shown in the list of passkeys.
    #[serde(default)]
    name: String,
}

/// `POST /api/admin/passkeys/register/finish`
pub async fn register_finish(
    State(app): State<AppState>,
    Json(body): Json<RegisterFinish>,
) -> Response {
    let Some(state) = take(&app.auth.registering, &body.id) else {
        return fail(StatusCode::BAD_REQUEST, "expired");
    };
    let passkey = match app
        .auth
        .webauthn
        .finish_passkey_registration(&body.credential, &state)
    {
        Ok(p) => p,
        Err(err) => {
            tracing::warn!(%err, "passkey registration rejected");
            return fail(StatusCode::BAD_REQUEST, "passkey");
        }
    };
    let name: String = body.name.trim().chars().take(60).collect();
    let stored = Stored {
        name: if name.is_empty() {
            "Passkey".into()
        } else {
            name
        },
        created_at: now_ms(),
        passkey,
    };
    let id = Uuid::new_v4().simple().to_string();
    match app.auth.put_passkey(&id, &stored).await {
        Ok(()) => {
            tracing::info!(name = %stored.name, "passkey added");
            (
                StatusCode::CREATED,
                Json(PasskeyInfo {
                    id,
                    name: stored.name,
                    created_at: stored.created_at,
                }),
            )
                .into_response()
        }
        Err(err) => internal(err),
    }
}

/// `GET /api/admin/passkeys`
pub async fn list(State(app): State<AppState>) -> Response {
    match app.auth.passkeys().await {
        Ok(list) => {
            let mut out: Vec<PasskeyInfo> = list
                .into_iter()
                .map(|(id, s)| PasskeyInfo {
                    id,
                    name: s.name,
                    created_at: s.created_at,
                })
                .collect();
            out.sort_by_key(|p| p.created_at);
            Json(json!({ "items": out })).into_response()
        }
        Err(err) => internal(err),
    }
}

/// `DELETE /api/admin/passkeys/{id}`
pub async fn delete(State(app): State<AppState>, Path(id): Path<String>) -> Response {
    match app.auth.remove_passkey(&id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(err) => internal(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_session_cookie() {
        let mut h = HeaderMap::new();
        h.insert(
            header::COOKIE,
            HeaderValue::from_static("a=1; kd_admin=abc123; b=2"),
        );
        assert_eq!(session_cookie(&h), Some("abc123"));
        h.insert(header::COOKIE, HeaderValue::from_static("kd_admin_other=x"));
        assert_eq!(session_cookie(&h), None);
    }

    #[tokio::test]
    async fn sessions_start_and_end() {
        let auth = Auth::open("http://localhost:3000", None, "t")
            .await
            .unwrap();
        let token = auth.new_session().await.unwrap();
        assert!(auth.session_valid(&token).await);
        assert!(!auth.session_valid("forged").await);
        auth.end_session(&token).await;
        assert!(!auth.session_valid(&token).await);
    }

    #[test]
    fn ceremonies_are_single_use() {
        let map = Mutex::new(HashMap::new());
        let id = remember(&map, 42);
        assert_eq!(take(&map, &id), Some(42));
        assert_eq!(take(&map, &id), None);
    }
}
