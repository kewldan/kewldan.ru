//! The contact form: a message from the site lands in Daniel's Telegram.
//!
//! Abuse is kept out in layers, cheapest first:
//! - every form starts with a one-time challenge, and a reply sooner than
//!   [`MIN_FILL`] after it is a script;
//! - the browser must find a proof of work for that challenge (a SHA-256
//!   with [`DIFFICULTY`] leading zero bits, about a second of CPU), which
//!   makes sending in bulk expensive;
//! - a hidden `website` field that only bots fill in;
//! - per-IP and global rate limits, and the same message only once a day;
//! - links are capped, and every delivered message has a "Block sender"
//!   button in Telegram. A blocked sender sees success and reaches no one.
//!
//! The bot learns where to deliver when its owner (`TELEGRAM_OWNER`) sends
//! it `/start`.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::Context as _;
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use redis::{AsyncCommands, aio::ConnectionManager};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use ts_rs::TS;

use crate::{AppState, ClientIp};

pub const DIFFICULTY: u32 = 16;
const MIN_FILL: Duration = Duration::from_secs(3);
const CHALLENGE_TTL: Duration = Duration::from_secs(3600);
const HOUR: Duration = Duration::from_secs(3600);
const DAY: Duration = Duration::from_secs(86_400);
const PER_IP_HOUR: u64 = 3;
const PER_IP_DAY: u64 = 8;
const ALL_DAY: u64 = 60;
const CHALLENGES_PER_HOUR: u64 = 30;
const MAX_LINKS: usize = 3;

#[derive(Debug, Clone)]
pub struct Telegram {
    pub token: String,
    pub owner: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "ContactChallenge")]
pub struct Challenge {
    id: String,
    /// Leading zero bits wanted in `sha256("{id}:{nonce}")`.
    difficulty: u32,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ContactInput {
    challenge: String,
    nonce: String,
    name: String,
    /// How to answer: a Telegram handle, an email.
    contact: String,
    message: String,
    /// The honeypot: hidden from people, irresistible to bots.
    #[serde(default)]
    website: String,
}

/// A few keys with expiry, in Valkey or in memory.
enum Kv {
    Memory(Mutex<Memory>),
    Valkey(ConnectionManager),
}

#[derive(Default)]
struct Memory {
    values: HashMap<String, (String, Option<Instant>)>,
    sets: HashMap<String, HashSet<String>>,
}

impl Memory {
    fn live(&mut self, key: &str) -> Option<&mut (String, Option<Instant>)> {
        if self
            .values
            .get(key)
            .is_some_and(|(_, exp)| exp.is_some_and(|e| e <= Instant::now()))
        {
            self.values.remove(key);
        }
        self.values.get_mut(key)
    }
}

impl Kv {
    async fn put(&self, key: &str, value: &str, ttl: Option<Duration>) -> redis::RedisResult<()> {
        match self {
            Self::Memory(m) => {
                let exp = ttl.map(|t| Instant::now() + t);
                m.lock()
                    .unwrap()
                    .values
                    .insert(key.into(), (value.into(), exp));
                Ok(())
            }
            Self::Valkey(c) => match ttl {
                Some(t) => c.clone().set_ex(key, value, t.as_secs()).await,
                None => c.clone().set(key, value).await,
            },
        }
    }

    async fn get(&self, key: &str) -> redis::RedisResult<Option<String>> {
        match self {
            Self::Memory(m) => Ok(m.lock().unwrap().live(key).map(|(v, _)| v.clone())),
            Self::Valkey(c) => c.clone().get(key).await,
        }
    }

    /// GETDEL: a challenge is good for one message.
    async fn take(&self, key: &str) -> redis::RedisResult<Option<String>> {
        match self {
            Self::Memory(m) => {
                let mut m = m.lock().unwrap();
                m.live(key);
                Ok(m.values.remove(key).map(|(v, _)| v))
            }
            Self::Valkey(c) => c.clone().get_del(key).await,
        }
    }

    /// A counter that starts its `ttl` on the first hit.
    async fn hit(&self, key: &str, ttl: Duration) -> redis::RedisResult<u64> {
        match self {
            Self::Memory(m) => {
                let mut m = m.lock().unwrap();
                let n = m.live(key).map_or(0, |(v, _)| v.parse().unwrap_or(0)) + 1;
                let exp = m
                    .live(key)
                    .and_then(|(_, e)| *e)
                    .unwrap_or_else(|| Instant::now() + ttl);
                m.values.insert(key.into(), (n.to_string(), Some(exp)));
                Ok(n)
            }
            Self::Valkey(c) => {
                let mut c = c.clone();
                let n: u64 = c.incr(key, 1).await?;
                if n == 1 {
                    let _: () = c.expire(key, ttl.as_secs() as i64).await?;
                }
                Ok(n)
            }
        }
    }

    /// SET NX with expiry: true the first time.
    async fn first(&self, key: &str, ttl: Duration) -> redis::RedisResult<bool> {
        match self {
            Self::Memory(m) => {
                let mut m = m.lock().unwrap();
                if m.live(key).is_some() {
                    return Ok(false);
                }
                m.values
                    .insert(key.into(), ("1".into(), Some(Instant::now() + ttl)));
                Ok(true)
            }
            Self::Valkey(c) => {
                let opts = redis::SetOptions::default()
                    .conditional_set(redis::ExistenceCheck::NX)
                    .with_expiration(redis::SetExpiry::EX(ttl.as_secs()));
                let set: Option<String> = c.clone().set_options(key, "1", opts).await?;
                Ok(set.is_some())
            }
        }
    }

    async fn set_has(&self, key: &str, member: &str) -> redis::RedisResult<bool> {
        match self {
            Self::Memory(m) => Ok(m
                .lock()
                .unwrap()
                .sets
                .get(key)
                .is_some_and(|s| s.contains(member))),
            Self::Valkey(c) => c.clone().sismember(key, member).await,
        }
    }

    async fn set_add(&self, key: &str, member: &str, on: bool) -> redis::RedisResult<()> {
        match self {
            Self::Memory(m) => {
                let mut m = m.lock().unwrap();
                let set = m.sets.entry(key.into()).or_default();
                if on {
                    set.insert(member.into());
                } else {
                    set.remove(member);
                }
                Ok(())
            }
            Self::Valkey(c) if on => c.clone().sadd(key, member).await,
            Self::Valkey(c) => c.clone().srem(key, member).await,
        }
    }
}

pub struct Contact {
    kv: Kv,
    ns: String,
    /// Keeps raw IPs out of Valkey and out of Telegram.
    salt: String,
    telegram: Option<Telegram>,
    http: reqwest::Client,
}

impl Contact {
    pub async fn open(
        valkey_url: Option<&str>,
        namespace: &str,
        salt: &str,
        telegram: Option<Telegram>,
    ) -> anyhow::Result<Self> {
        let kv = match valkey_url {
            None => Kv::Memory(Mutex::default()),
            Some(url) => Kv::Valkey(ConnectionManager::new(redis::Client::open(url)?).await?),
        };
        Ok(Self {
            kv,
            ns: format!("{namespace}:contact"),
            salt: salt.to_owned(),
            telegram,
            http: reqwest::Client::builder()
                .user_agent("kewldan.ru contact")
                .timeout(Duration::from_secs(70))
                .build()?,
        })
    }

    fn key(&self, rest: &str) -> String {
        format!("{}:{rest}", self.ns)
    }

    fn sender(&self, ip: std::net::IpAddr) -> String {
        hex(&Sha256::digest(format!("{}:{ip}", self.salt)))[..16].to_owned()
    }

    async fn owner_chat(&self) -> Option<i64> {
        self.kv.get(&self.key("owner")).await.ok()??.parse().ok()
    }

    async fn telegram(&self, method: &str, body: Value) -> anyhow::Result<Value> {
        let tg = self.telegram.as_ref().context("no TELEGRAM_BOT_TOKEN")?;
        let res: Value = self
            .http
            .post(format!("https://api.telegram.org/bot{}/{method}", tg.token))
            .json(&body)
            .send()
            .await?
            .json()
            .await?;
        anyhow::ensure!(
            res["ok"] == true,
            "Telegram {method}: {}",
            res["description"]
        );
        Ok(res["result"].clone())
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn leading_zero_bits(hash: &[u8]) -> u32 {
    let mut bits = 0;
    for &b in hash {
        if b == 0 {
            bits += 8;
        } else {
            return bits + b.leading_zeros();
        }
    }
    bits
}

pub fn proof_ok(challenge: &str, nonce: &str) -> bool {
    nonce.len() <= 32
        && leading_zero_bits(&Sha256::digest(format!("{challenge}:{nonce}"))) >= DIFFICULTY
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({ "error": code }))).into_response()
}

/// `GET /api/contact/challenge`
pub async fn challenge(State(app): State<AppState>, ClientIp(ip): ClientIp) -> Response {
    let c = &app.contact;
    let issued =
        c.kv.hit(&c.key(&format!("issued:{}", c.sender(ip))), HOUR)
            .await;
    if issued.is_ok_and(|n| n > CHALLENGES_PER_HOUR) {
        return error(StatusCode::TOO_MANY_REQUESTS, "rate");
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    if let Err(err) =
        c.kv.put(
            &c.key(&format!("challenge:{id}")),
            &crate::unix_ms().to_string(),
            Some(CHALLENGE_TTL),
        )
        .await
    {
        tracing::warn!(%err, "contact: cannot store a challenge");
        return error(StatusCode::SERVICE_UNAVAILABLE, "unavailable");
    }
    Json(Challenge {
        id,
        difficulty: DIFFICULTY,
    })
    .into_response()
}

/// Trims every field and checks it; errors are codes the site translates.
fn validate(input: &mut ContactInput) -> Result<(), &'static str> {
    input.name = input.name.trim().to_owned();
    input.contact = input.contact.trim().to_owned();
    input.message = input.message.trim().to_owned();
    let len = |s: &str| s.chars().count();
    if !(1..=80).contains(&len(&input.name)) {
        return Err("name");
    }
    if !(3..=120).contains(&len(&input.contact)) {
        return Err("contact");
    }
    if !(10..=2000).contains(&len(&input.message))
        || !input.message.chars().any(char::is_alphabetic)
    {
        return Err("message");
    }
    let links = input.message.matches("http").count() + input.message.matches("www.").count();
    if links > MAX_LINKS {
        return Err("links");
    }
    Ok(())
}

/// `POST /api/contact`
pub async fn send(
    State(app): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(mut input): Json<ContactInput>,
) -> Response {
    let c = &app.contact;
    let sender = c.sender(ip);

    let issued =
        c.kv.take(&c.key(&format!("challenge:{}", input.challenge)))
            .await
            .ok()
            .flatten()
            .and_then(|v| v.parse::<u64>().ok());
    let Some(issued) = issued else {
        return error(StatusCode::BAD_REQUEST, "challenge");
    };
    if crate::unix_ms().saturating_sub(issued) < MIN_FILL.as_millis() as u64 {
        return error(StatusCode::BAD_REQUEST, "too_fast");
    }
    if !proof_ok(&input.challenge, &input.nonce) {
        return error(StatusCode::BAD_REQUEST, "challenge");
    }
    // Bots and blocked senders get a success that goes nowhere.
    if !input.website.trim().is_empty() {
        tracing::info!(sender, "contact: honeypot filled, dropped");
        return StatusCode::NO_CONTENT.into_response();
    }
    if c.kv
        .set_has(&c.key("blocked"), &sender)
        .await
        .unwrap_or(false)
    {
        tracing::info!(sender, "contact: blocked sender, dropped");
        return StatusCode::NO_CONTENT.into_response();
    }
    if let Err(code) = validate(&mut input) {
        return error(StatusCode::UNPROCESSABLE_ENTITY, code);
    }

    let hits = async {
        let hour = c.kv.hit(&c.key(&format!("hour:{sender}")), HOUR).await?;
        let day = c.kv.hit(&c.key(&format!("day:{sender}")), DAY).await?;
        let all = c.kv.hit(&c.key("all"), DAY).await?;
        redis::RedisResult::Ok(hour > PER_IP_HOUR || day > PER_IP_DAY || all > ALL_DAY)
    };
    match hits.await {
        Ok(false) => {}
        Ok(true) => return error(StatusCode::TOO_MANY_REQUESTS, "rate"),
        Err(err) => {
            tracing::warn!(%err, "contact: rate limits unavailable");
            return error(StatusCode::SERVICE_UNAVAILABLE, "unavailable");
        }
    }
    let fingerprint = hex(&Sha256::digest(
        input
            .message
            .to_lowercase()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" "),
    ));
    if !c
        .kv
        .first(&c.key(&format!("seen:{fingerprint}")), DAY)
        .await
        .unwrap_or(true)
    {
        return error(StatusCode::CONFLICT, "duplicate");
    }

    let Some(chat) = c.owner_chat().await else {
        tracing::warn!("contact: nobody to deliver to; send the bot /start first");
        return error(StatusCode::SERVICE_UNAVAILABLE, "unavailable");
    };
    let text = format!(
        "✉️ <b>{}</b> · {}\n\n{}\n\n<i>kewldan.ru · {}</i>",
        escape(&input.name),
        escape(&input.contact),
        escape(&input.message),
        &sender[..8],
    );
    let sent = c
        .telegram(
            "sendMessage",
            json!({
                "chat_id": chat,
                "text": text,
                "parse_mode": "HTML",
                "link_preview_options": { "is_disabled": true },
                "reply_markup": block_button(&sender, false),
            }),
        )
        .await;
    match sent {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => {
            tracing::warn!(error = %format!("{err:#}"), "contact: Telegram refused");
            error(StatusCode::BAD_GATEWAY, "unavailable")
        }
    }
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn block_button(sender: &str, blocked: bool) -> Value {
    let (text, data) = if blocked {
        ("↩️ Разблокировать", format!("unblock:{sender}"))
    } else {
        ("🚫 Заблокировать отправителя", format!("block:{sender}"))
    };
    json!({ "inline_keyboard": [[{ "text": text, "callback_data": data }]] })
}

/// Long-polls the bot: `/start` from the owner sets where messages go, the
/// buttons under a message block or unblock its sender.
pub fn spawn_bot(contact: Arc<Contact>) {
    let Some(tg) = contact.telegram.clone() else {
        return;
    };
    tokio::spawn(async move {
        let mut offset = 0i64;
        loop {
            let updates = contact
                .telegram(
                    "getUpdates",
                    json!({ "offset": offset, "timeout": 50, "allowed_updates": ["message", "callback_query"] }),
                )
                .await;
            let updates = match updates {
                Ok(Value::Array(u)) => u,
                Ok(_) => Vec::new(),
                Err(err) => {
                    tracing::warn!(error = %format!("{err:#}"), "contact bot: getUpdates failed");
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    continue;
                }
            };
            for update in updates {
                offset = offset.max(update["update_id"].as_i64().unwrap_or(0) + 1);
                if let Err(err) = handle_update(&contact, &tg, &update).await {
                    tracing::warn!(error = %format!("{err:#}"), "contact bot: update failed");
                }
            }
        }
    });
}

async fn handle_update(c: &Contact, tg: &Telegram, update: &Value) -> anyhow::Result<()> {
    if let Some(msg) = update.get("message") {
        let chat = msg["chat"]["id"].as_i64().unwrap_or(0);
        let text = msg["text"].as_str().unwrap_or("");
        let from = msg["from"]["username"].as_str().unwrap_or("");
        if !text.starts_with("/start") || msg["chat"]["type"] != "private" {
            return Ok(());
        }
        let reply = if from.eq_ignore_ascii_case(&tg.owner) {
            c.kv.put(&c.key("owner"), &chat.to_string(), None).await?;
            tracing::info!("contact bot: owner chat set");
            "Готово: сюда будут приходить сообщения из формы на kewldan.ru."
        } else {
            "This bot only forwards messages from kewldan.ru. To reach Daniel: t.me/kewldan"
        };
        c.telegram("sendMessage", json!({ "chat_id": chat, "text": reply }))
            .await?;
        return Ok(());
    }

    let Some(cb) = update.get("callback_query") else {
        return Ok(());
    };
    let owner = c.owner_chat().await;
    let data = cb["data"].as_str().unwrap_or("");
    let (blocked, sender) = match data.split_once(':') {
        Some(("block", s)) => (true, s),
        Some(("unblock", s)) => (false, s),
        _ => return Ok(()),
    };
    if owner.is_none() || cb["from"]["id"].as_i64() != owner {
        return Ok(());
    }
    c.kv.set_add(&c.key("blocked"), sender, blocked).await?;
    c.telegram(
        "answerCallbackQuery",
        json!({
            "callback_query_id": cb["id"],
            "text": if blocked { "Отправитель заблокирован" } else { "Разблокирован" },
        }),
    )
    .await?;
    c.telegram(
        "editMessageReplyMarkup",
        json!({
            "chat_id": cb["message"]["chat"]["id"],
            "message_id": cb["message"]["message_id"],
            "reply_markup": block_button(sender, blocked),
        }),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_leading_zero_bits() {
        assert_eq!(leading_zero_bits(&[0, 0, 0b0001_0000]), 19);
        assert_eq!(leading_zero_bits(&[0x80]), 0);
        assert_eq!(leading_zero_bits(&[0, 0]), 16);
    }

    #[test]
    fn proof_of_work_takes_a_real_search() {
        let nonce = (0u64..)
            .map(|n| n.to_string())
            .find(|n| proof_ok("abc", n))
            .unwrap();
        assert!(proof_ok("abc", &nonce));
        assert!(!proof_ok("abc", &"9".repeat(33)));
    }

    #[test]
    fn validates_and_trims() {
        let mut input = ContactInput {
            challenge: String::new(),
            nonce: String::new(),
            name: "  Ann ".into(),
            contact: "@ann".into(),
            message: "  Hello, a project for you!  ".into(),
            website: String::new(),
        };
        assert_eq!(validate(&mut input), Ok(()));
        assert_eq!(input.name, "Ann");
        input.message = "1234567890 !!".into();
        assert_eq!(validate(&mut input), Err("message"));
        input.message = "see http://a http://b http://c http://d".into();
        assert_eq!(validate(&mut input), Err("links"));
        input.message = "Hello there, friend".into();
        input.contact = "a".into();
        assert_eq!(validate(&mut input), Err("contact"));
    }

    #[test]
    fn escapes_html() {
        assert_eq!(escape("<b>&</b>"), "&lt;b&gt;&amp;&lt;/b&gt;");
    }
}
