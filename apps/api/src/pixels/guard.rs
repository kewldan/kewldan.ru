//! Keeping the board decent.
//!
//! Every accepted stroke is logged with who painted it: a salted hash of
//! the address. From that the admin can see who drew in an area, take back
//! everything one painter did and ban them. A ban is hidden: the banned
//! painter's strokes are answered as usual but reach nobody, so they keep
//! drawing for themselves instead of changing address. Someone painting a
//! lot at once sets off a Telegram alert with the board and buttons to undo
//! and ban, or to lock the board.
//!
//! For those who paint (and only them) a profile is kept for 30 days: the
//! address, browser, language, time zone, screen, the Umami visits to
//! replay, and an id the browser keeps for itself. That id outlives a new
//! address, so a banned painter back on a VPN shows up as linked.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    net::IpAddr,
    sync::{Mutex, RwLock},
};

use anyhow::Context as _;
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use redis::{AsyncCommands, aio::ConnectionManager};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use ts_rs::TS;

use super::{
    board::{self, Board, HEIGHT, WIDTH},
    history,
    protocol::Cell,
};
use crate::AppState;

/// Strokes kept for attribution; older ones age out.
const KEEP: usize = 20_000;
/// A burst: this many cells from one painter within the window.
const BURST_CELLS: u32 = 100;
const BURST_WINDOW_MS: u64 = 3 * 60_000;
/// One alert per painter per this long.
const ALERT_EVERY_MS: u64 = 15 * 60_000;
/// How far back "who painted here" looks.
const LOOKBACK_MS: u64 = 24 * 3_600_000;
/// How long a painter's profile and device links are kept.
const PROFILE_SECS: u64 = 30 * 86_400;
/// Kept per profile, newest last.
const KEEP_AGENTS: usize = 3;
const KEEP_DEVICES: usize = 5;
const KEEP_REPLAYS: usize = 10;

/// One stroke batch: when, by whom, which cells.
#[derive(Debug, Clone, PartialEq)]
struct Stroke {
    ms: u64,
    who: String,
    cells: Vec<u16>,
}

impl Stroke {
    fn line(&self) -> String {
        let cells: Vec<String> = self.cells.iter().map(u16::to_string).collect();
        format!("{} {} {}", self.ms, self.who, cells.join(","))
    }

    fn parse(line: &str) -> Option<Self> {
        let mut parts = line.splitn(3, ' ');
        let ms = parts.next()?.parse().ok()?;
        let who = parts.next()?.to_owned();
        let cells = parts
            .next()?
            .split(',')
            .filter_map(|c| c.parse().ok())
            .collect();
        Some(Self { ms, who, cells })
    }
}

/// Someone who painted in an area, for the admin.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Painter {
    pub who: String,
    /// Cells they painted in the area.
    pub cells: u32,
    #[ts(type = "number")]
    pub first: u64,
    #[ts(type = "number")]
    pub last: u64,
    pub banned: bool,
    pub meta: Option<Meta>,
    /// Other painters from the same browser.
    pub linked: Vec<Linked>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "PixelBan")]
pub struct Ban {
    pub who: String,
    #[ts(type = "number")]
    pub at: u64,
    pub meta: Option<Meta>,
    pub linked: Vec<Linked>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, rename = "PixelLinked")]
pub struct Linked {
    pub who: String,
    pub banned: bool,
}

/// What one connection told about itself: request headers and the
/// browser's `hi`.
#[derive(Debug, Clone, Default)]
pub struct Visit {
    pub agent: Option<String>,
    pub lang: Option<String>,
    pub device: Option<String>,
    pub tz: Option<String>,
    pub screen: Option<String>,
    pub replay: Option<Replay>,
}

/// A visit recorded by Umami.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "PixelReplay")]
pub struct Replay {
    pub website: String,
    pub visit: String,
    #[ts(type = "number")]
    pub at: u64,
}

/// Everything known about a painter, merged over their visits.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, rename = "PainterMeta")]
pub struct Meta {
    #[ts(type = "number")]
    pub first_seen: u64,
    #[ts(type = "number")]
    pub last_seen: u64,
    /// Page visits they painted in.
    pub visits: u32,
    pub cells: u32,
    pub ip: String,
    pub agents: Vec<String>,
    pub lang: Option<String>,
    pub tz: Option<String>,
    pub screen: Option<String>,
    pub devices: Vec<String>,
    pub replays: Vec<Replay>,
}

/// Appends `v` unless it is there already, keeping the newest `keep`.
fn remember<T: PartialEq>(list: &mut Vec<T>, v: T, keep: usize) {
    if !list.contains(&v) {
        list.push(v);
    }
    if list.len() > keep {
        list.drain(..list.len() - keep);
    }
}

impl Meta {
    fn merge(&mut self, ip: IpAddr, visit: &Visit, cells: u32, new_visit: bool, now: u64) {
        if self.first_seen == 0 {
            self.first_seen = now;
        }
        self.last_seen = now;
        self.visits += u32::from(new_visit);
        self.cells += cells;
        self.ip = ip.to_string();
        if let Some(a) = &visit.agent {
            remember(&mut self.agents, a.clone(), KEEP_AGENTS);
        }
        if let Some(d) = &visit.device {
            remember(&mut self.devices, d.clone(), KEEP_DEVICES);
        }
        if let Some(r) = &visit.replay
            && !self.replays.iter().any(|x| x.visit == r.visit)
        {
            remember(&mut self.replays, r.clone(), KEEP_REPLAYS);
        }
        for (field, value) in [
            (&mut self.lang, &visit.lang),
            (&mut self.tz, &visit.tz),
            (&mut self.screen, &visit.screen),
        ] {
            if value.is_some() {
                field.clone_from(value);
            }
        }
    }
}

/// Trimmed, without control characters, at most `max` characters; `None`
/// when nothing is left.
pub fn clean(s: &str, max: usize) -> Option<String> {
    let s: String = s
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect();
    (!s.is_empty()).then_some(s)
}

/// Umami's ids are UUIDs; anything else is not worth a link.
fn uuid(s: &str) -> bool {
    s.len() == 36 && s.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

impl Visit {
    /// Takes in the browser's `hi`, dropping whatever does not look right.
    pub fn hi(
        &mut self,
        device: &str,
        tz: Option<&str>,
        screen: Option<&str>,
        umami: Option<(&str, &str)>,
        now: u64,
    ) {
        let ok = (8..=64).contains(&device.len())
            && device
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-');
        self.device = ok.then(|| device.to_owned());
        self.tz = tz.and_then(|s| clean(s, 64));
        self.screen = screen.and_then(|s| clean(s, 32));
        self.replay = umami
            .filter(|(w, v)| uuid(w) && uuid(v))
            .map(|(w, v)| Replay {
                website: w.to_owned(),
                visit: v.to_owned(),
                at: now,
            });
    }
}

/// A painter's recent run of cells, for spotting bursts.
struct Run {
    start: u64,
    cells: u32,
    alerted: Option<u64>,
}

/// What a burst alert carries.
#[derive(Debug, Clone, PartialEq)]
pub struct Burst {
    pub who: String,
    pub since: u64,
    pub cells: u32,
}

/// Without Valkey: tests and local runs.
#[derive(Default)]
struct Local {
    strokes: VecDeque<Stroke>,
    metas: HashMap<String, Meta>,
    devices: HashMap<String, HashSet<String>>,
}

enum Backend {
    Memory(Mutex<Local>),
    Valkey { conn: ConnectionManager, ns: String },
}

pub struct Guard {
    backend: Backend,
    salt: String,
    bans: RwLock<HashMap<String, u64>>,
    runs: Mutex<HashMap<String, Run>>,
}

impl Guard {
    pub async fn open(valkey_url: Option<&str>, ns: &str, salt: &str) -> anyhow::Result<Self> {
        let (backend, bans) = match valkey_url {
            None => (Backend::Memory(Mutex::default()), HashMap::new()),
            Some(url) => {
                let mut conn = ConnectionManager::new(redis::Client::open(url)?).await?;
                let raw: HashMap<String, u64> = conn.hgetall(format!("{ns}:pixel:bans")).await?;
                (
                    Backend::Valkey {
                        conn,
                        ns: ns.to_owned(),
                    },
                    raw,
                )
            }
        };
        Ok(Self {
            backend,
            salt: salt.to_owned(),
            bans: RwLock::new(bans),
            runs: Mutex::default(),
        })
    }

    /// The painter's id: a salted hash of the address.
    pub fn painter(&self, ip: IpAddr) -> String {
        let ip = match ip {
            IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(ip, IpAddr::V4),
            v4 => v4,
        };
        let hash = Sha256::digest(format!("pixels:{}:{ip}", self.salt));
        hash[..6].iter().map(|b| format!("{b:02x}")).collect()
    }

    pub fn is_banned(&self, who: &str) -> bool {
        self.bans.read().unwrap().contains_key(who)
    }

    /// Logs a stroke and says whether it makes a burst worth an alert.
    pub async fn record(&self, who: &str, cells: &[Cell], now: u64) -> Option<Burst> {
        let stroke = Stroke {
            ms: now,
            who: who.to_owned(),
            cells: cells.iter().map(|&(i, _)| i).collect(),
        };
        match &self.backend {
            Backend::Memory(local) => {
                let log = &mut local.lock().unwrap().strokes;
                log.push_back(stroke);
                while log.len() > KEEP {
                    log.pop_front();
                }
            }
            Backend::Valkey { conn, ns } => {
                let key = format!("{ns}:pixel:strokes");
                let result: redis::RedisResult<()> = redis::pipe()
                    .rpush(&key, stroke.line())
                    .ignore()
                    .ltrim(&key, -(KEEP as isize), -1)
                    .ignore()
                    .query_async(&mut conn.clone())
                    .await;
                if let Err(err) = result {
                    tracing::warn!(%err, "stroke log write failed");
                }
            }
        }
        let mut runs = self.runs.lock().unwrap();
        runs.retain(|_, r| {
            now.saturating_sub(r.start) < BURST_WINDOW_MS
                || r.alerted.is_some_and(|t| t + ALERT_EVERY_MS > now)
        });
        let run = runs.entry(who.to_owned()).or_insert(Run {
            start: now,
            cells: 0,
            alerted: None,
        });
        if now.saturating_sub(run.start) >= BURST_WINDOW_MS {
            run.start = now;
            run.cells = 0;
        }
        run.cells += cells.len() as u32;
        if run.cells >= BURST_CELLS
            && run
                .alerted
                .is_none_or(|t| now.saturating_sub(t) >= ALERT_EVERY_MS)
        {
            run.alerted = Some(now);
            return Some(Burst {
                who: who.to_owned(),
                since: run.start,
                cells: run.cells,
            });
        }
        None
    }

    /// Every logged stroke, oldest first.
    async fn strokes(&self) -> anyhow::Result<Vec<Stroke>> {
        Ok(match &self.backend {
            Backend::Memory(local) => local.lock().unwrap().strokes.iter().cloned().collect(),
            Backend::Valkey { conn, ns } => {
                let raw: Vec<String> = conn
                    .clone()
                    .lrange(format!("{ns}:pixel:strokes"), 0, -1)
                    .await?;
                raw.iter().filter_map(|l| Stroke::parse(l)).collect()
            }
        })
    }

    pub async fn ban(&self, who: &str, on: bool, now: u64) -> anyhow::Result<()> {
        if let Backend::Valkey { conn, ns } = &self.backend {
            let key = format!("{ns}:pixel:bans");
            let mut conn = conn.clone();
            if on {
                let _: () = conn.hset(key, who, now).await?;
            } else {
                let _: () = conn.hdel(key, who).await?;
            }
        }
        let mut bans = self.bans.write().unwrap();
        if on {
            bans.insert(who.to_owned(), now);
        } else {
            bans.remove(who);
        }
        Ok(())
    }

    pub fn bans(&self) -> Vec<Ban> {
        let mut out: Vec<Ban> = self
            .bans
            .read()
            .unwrap()
            .iter()
            .map(|(who, &at)| Ban {
                who: who.clone(),
                at,
                meta: None,
                linked: Vec::new(),
            })
            .collect();
        out.sort_by_key(|b| std::cmp::Reverse(b.at));
        out
    }

    /// Adds a visit's strokes to the painter's profile. `new_visit` on the
    /// first write of a connection.
    pub async fn note(
        &self,
        who: &str,
        ip: IpAddr,
        visit: &Visit,
        cells: u32,
        new_visit: bool,
        now: u64,
    ) -> anyhow::Result<()> {
        let mut meta = self.meta(who).await?.unwrap_or_default();
        meta.merge(ip, visit, cells, new_visit, now);
        match &self.backend {
            Backend::Memory(local) => {
                let mut local = local.lock().unwrap();
                if let Some(d) = &visit.device {
                    local
                        .devices
                        .entry(d.clone())
                        .or_default()
                        .insert(who.to_owned());
                }
                local.metas.insert(who.to_owned(), meta);
            }
            Backend::Valkey { conn, ns } => {
                let mut pipe = redis::pipe();
                pipe.set_ex(
                    format!("{ns}:pixel:meta:{who}"),
                    serde_json::to_string(&meta)?,
                    PROFILE_SECS,
                )
                .ignore();
                if let Some(d) = &visit.device {
                    let key = format!("{ns}:pixel:device:{d}");
                    pipe.sadd(&key, who)
                        .ignore()
                        .expire(&key, PROFILE_SECS as i64)
                        .ignore();
                }
                let () = pipe.query_async(&mut conn.clone()).await?;
            }
        }
        Ok(())
    }

    pub async fn meta(&self, who: &str) -> anyhow::Result<Option<Meta>> {
        Ok(match &self.backend {
            Backend::Memory(local) => local.lock().unwrap().metas.get(who).cloned(),
            Backend::Valkey { conn, ns } => {
                let raw: Option<String> =
                    conn.clone().get(format!("{ns}:pixel:meta:{who}")).await?;
                raw.and_then(|r| serde_json::from_str(&r).ok())
            }
        })
    }

    /// Other painters seen with any of these browser ids.
    async fn linked(&self, who: &str, devices: &[String]) -> anyhow::Result<Vec<Linked>> {
        let mut found: HashSet<String> = HashSet::new();
        for d in devices {
            let whos: Vec<String> = match &self.backend {
                Backend::Memory(local) => local
                    .lock()
                    .unwrap()
                    .devices
                    .get(d)
                    .map(|s| s.iter().cloned().collect())
                    .unwrap_or_default(),
                Backend::Valkey { conn, ns } => {
                    conn.clone()
                        .smembers(format!("{ns}:pixel:device:{d}"))
                        .await?
                }
            };
            found.extend(whos);
        }
        found.remove(who);
        let mut out: Vec<Linked> = found
            .into_iter()
            .map(|w| Linked {
                banned: self.is_banned(&w),
                who: w,
            })
            .collect();
        out.sort_by(|a, b| b.banned.cmp(&a.banned).then_with(|| a.who.cmp(&b.who)));
        Ok(out)
    }

    /// A painter's profile and the painters linked to them.
    pub async fn about(&self, who: &str) -> anyhow::Result<(Option<Meta>, Vec<Linked>)> {
        let meta = self.meta(who).await?;
        let devices = meta.as_ref().map_or(&[][..], |m| &m.devices[..]);
        let linked = self.linked(who, devices).await?;
        Ok((meta, linked))
    }

    /// Who painted inside the rectangle since `since`, most cells first.
    async fn painters(&self, area: &Area, since: u64) -> anyhow::Result<Vec<Painter>> {
        let mut by: HashMap<String, Painter> = HashMap::new();
        for s in self.strokes().await? {
            if s.ms < since {
                continue;
            }
            let n = s.cells.iter().filter(|&&i| area.contains(i)).count() as u32;
            if n == 0 {
                continue;
            }
            let p = by.entry(s.who.clone()).or_insert_with(|| Painter {
                banned: self.is_banned(&s.who),
                who: s.who.clone(),
                cells: 0,
                first: s.ms,
                last: s.ms,
                meta: None,
                linked: Vec::new(),
            });
            p.cells += n;
            p.last = s.ms;
        }
        let mut out: Vec<Painter> = by.into_values().collect();
        out.sort_by_key(|p| std::cmp::Reverse(p.cells));
        for p in &mut out {
            (p.meta, p.linked) = self.about(&p.who).await?;
        }
        Ok(out)
    }
}

/// Cells to put back to undo `who` since `since`: each cell they painted
/// that nobody painted over afterwards, with its colour from before.
fn undo_cells(strokes: &[Stroke], who: &str, since: u64, before: &Board) -> Vec<Cell> {
    let mut theirs: HashSet<u16> = HashSet::new();
    let mut last_by: HashMap<u16, &str> = HashMap::new();
    for s in strokes.iter().filter(|s| s.ms >= since) {
        for &i in &s.cells {
            last_by.insert(i, &s.who);
            if s.who == who {
                theirs.insert(i);
            }
        }
    }
    let mut cells: Vec<Cell> = theirs
        .into_iter()
        .filter(|i| last_by.get(i) == Some(&who))
        .map(|i| (i, before.get(i)))
        .collect();
    cells.sort_unstable();
    cells
}

/// Takes back what `who` painted since `since` and bans them. Returns how
/// many cells went back.
pub async fn undo_and_ban(app: &AppState, who: &str, since: u64) -> anyhow::Result<usize> {
    let strokes = app.guard.strokes().await?;
    let (base, lines) = app.hub.history().await?;
    let before = history::board_at(&base, &lines, since.saturating_sub(1));
    let cells = undo_cells(&strokes, who, since, &before);
    let n = cells.len();
    app.hub.paint_admin(cells).await;
    app.guard.ban(who, true, crate::unix_ms()).await?;
    tracing::info!(who, cells = n, "pixel painter undone and banned");
    Ok(n)
}

/// The board as a PNG, 8 px a cell, for Telegram.
pub fn board_png(b: &Board, palette: &[&str]) -> anyhow::Result<Vec<u8>> {
    const S: usize = 8;
    let rgb = |hex: &str| -> [u8; 3] {
        let v = u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap_or(0);
        [(v >> 16) as u8, (v >> 8) as u8, v as u8]
    };
    let colors: Vec<[u8; 3]> = palette.iter().map(|c| rgb(c)).collect();
    let (w, h) = (WIDTH * S, HEIGHT * S);
    let mut px = Vec::with_capacity(w * h * 3);
    for y in 0..h {
        for x in 0..w {
            let c = b.get(((y / S) * WIDTH + x / S) as u16);
            let color = usize::try_from(c)
                .ok()
                .and_then(|c| colors.get(c).copied())
                .unwrap_or([255, 255, 255]);
            px.extend_from_slice(&color);
        }
    }
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w as u32, h as u32);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header()?.write_image_data(&px)?;
    }
    Ok(out)
}

fn alert_buttons(who: &str, since: u64) -> Value {
    json!({ "inline_keyboard": [
        [{ "text": "↩️ Откатить и забанить", "callback_data": format!("px:undo:{who}:{since}") }],
        [
            { "text": "🔒 Закрыть доску", "callback_data": "px:lock" },
            { "text": "Админка", "url": "https://kewldan.ru/admin#pixels" },
        ],
    ]})
}

/// Sends the admin the board and buttons to undo the painter or lock the
/// board. Logs, rather than fails, without a bot or before `/start`.
pub async fn alert(app: AppState, burst: Burst) {
    let minutes = (crate::unix_ms().saturating_sub(burst.since) / 60_000).max(1);
    let mut caption = format!(
        "🎨 На доске много рисуют: {} клеток за {minutes} мин от {}.\nЕсли там что-то не то, откати этого рисующего.",
        burst.cells, burst.who
    );
    if let Ok((meta, linked)) = app.guard.about(&burst.who).await {
        caption.push_str(&describe(meta.as_ref(), &linked));
    }
    if let Err(err) = send_board(&app, &caption, alert_buttons(&burst.who, burst.since)).await {
        tracing::warn!(error = %format!("{err:#}"), "pixel alert not sent");
    }
}

/// The profile in a few lines under an alert.
fn describe(meta: Option<&Meta>, linked: &[Linked]) -> String {
    let mut out = String::new();
    if let Some(m) = meta {
        out.push_str(&format!("\n\n🌐 {}", m.ip));
        let place: Vec<&str> = [m.tz.as_deref(), m.lang.as_deref(), m.screen.as_deref()]
            .into_iter()
            .flatten()
            .collect();
        if !place.is_empty() {
            out.push_str(&format!(" · {}", place.join(" · ")));
        }
        if let Some(a) = m.agents.last() {
            out.push_str(&format!("\n🧭 {}", a.chars().take(120).collect::<String>()));
        }
    }
    let banned: Vec<&str> = linked
        .iter()
        .filter(|l| l.banned)
        .map(|l| l.who.as_str())
        .collect();
    if !banned.is_empty() {
        out.push_str(&format!(
            "\n⚠️ Тот же браузер, что у забаненных: {}",
            banned.join(", ")
        ));
    } else if !linked.is_empty() {
        out.push_str(&format!(
            "\n🔗 Тот же браузер под другими адресами: {}",
            linked.len()
        ));
    }
    out
}

async fn send_board(app: &AppState, caption: &str, buttons: Value) -> anyhow::Result<()> {
    let board = Board::decode(app.hub.snapshot().as_bytes()).unwrap_or_else(Board::empty);
    let png = board_png(&board, &board::PALETTE)?;
    app.contact.send_photo(png, caption, buttons).await
}

/// `POST /api/admin/pixels/alert`: a sample alert, to check the bot works.
pub async fn test_alert(State(app): State<AppState>) -> Response {
    let buttons = json!({ "inline_keyboard": [[{ "text": "Админка", "url": "https://kewldan.ru/admin#pixels" }]] });
    match send_board(&app, "🧪 Проверка: так выглядят оповещения о доске. Под настоящими будут кнопки «Откатить и забанить» и «Закрыть доску».", buttons).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "telegram", "detail": format!("{err:#}") })),
        )
            .into_response(),
    }
}

/// A button under an alert: `undo:{who}:{since}` or `lock`. Returns the
/// toast and the buttons to leave under the message.
pub async fn button(app: &AppState, data: &str) -> anyhow::Result<(String, Value)> {
    if data == "lock" {
        let mut s = app.settings.get();
        s.board.locked = true;
        app.settings.save(s.clone()).await?;
        app.hub.set_rules(s.board).await;
        return Ok((
            "Доска закрыта".into(),
            json!({ "inline_keyboard": [[{ "text": "🔒 Закрыта · открыть в админке", "url": "https://kewldan.ru/admin#pixels" }]] }),
        ));
    }
    let Some(("undo", rest)) = data.split_once(':') else {
        anyhow::bail!("unknown button {data}");
    };
    let (who, since) = rest.split_once(':').context("bad undo button")?;
    let n = undo_and_ban(app, who, since.parse()?).await?;
    Ok((
        format!("Откатил {n} клеток, {who} забанен"),
        json!({ "inline_keyboard": [[{ "text": format!("✅ Откатил {n} клеток и забанил"), "callback_data": "px:done" }]] }),
    ))
}

/// A rectangle of cells, in board coordinates.
#[derive(Debug, Deserialize)]
pub struct Area {
    x: usize,
    y: usize,
    w: usize,
    h: usize,
}

impl Area {
    fn valid(&self) -> bool {
        self.w > 0 && self.h > 0 && self.x + self.w <= WIDTH && self.y + self.h <= HEIGHT
    }

    fn contains(&self, i: u16) -> bool {
        let (x, y) = (i as usize % WIDTH, i as usize / WIDTH);
        (self.x..self.x + self.w).contains(&x) && (self.y..self.y + self.h).contains(&y)
    }
}

fn internal(err: anyhow::Error) -> Response {
    tracing::error!(error = %format!("{err:#}"), "pixel guard failed");
    StatusCode::INTERNAL_SERVER_ERROR.into_response()
}

/// `POST /api/admin/pixels/painters`: who painted in the area, last 24 h.
pub async fn painters(State(app): State<AppState>, Json(area): Json<Area>) -> Response {
    if !area.valid() {
        return StatusCode::UNPROCESSABLE_ENTITY.into_response();
    }
    let since = crate::unix_ms().saturating_sub(LOOKBACK_MS);
    match app.guard.painters(&area, since).await {
        Ok(list) => Json(json!({ "items": list })).into_response(),
        Err(err) => internal(err),
    }
}

#[derive(Deserialize)]
pub struct Undo {
    who: String,
    since: u64,
}

/// `POST /api/admin/pixels/undo`: takes back one painter's strokes since
/// `since` and bans them.
pub async fn undo(State(app): State<AppState>, Json(u): Json<Undo>) -> Response {
    match undo_and_ban(&app, &u.who, u.since).await {
        Ok(n) => Json(json!({ "cells": n })).into_response(),
        Err(err) => internal(err),
    }
}

/// `GET /api/admin/pixels/bans`
pub async fn bans(State(app): State<AppState>) -> Response {
    let mut list = app.guard.bans();
    for b in &mut list {
        match app.guard.about(&b.who).await {
            Ok(about) => (b.meta, b.linked) = about,
            Err(err) => return internal(err),
        }
    }
    Json(json!({ "items": list })).into_response()
}

/// `PUT /api/admin/pixels/bans/{who}`
pub async fn ban(State(app): State<AppState>, Path(who): Path<String>) -> Response {
    if who.len() != 12 || !who.bytes().all(|b| b.is_ascii_hexdigit()) {
        return StatusCode::UNPROCESSABLE_ENTITY.into_response();
    }
    match app.guard.ban(&who, true, crate::unix_ms()).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => internal(err),
    }
}

/// `DELETE /api/admin/pixels/bans/{who}`
pub async fn unban(State(app): State<AppState>, Path(who): Path<String>) -> Response {
    match app.guard.ban(&who, false, crate::unix_ms()).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => internal(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stroke(ms: u64, who: &str, cells: &[u16]) -> Stroke {
        Stroke {
            ms,
            who: who.into(),
            cells: cells.to_vec(),
        }
    }

    #[test]
    fn strokes_round_trip() {
        let s = stroke(17, "a1b2c3d4e5f6", &[1, 2, 300]);
        assert_eq!(Stroke::parse(&s.line()), Some(s));
        assert_eq!(Stroke::parse("garbage"), None);
    }

    #[test]
    fn undo_skips_what_others_painted_over() {
        let mut before = Board::empty();
        before.set(1, 3);
        let strokes = [
            stroke(5, "vandal", &[9]),
            stroke(10, "vandal", &[1, 2, 3]),
            stroke(11, "artist", &[3]),
            stroke(12, "vandal", &[4]),
        ];
        // Cell 9 is from before `since`; cell 3 belongs to the artist now.
        assert_eq!(
            undo_cells(&strokes, "vandal", 10, &before),
            vec![(1, 3), (2, board::EMPTY), (4, board::EMPTY)]
        );
    }

    #[tokio::test]
    async fn bursts_alert_once() {
        let g = Guard::open(None, "t", "salt").await.unwrap();
        let cells: Vec<Cell> = (0..60).map(|i| (i, 1)).collect();
        assert_eq!(g.record("a", &cells, 1_000).await, None);
        let burst = g.record("a", &cells, 2_000).await.unwrap();
        assert_eq!((burst.since, burst.cells), (1_000, 120));
        assert_eq!(g.record("a", &cells, 3_000).await, None);
        // Someone else is counted on their own.
        assert_eq!(g.record("b", &cells, 3_000).await, None);
    }

    #[tokio::test]
    async fn bans_and_painters() {
        let g = Guard::open(None, "t", "salt").await.unwrap();
        let ip: IpAddr = "203.0.113.7".parse().unwrap();
        let who = g.painter(ip);
        assert_eq!(who.len(), 12);
        assert_ne!(who, g.painter("203.0.113.8".parse().unwrap()));
        g.record(&who, &[(0, 1), (70, 1)], 10).await;
        g.record("other", &[(500, 1)], 20).await;
        let area = Area {
            x: 0,
            y: 0,
            w: 8,
            h: 2,
        };
        let found = g.painters(&area, 0).await.unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].who.as_str(), found[0].cells), (who.as_str(), 2));
        g.ban(&who, true, 30).await.unwrap();
        assert!(g.is_banned(&who));
        assert_eq!(g.bans().len(), 1);
        g.ban(&who, false, 40).await.unwrap();
        assert!(!g.is_banned(&who));
    }

    #[tokio::test]
    async fn a_painter_on_a_new_address_is_linked_by_their_browser() {
        let g = Guard::open(None, "t", "salt").await.unwrap();
        let (home, vpn): (IpAddr, IpAddr) = (
            "203.0.113.7".parse().unwrap(),
            "198.51.100.9".parse().unwrap(),
        );
        let (a, b) = (g.painter(home), g.painter(vpn));
        let mut visit = Visit {
            agent: Some("Firefox".into()),
            ..Default::default()
        };
        let website = "95ea741c-8950-4c23-a5f7-5e1772a648dd";
        let v1 = "9b1dbb5c-d5b9-5bde-bbd6-32b8fffee9bf";
        visit.hi(
            "device-1234",
            Some("Europe/Moscow"),
            Some("1440×900@2"),
            Some((website, v1)),
            5,
        );
        g.note(&a, home, &visit, 10, true, 5).await.unwrap();
        g.note(&a, home, &visit, 4, false, 6).await.unwrap();
        g.ban(&a, true, 7).await.unwrap();
        g.note(&b, vpn, &visit, 3, true, 8).await.unwrap();

        let (meta, linked) = g.about(&a).await.unwrap();
        let meta = meta.unwrap();
        assert_eq!(
            (meta.visits, meta.cells, meta.first_seen, meta.last_seen),
            (1, 14, 5, 6)
        );
        assert_eq!(meta.ip, "203.0.113.7");
        assert_eq!(meta.tz.as_deref(), Some("Europe/Moscow"));
        assert_eq!(meta.replays.len(), 1);
        assert_eq!(meta.replays[0].visit, v1);
        assert_eq!(
            linked,
            vec![Linked {
                who: b.clone(),
                banned: false
            }]
        );
        let (_, linked) = g.about(&b).await.unwrap();
        assert_eq!(
            linked,
            vec![Linked {
                who: a,
                banned: true
            }]
        );
    }

    #[test]
    fn junk_in_hi_is_dropped() {
        let mut v = Visit::default();
        v.hi(
            "x",
            Some(" \u{7}  "),
            Some(&"9".repeat(100)),
            Some(("nope", "nope")),
            1,
        );
        assert_eq!(v.device, None);
        assert_eq!(v.tz, None);
        assert_eq!(v.screen.map(|s| s.len()), Some(32));
        assert_eq!(v.replay, None);
    }

    #[test]
    fn profiles_keep_the_newest_few() {
        let mut list = vec![1, 2, 3];
        remember(&mut list, 2, 3);
        assert_eq!(list, [1, 2, 3]);
        remember(&mut list, 4, 3);
        assert_eq!(list, [2, 3, 4]);
    }

    #[test]
    fn renders_a_png() {
        let png = board_png(&Board::seed(), &board::PALETTE).unwrap();
        assert_eq!(&png[1..4], b"PNG");
    }
}
