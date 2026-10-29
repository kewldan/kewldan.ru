//! Admin sign-in with passkeys (WebAuthn).
//!
//! There is one admin. The first passkey is added while signed in with
//! `ADMIN_TOKEN`; after that the passkey is enough. A successful sign-in sets
//! an HttpOnly session cookie that the admin routes accept in place of the
//! token. Passkeys, sessions and a short sign-in log live in Valkey (in
//! memory without it); the short-lived ceremony state stays in this process.
//! Addresses are kept only as a network prefix plus a salted hash.

use std::{
    collections::{HashMap, VecDeque},
    net::IpAddr,
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

use crate::{AppState, ClientIp};

const COOKIE: &str = "kd_admin";
const SESSION_TTL: Duration = Duration::from_secs(30 * 24 * 3600);
const CEREMONY_TTL: Duration = Duration::from_secs(5 * 60);
const MAX_PENDING: usize = 64;
const LOG_KEEP: usize = 50;
/// How stale a session's "last seen" may get before a request updates it.
const SEEN_EVERY_MS: u64 = 60_000;
/// The one admin's WebAuthn user handle; stable so every passkey belongs to them.
const ADMIN_USER: Uuid = Uuid::from_u128(0x6b65_776c_6461_6e2d_6164_6d69_6e00_0001);

/// A registered passkey plus what the admin page shows about it.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Stored {
    name: String,
    created_at: u64,
    #[serde(default)]
    last_used: Option<u64>,
    passkey: Passkey,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyInfo {
    id: String,
    name: String,
    created_at: u64,
    last_used: Option<u64>,
    /// Backed up by a password manager (iCloud, Google), so it follows the
    /// account to new devices; otherwise bound to one device or key.
    synced: bool,
}

impl PasskeyInfo {
    fn new(id: String, s: Stored) -> Self {
        Self {
            id,
            // The flag sits inside the credential, which webauthn-rs only
            // exposes through its serialised form.
            synced: serde_json::to_value(&s.passkey)
                .ok()
                .and_then(|v| v.pointer("/cred/backup_eligible")?.as_bool())
                .unwrap_or(false),
            name: s.name,
            created_at: s.created_at,
            last_used: s.last_used,
        }
    }
}

/// Where a session came from, for the admin's list of sessions.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct SessionMeta {
    created_at: u64,
    seen_at: u64,
    /// The browser's user agent, cut short.
    agent: String,
    /// Masked: see [`Auth::mask`].
    ip: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    /// A prefix of the stored hash: enough to name it, useless to sign in.
    id: String,
    #[serde(flatten)]
    meta: SessionMeta,
    /// The session this request came with.
    current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    at: u64,
    ok: bool,
    what: String,
    ip: Option<String>,
}

enum Backend {
    Memory {
        passkeys: Mutex<HashMap<String, Stored>>,
        sessions: Mutex<HashMap<String, (Instant, SessionMeta)>>,
        log: Mutex<VecDeque<LogEntry>>,
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
    /// Salts the address hashes.
    salt: String,
    registering: Mutex<HashMap<String, (PasskeyRegistration, Instant)>>,
    signing_in: Mutex<HashMap<String, (PasskeyAuthentication, Instant)>>,
}

impl Auth {
    /// `origin` is where the site is served (`https://kewldan.ru`); its host
    /// is the relying-party id passkeys are bound to.
    pub async fn open(
        origin: &str,
        valkey_url: Option<&str>,
        ns: &str,
        salt: &str,
    ) -> anyhow::Result<Self> {
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
                log: Mutex::default(),
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
            salt: salt.to_owned(),
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

    pub async fn has_passkeys(&self) -> bool {
        self.passkeys().await.is_ok_and(|l| !l.is_empty())
    }

    /// Issues a session and returns the raw token for the cookie; only its
    /// hash is stored.
    async fn new_session(&self, agent: &str, ip: Option<IpAddr>) -> anyhow::Result<String> {
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let key = hash(&token);
        let now = now_ms();
        let meta = SessionMeta {
            created_at: now,
            seen_at: now,
            agent: agent.chars().take(200).collect(),
            ip: ip.map(|ip| self.mask(ip)).unwrap_or_default(),
        };
        match &self.backend {
            Backend::Memory { sessions, .. } => {
                sessions
                    .lock()
                    .unwrap()
                    .insert(key, (Instant::now() + SESSION_TTL, meta));
            }
            Backend::Valkey { conn, ns } => {
                let _: () = conn
                    .clone()
                    .set_ex(
                        format!("{ns}:session:{key}"),
                        serde_json::to_string(&meta)?,
                        SESSION_TTL.as_secs(),
                    )
                    .await?;
            }
        }
        Ok(token)
    }

    /// Whether the token is a live session; also notes that it was seen.
    pub async fn session_valid(&self, token: &str) -> bool {
        let key = hash(token);
        let now = now_ms();
        match &self.backend {
            Backend::Memory { sessions, .. } => {
                let mut sessions = sessions.lock().unwrap();
                match sessions.get_mut(&key) {
                    Some((until, meta)) if *until > Instant::now() => {
                        meta.seen_at = now;
                        true
                    }
                    _ => false,
                }
            }
            Backend::Valkey { conn, ns } => {
                let k = format!("{ns}:session:{key}");
                let raw: Option<String> = match conn.clone().get(&k).await {
                    Ok(raw) => raw,
                    Err(_) => return false,
                };
                let Some(raw) = raw else { return false };
                // Sessions from before this field held a bare "1".
                let mut meta: SessionMeta = serde_json::from_str(&raw).unwrap_or_default();
                if now.saturating_sub(meta.seen_at) > SEEN_EVERY_MS {
                    meta.seen_at = now;
                    let _: Result<(), _> = redis::cmd("SET")
                        .arg(&k)
                        .arg(serde_json::to_string(&meta).unwrap_or(raw))
                        .arg("KEEPTTL")
                        .query_async(&mut conn.clone())
                        .await;
                }
                true
            }
        }
    }

    async fn end_session(&self, token: &str) {
        self.end_by_hash(&hash(token)).await;
    }

    async fn end_by_hash(&self, key: &str) {
        match &self.backend {
            Backend::Memory { sessions, .. } => {
                sessions.lock().unwrap().remove(key);
            }
            Backend::Valkey { conn, ns } => {
                let _: Result<(), _> = conn.clone().del(format!("{ns}:session:{key}")).await;
            }
        }
    }

    /// Every live session: (stored hash, where it came from).
    async fn sessions(&self) -> anyhow::Result<Vec<(String, SessionMeta)>> {
        Ok(match &self.backend {
            Backend::Memory { sessions, .. } => {
                let now = Instant::now();
                let mut sessions = sessions.lock().unwrap();
                sessions.retain(|_, (until, _)| *until > now);
                sessions
                    .iter()
                    .map(|(k, (_, m))| (k.clone(), m.clone()))
                    .collect()
            }
            Backend::Valkey { conn, ns } => {
                let prefix = format!("{ns}:session:");
                let mut conn = conn.clone();
                let keys: Vec<String> = {
                    let mut iter = conn.scan_match::<_, String>(format!("{prefix}*")).await?;
                    let mut keys = Vec::new();
                    while let Some(k) = futures_util::StreamExt::next(&mut iter).await {
                        keys.push(k?);
                    }
                    keys
                };
                let mut out = Vec::with_capacity(keys.len());
                for k in keys {
                    let raw: Option<String> = conn.get(&k).await?;
                    if let Some(raw) = raw {
                        let meta = serde_json::from_str(&raw).unwrap_or_default();
                        out.push((k[prefix.len()..].to_owned(), meta));
                    }
                }
                out
            }
        })
    }

    /// Adds a line to the sign-in log, newest first, keeping the last 50.
    pub async fn log(&self, ok: bool, what: &str, ip: Option<IpAddr>) {
        let entry = LogEntry {
            at: now_ms(),
            ok,
            what: what.to_owned(),
            ip: ip.map(|ip| self.mask(ip)),
        };
        match &self.backend {
            Backend::Memory { log, .. } => {
                let mut log = log.lock().unwrap();
                log.push_front(entry);
                log.truncate(LOG_KEEP);
            }
            Backend::Valkey { conn, ns } => {
                let key = format!("{ns}:auth:log");
                let Ok(line) = serde_json::to_string(&entry) else {
                    return;
                };
                let result: redis::RedisResult<()> = redis::pipe()
                    .lpush(&key, line)
                    .ignore()
                    .ltrim(&key, 0, LOG_KEEP as isize - 1)
                    .ignore()
                    .query_async(&mut conn.clone())
                    .await;
                if let Err(err) = result {
                    tracing::warn!(%err, "sign-in log write failed");
                }
            }
        }
    }

    async fn read_log(&self) -> anyhow::Result<Vec<LogEntry>> {
        Ok(match &self.backend {
            Backend::Memory { log, .. } => log.lock().unwrap().iter().cloned().collect(),
            Backend::Valkey { conn, ns } => {
                let raw: Vec<String> = conn.clone().lrange(format!("{ns}:auth:log"), 0, -1).await?;
                raw.iter()
                    .filter_map(|l| serde_json::from_str(l).ok())
                    .collect()
            }
        })
    }

    /// `203.0.113.0/24 · h:7f3a9c0e`: the network and a salted hash of the
    /// address, enough to tell two places apart and no more.
    fn mask(&self, ip: IpAddr) -> String {
        let ip = match ip {
            IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(ip, IpAddr::V4),
            v4 => v4,
        };
        let net = match ip {
            IpAddr::V4(v) => {
                let [a, b, c, _] = v.octets();
                format!("{a}.{b}.{c}.0/24")
            }
            IpAddr::V6(v) => {
                let s = v.segments();
                format!("{:x}:{:x}:{:x}::/48", s[0], s[1], s[2])
            }
        };
        format!("{net} · h:{}", &hash(&format!("{}{ip}", self.salt))[..8])
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

fn agent(headers: &HeaderMap) -> &str {
    headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
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
pub async fn login_finish(
    State(app): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    Json(body): Json<LoginFinish>,
) -> Response {
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
            app.auth.log(false, "refused passkey", Some(ip)).await;
            return fail(StatusCode::UNAUTHORIZED, "passkey");
        }
    };
    // Keep the signature counter and backup flags current, and note which
    // passkey it was.
    let mut used = String::from("passkey");
    if let Ok(list) = app.auth.passkeys().await {
        for (id, mut stored) in list {
            if stored.passkey.update_credential(&result).is_some() {
                stored.last_used = Some(now_ms());
                used = format!("passkey “{}”", stored.name);
                let _ = app.auth.put_passkey(&id, &stored).await;
            }
        }
    }
    match app.auth.new_session(agent(&headers), Some(ip)).await {
        Ok(token) => {
            tracing::info!("admin signed in with a passkey");
            app.auth.log(true, &used, Some(ip)).await;
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
    ClientIp(ip): ClientIp,
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
        last_used: None,
        passkey,
    };
    let id = Uuid::new_v4().simple().to_string();
    match app.auth.put_passkey(&id, &stored).await {
        Ok(()) => {
            tracing::info!(name = %stored.name, "passkey added");
            app.auth
                .log(true, &format!("added “{}”", stored.name), Some(ip))
                .await;
            (StatusCode::CREATED, Json(PasskeyInfo::new(id, stored))).into_response()
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
                .map(|(id, s)| PasskeyInfo::new(id, s))
                .collect();
            out.sort_by_key(|p| p.created_at);
            Json(json!({ "items": out })).into_response()
        }
        Err(err) => internal(err),
    }
}

/// `DELETE /api/admin/passkeys/{id}`. With token sign-in off the last
/// passkey stays: it is the only way in.
pub async fn delete(
    State(app): State<AppState>,
    ClientIp(ip): ClientIp,
    Path(id): Path<String>,
) -> Response {
    let list = match app.auth.passkeys().await {
        Ok(list) => list,
        Err(err) => return internal(err),
    };
    let Some((_, stored)) = list.iter().find(|(k, _)| *k == id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if list.len() == 1 && !app.settings.get().token_sign_in {
        return fail(StatusCode::CONFLICT, "last_passkey");
    }
    match app.auth.remove_passkey(&id).await {
        Ok(_) => {
            app.auth
                .log(true, &format!("removed “{}”", stored.name), Some(ip))
                .await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(err) => internal(err),
    }
}

#[derive(Deserialize)]
pub struct Rename {
    name: String,
}

/// `PATCH /api/admin/passkeys/{id}`
pub async fn rename(
    State(app): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<Rename>,
) -> Response {
    let name: String = body.name.trim().chars().take(60).collect();
    if name.is_empty() {
        return fail(StatusCode::UNPROCESSABLE_ENTITY, "name");
    }
    let list = match app.auth.passkeys().await {
        Ok(list) => list,
        Err(err) => return internal(err),
    };
    let Some((_, mut stored)) = list.into_iter().find(|(k, _)| *k == id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    stored.name = name;
    match app.auth.put_passkey(&id, &stored).await {
        Ok(()) => Json(PasskeyInfo::new(id, stored)).into_response(),
        Err(err) => internal(err),
    }
}

/// `GET /api/admin/sessions`: newest first.
pub async fn sessions(State(app): State<AppState>, headers: HeaderMap) -> Response {
    let current = session_cookie(&headers).map(hash);
    match app.auth.sessions().await {
        Ok(list) => {
            let mut out: Vec<SessionInfo> = list
                .into_iter()
                .map(|(key, meta)| SessionInfo {
                    current: current.as_deref() == Some(key.as_str()),
                    id: key[..16].to_owned(),
                    meta,
                })
                .collect();
            out.sort_by_key(|s| std::cmp::Reverse(s.meta.seen_at));
            Json(json!({ "items": out })).into_response()
        }
        Err(err) => internal(err),
    }
}

/// `DELETE /api/admin/sessions/{id}`: signs that session out.
pub async fn end_session(State(app): State<AppState>, Path(id): Path<String>) -> Response {
    match app.auth.sessions().await {
        Ok(list) => match list
            .into_iter()
            .find(|(k, _)| k.starts_with(&id) && id.len() == 16)
        {
            Some((key, _)) => {
                app.auth.end_by_hash(&key).await;
                StatusCode::NO_CONTENT.into_response()
            }
            None => StatusCode::NOT_FOUND.into_response(),
        },
        Err(err) => internal(err),
    }
}

/// `DELETE /api/admin/sessions`: signs out everywhere but here.
pub async fn end_others(
    State(app): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
) -> Response {
    let current = session_cookie(&headers).map(hash);
    match app.auth.sessions().await {
        Ok(list) => {
            let mut n = 0;
            for (key, _) in list {
                if current.as_deref() != Some(key.as_str()) {
                    app.auth.end_by_hash(&key).await;
                    n += 1;
                }
            }
            app.auth
                .log(true, &format!("signed out {n} other sessions"), Some(ip))
                .await;
            Json(json!({ "ended": n })).into_response()
        }
        Err(err) => internal(err),
    }
}

/// `GET /api/admin/auth/log`: the last 50 sign-in events, newest first.
pub async fn log(State(app): State<AppState>) -> Response {
    match app.auth.read_log().await {
        Ok(items) => Json(json!({ "items": items })).into_response(),
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
        let auth = Auth::open("http://localhost:3000", None, "t", "salt")
            .await
            .unwrap();
        let ip: IpAddr = "203.0.113.7".parse().unwrap();
        let token = auth.new_session("Safari", Some(ip)).await.unwrap();
        assert!(auth.session_valid(&token).await);
        assert!(!auth.session_valid("forged").await);
        let list = auth.sessions().await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].1.agent, "Safari");
        assert!(list[0].1.ip.starts_with("203.0.113.0/24 · h:"));
        auth.end_session(&token).await;
        assert!(!auth.session_valid(&token).await);
    }

    #[tokio::test]
    async fn the_log_keeps_the_newest_fifty() {
        let auth = Auth::open("http://localhost:3000", None, "t", "salt")
            .await
            .unwrap();
        for i in 0..60 {
            auth.log(i % 2 == 0, &format!("event {i}"), None).await;
        }
        let log = auth.read_log().await.unwrap();
        assert_eq!(log.len(), LOG_KEEP);
        assert_eq!(log[0].what, "event 59");
    }

    #[tokio::test]
    async fn addresses_are_masked() {
        let auth = Auth::open("http://localhost:3000", None, "t", "salt")
            .await
            .unwrap();
        let a = auth.mask("203.0.113.7".parse().unwrap());
        let b = auth.mask("203.0.113.8".parse().unwrap());
        assert!(a.starts_with("203.0.113.0/24 · h:") && a != b);
        assert!(!a.contains(".7"));
        let v6 = auth.mask("2001:db8:1:2::5".parse().unwrap());
        assert!(v6.starts_with("2001:db8:1::/48 · h:"));
    }

    #[test]
    fn ceremonies_are_single_use() {
        let map = Mutex::new(HashMap::new());
        let id = remember(&map, 42);
        assert_eq!(take(&map, &id), Some(42));
        assert_eq!(take(&map, &id), None);
    }
}
