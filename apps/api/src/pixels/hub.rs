//! The shared board: validation, ink limits, persistence and fan-out.
//!
//! Every change becomes a [`BusEvent`]. Without Valkey the event is applied
//! and broadcast in-process. With Valkey a Lua script persists the change and
//! publishes it in one atomic step; every instance (this one included) then
//! applies it from its subscription, so all mirrors see the same order. The
//! same step appends the change to the board's history.

use std::{
    collections::HashMap,
    net::IpAddr,
    sync::{
        Arc, LazyLock, Mutex, RwLock,
        atomic::{AtomicU32, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use futures_util::StreamExt;
use redis::{AsyncCommands, Script, aio::ConnectionManager};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use ts_rs::TS;

use super::{
    board::{self, Board, HEIGHT, PALETTE, WIDTH},
    history,
    protocol::{Cell, ServerMessage},
};

const HEARTBEAT: Duration = Duration::from_secs(5);
const PEER_TTL: Duration = Duration::from_secs(15);
const MAX_BATCH: usize = 256;

pub const INK_MAX: u32 = 40;
pub const INK_REGEN: f32 = 5.0;

/// How much people may paint, and whether they may at all. The admin sets
/// these at runtime; see [`crate::settings`].
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, rename = "BoardRules")]
pub struct Rules {
    /// The board stays visible but every stroke is refused.
    pub locked: bool,
    pub ink_max: u32,
    /// Ink regained per second.
    pub ink_regen: f32,
}

impl Default for Rules {
    fn default() -> Self {
        Self {
            locked: false,
            ink_max: INK_MAX,
            ink_regen: INK_REGEN,
        }
    }
}

/// History helpers shared by both scripts. KEYS are the board, the event
/// channel, the history list and its base board (see [`history`]).
fn history_lua(max: usize, keep: usize) -> String {
    format!(
        r"
local function init_base()
  if redis.call('EXISTS', KEYS[4]) == 0 then
    local current = redis.call('GET', KEYS[1])
    if current then redis.call('SET', KEYS[4], current) end
  end
end
local function fold()
  local n = redis.call('LLEN', KEYS[3])
  if n <= {max} then return end
  local drop = n - {keep}
  local base = redis.call('GET', KEYS[4])
  if base then
    local cells = {{}}
    for i = 1, #base do cells[i] = string.sub(base, i, i) end
    for _, line in ipairs(redis.call('LRANGE', KEYS[3], 0, drop - 1)) do
      local kind, rest = string.match(line, '^%d+ (%a) (.*)$')
      if kind == 'b' then
        for i = 1, #rest do cells[i] = string.sub(rest, i, i) end
      elseif kind == 'p' then
        for idx, b in string.gmatch(rest, '(%d+):(.)') do cells[tonumber(idx) + 1] = b end
      end
    end
    redis.call('SET', KEYS[4], table.concat(cells))
  end
  redis.call('LTRIM', KEYS[3], drop, -1)
end
",
    )
}

/// Paints, records and publishes in one round trip: ARGV[1] is the event,
/// ARGV[2] the history line, then offset/byte pairs.
static PAINT: LazyLock<Script> = LazyLock::new(|| paint_script(history::MAX, history::KEEP));

fn paint_script(max: usize, keep: usize) -> Script {
    Script::new(&format!(
        r"{}
init_base()
for i = 3, #ARGV, 2 do
  redis.call('SETRANGE', KEYS[1], ARGV[i], ARGV[i + 1])
end
redis.call('RPUSH', KEYS[3], ARGV[2])
fold()
redis.call('PUBLISH', KEYS[2], ARGV[1])
",
        history_lua(max, keep)
    ))
}
/// ARGV[1] is the event, ARGV[2] the board, ARGV[3] the history line.
static REPLACE: LazyLock<Script> = LazyLock::new(|| {
    Script::new(&format!(
        r"{}
init_base()
redis.call('SET', KEYS[1], ARGV[2])
redis.call('RPUSH', KEYS[3], ARGV[3])
fold()
redis.call('PUBLISH', KEYS[2], ARGV[1])
",
        history_lua(history::MAX, history::KEEP)
    ))
});
/// The history's base and lines, read together so a fold cannot fall between.
const HISTORY_LUA: &str = r"
return {redis.call('GET', KEYS[2]) or redis.call('GET', KEYS[1]) or '', redis.call('LRANGE', KEYS[3], 0, -1)}
";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "k", rename_all = "camelCase")]
enum BusEvent {
    Paint { by: u64, cells: Vec<Cell> },
    Board { board: String },
    Cursor { id: u64, x: f32, y: f32, c: i8 },
    Gone { id: u64 },
    Count { instance: u64, n: u32 },
    Rules { rules: Rules },
}

// One per process, so the size gap between variants costs nothing.
#[allow(clippy::large_enum_variant)]
enum Backend {
    Memory,
    Valkey {
        client: redis::Client,
        conn: ConnectionManager,
        keys: Keys,
    },
}

/// `{ns}:board` holds the cells, `{ns}:events` carries the bus,
/// `{ns}:history` and `{ns}:history:base` the past.
#[derive(Clone)]
struct Keys {
    board: String,
    events: String,
    history: String,
    history_base: String,
}

struct Bucket {
    tokens: f32,
    at: Instant,
}

impl Bucket {
    fn full(rules: Rules) -> Self {
        Self {
            tokens: rules.ink_max as f32,
            at: Instant::now(),
        }
    }

    fn refill(&mut self, now: Instant, rules: Rules) {
        let gained = now.duration_since(self.at).as_secs_f32() * rules.ink_regen;
        self.tokens = (self.tokens + gained).min(rules.ink_max as f32);
        self.at = now;
    }
}

pub struct Hub {
    instance: u64,
    backend: Backend,
    board: RwLock<Board>,
    tx: broadcast::Sender<Arc<str>>,
    next_id: AtomicU64,
    local_peers: AtomicU32,
    sent_peers: AtomicU32,
    remote_peers: Mutex<HashMap<u64, (u32, Instant)>>,
    ink: Mutex<HashMap<IpAddr, Bucket>>,
    rules: RwLock<Rules>,
    /// Only used without Valkey.
    memory_history: Mutex<history::Memory>,
}

impl Hub {
    /// Connects to Valkey when `valkey_url` is set, otherwise keeps the board
    /// in memory. Keys and the channel live under `namespace`.
    pub async fn start(valkey_url: Option<&str>, namespace: &str) -> anyhow::Result<Arc<Self>> {
        let (backend, board) = match valkey_url {
            None => (Backend::Memory, Board::seed()),
            Some(url) => {
                let keys = Keys {
                    board: format!("{namespace}:board"),
                    events: format!("{namespace}:events"),
                    history: format!("{namespace}:history"),
                    history_base: format!("{namespace}:history:base"),
                };
                let client = redis::Client::open(url)?;
                let mut conn = ConnectionManager::new(client.clone()).await?;
                let board = load_or_seed(&mut conn, &keys.board).await?;
                (Backend::Valkey { client, conn, keys }, board)
            }
        };
        let hub = Arc::new(Self {
            instance: instance_id(),
            backend,
            memory_history: Mutex::new(history::Memory::new(board.clone())),
            board: RwLock::new(board),
            tx: broadcast::channel(1024).0,
            next_id: AtomicU64::new(1),
            local_peers: AtomicU32::new(0),
            sent_peers: AtomicU32::new(0),
            remote_peers: Mutex::new(HashMap::new()),
            ink: Mutex::new(HashMap::new()),
            rules: RwLock::new(Rules::default()),
        });
        if let Backend::Valkey { client, keys, .. } = &hub.backend {
            let (ready, subscribed) = tokio::sync::oneshot::channel();
            tokio::spawn(subscribe_loop(
                Arc::clone(&hub),
                client.clone(),
                keys.clone(),
                ready,
            ));
            // Events published before the subscription exists would be lost:
            // serve nobody until it is up.
            if tokio::time::timeout(Duration::from_secs(10), subscribed)
                .await
                .is_err()
            {
                tracing::warn!("valkey subscription is slow to start; continuing");
            }
        }
        tokio::spawn(heartbeat_loop(Arc::clone(&hub)));
        Ok(hub)
    }

    pub fn backend_name(&self) -> &'static str {
        match self.backend {
            Backend::Memory => "memory",
            Backend::Valkey { .. } => "valkey",
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Arc<str>> {
        self.tx.subscribe()
    }

    pub fn snapshot(&self) -> String {
        self.board.read().unwrap().encode()
    }

    /// Registers a connection and returns its greeting.
    pub async fn join(&self, ip: IpAddr) -> ServerMessage {
        // Unique across instances and below 2^53, so JavaScript keeps it exact.
        let id = (self.instance << 32) | self.next_id.fetch_add(1, Ordering::Relaxed);
        let rules = self.rules();
        self.local_peers.fetch_add(1, Ordering::Relaxed);
        self.publish_count().await;
        self.refresh_peers();
        ServerMessage::Hello {
            id,
            width: WIDTH as u16,
            height: HEIGHT as u16,
            palette: PALETTE.iter().map(|c| (*c).to_owned()).collect(),
            board: self.snapshot(),
            ink: self.ink_left(ip),
            ink_max: rules.ink_max,
            ink_regen: rules.ink_regen,
            locked: rules.locked,
            peers: self.total_peers(),
        }
    }

    pub async fn leave(&self, id: u64) {
        self.local_peers.fetch_sub(1, Ordering::Relaxed);
        self.emit(BusEvent::Gone { id }).await;
        self.publish_count().await;
        self.refresh_peers();
    }

    /// Applies what the painter can afford and reports the rest for rollback.
    pub async fn paint(&self, by: u64, ip: IpAddr, mut cells: Vec<Cell>) -> ServerMessage {
        cells.truncate(MAX_BATCH);
        let rules = self.rules();
        let (accepted, revert, ink) = {
            let board = self.board.read().unwrap();
            let mut buckets = self.ink.lock().unwrap();
            let bucket = buckets.entry(ip).or_insert_with(|| Bucket::full(rules));
            bucket.refill(Instant::now(), rules);

            let mut accepted: Vec<Cell> = Vec::with_capacity(cells.len());
            let mut revert = Vec::new();
            for (i, c) in cells {
                if !board::is_valid_cell(i, c) || accepted.iter().any(|&(j, _)| j == i) {
                    continue;
                }
                let current = board.get(i);
                if current == c {
                    continue;
                }
                if !rules.locked && bucket.tokens >= 1.0 {
                    bucket.tokens -= 1.0;
                    accepted.push((i, c));
                } else {
                    revert.push((i, current));
                }
            }
            (accepted, revert, bucket.tokens as u32)
        };
        if !accepted.is_empty() {
            self.emit(BusEvent::Paint {
                by,
                cells: accepted,
            })
            .await;
        }
        ServerMessage::Ack { ink, revert }
    }

    /// The admin's brush: no ink, no batch limit. Unchanged cells are skipped.
    pub async fn paint_admin(&self, cells: Vec<Cell>) {
        let cells: Vec<Cell> = {
            let board = self.board.read().unwrap();
            cells
                .into_iter()
                .filter(|&(i, c)| board::is_valid_cell(i, c) && board.get(i) != c)
                .collect()
        };
        if !cells.is_empty() {
            self.emit(BusEvent::Paint { by: 0, cells }).await;
        }
    }

    /// The base board and every history line since, oldest first.
    pub async fn history(&self) -> anyhow::Result<(Board, Vec<String>)> {
        let Backend::Valkey { conn, keys, .. } = &self.backend else {
            let h = self.memory_history.lock().unwrap();
            return Ok((h.base.clone(), h.lines.iter().cloned().collect()));
        };
        let (base, lines): (Vec<u8>, Vec<String>) = Script::new(HISTORY_LUA)
            .key(&keys.board)
            .key(&keys.history_base)
            .key(&keys.history)
            .invoke_async(&mut conn.clone())
            .await?;
        let base = Board::decode(&base).unwrap_or_else(|| self.board.read().unwrap().clone());
        Ok((base, lines))
    }

    pub async fn cursor(&self, id: u64, x: f32, y: f32, c: i8) {
        if !(0.0..=1.0).contains(&x) || !(0.0..=1.0).contains(&y) {
            return;
        }
        let c = if board::is_valid_cell(0, c) {
            c
        } else {
            board::EMPTY
        };
        self.emit(BusEvent::Cursor { id, x, y, c }).await;
    }

    pub async fn cursor_gone(&self, id: u64) {
        self.emit(BusEvent::Gone { id }).await;
    }

    pub async fn replace(&self, board: Board) {
        self.emit(BusEvent::Board {
            board: board.encode(),
        })
        .await;
    }

    pub fn ink_left(&self, ip: IpAddr) -> u32 {
        let rules = self.rules();
        let mut buckets = self.ink.lock().unwrap();
        buckets.get_mut(&ip).map_or(rules.ink_max, |b| {
            b.refill(Instant::now(), rules);
            b.tokens as u32
        })
    }

    pub fn rules(&self) -> Rules {
        *self.rules.read().unwrap()
    }

    /// Changes the rules on every instance and tells everyone painting.
    pub async fn set_rules(&self, rules: Rules) {
        self.emit(BusEvent::Rules { rules }).await;
    }

    /// Sets the rules on this instance only: what it starts with.
    pub fn load_rules(&self, rules: Rules) {
        *self.rules.write().unwrap() = rules;
    }

    pub fn peers(&self) -> u32 {
        self.total_peers()
    }

    async fn emit(&self, ev: BusEvent) {
        let line = match &ev {
            BusEvent::Paint { cells, .. } => Some(history::paint_line(crate::unix_ms(), cells)),
            BusEvent::Board { board } => Some(history::board_line(crate::unix_ms(), board)),
            _ => None,
        };
        let Backend::Valkey { conn, keys, .. } = &self.backend else {
            if let Some(line) = line {
                self.memory_history.lock().unwrap().push(line);
            }
            self.deliver(ev);
            return;
        };
        let mut conn = conn.clone();
        let payload = serde_json::to_string(&ev).expect("bus events serialize");
        let line = line.unwrap_or_default();
        let history_keys = |inv: &mut redis::ScriptInvocation<'_>| {
            inv.key(&keys.board)
                .key(&keys.events)
                .key(&keys.history)
                .key(&keys.history_base);
        };
        let result: redis::RedisResult<()> = match &ev {
            BusEvent::Paint { cells, .. } => {
                let mut inv = PAINT.prepare_invoke();
                history_keys(&mut inv);
                inv.arg(&payload).arg(&line);
                for &(i, c) in cells {
                    inv.arg(i).arg(&[board::encode_cell(c)][..]);
                }
                inv.invoke_async(&mut conn).await
            }
            BusEvent::Board { board } => {
                let mut inv = REPLACE.prepare_invoke();
                history_keys(&mut inv);
                inv.arg(&payload).arg(board).arg(&line);
                inv.invoke_async(&mut conn).await
            }
            _ => conn.publish(&keys.events, &payload).await,
        };
        if let Err(err) = result {
            // Keep this instance usable; it resyncs from Valkey on reconnect.
            tracing::warn!(%err, "valkey publish failed, delivering locally");
            self.deliver(ev);
        }
    }

    fn deliver(&self, ev: BusEvent) {
        let msg = match ev {
            BusEvent::Paint { by, cells } => {
                let mut board = self.board.write().unwrap();
                for &(i, c) in &cells {
                    board.set(i, c);
                }
                ServerMessage::Paint { by, cells }
            }
            BusEvent::Board { board } => {
                match Board::decode(board.as_bytes()) {
                    Some(b) => *self.board.write().unwrap() = b,
                    None => return,
                }
                ServerMessage::Board { board }
            }
            BusEvent::Cursor { id, x, y, c } => ServerMessage::Cursor { id, x, y, c },
            BusEvent::Gone { id } => ServerMessage::Gone { id },
            BusEvent::Rules { rules } => {
                self.load_rules(rules);
                // A smaller tank applies at once, not after the next refill.
                for b in self.ink.lock().unwrap().values_mut() {
                    b.tokens = b.tokens.min(rules.ink_max as f32);
                }
                ServerMessage::Rules {
                    ink_max: rules.ink_max,
                    ink_regen: rules.ink_regen,
                    locked: rules.locked,
                }
            }
            BusEvent::Count { instance, n } => {
                if instance != self.instance {
                    self.remote_peers
                        .lock()
                        .unwrap()
                        .insert(instance, (n, Instant::now()));
                    self.refresh_peers();
                }
                return;
            }
        };
        self.broadcast(&msg);
    }

    fn broadcast(&self, msg: &ServerMessage) {
        let text: Arc<str> = serde_json::to_string(msg)
            .expect("messages serialize")
            .into();
        // No receivers is fine: nobody is looking at the board.
        let _ = self.tx.send(text);
    }

    fn total_peers(&self) -> u32 {
        let remote: u32 = self
            .remote_peers
            .lock()
            .unwrap()
            .values()
            .map(|(n, _)| n)
            .sum();
        self.local_peers.load(Ordering::Relaxed) + remote
    }

    fn refresh_peers(&self) {
        let n = self.total_peers();
        if self.sent_peers.swap(n, Ordering::Relaxed) != n {
            self.broadcast(&ServerMessage::Peers { n });
        }
    }

    async fn publish_count(&self) {
        if let Backend::Valkey { .. } = self.backend {
            let n = self.local_peers.load(Ordering::Relaxed);
            self.emit(BusEvent::Count {
                instance: self.instance,
                n,
            })
            .await;
        }
    }

    /// Drops state that has gone stale: peers of dead instances and ink
    /// buckets that are full again.
    fn prune(&self) {
        let now = Instant::now();
        self.remote_peers
            .lock()
            .unwrap()
            .retain(|_, (_, seen)| now.duration_since(*seen) < PEER_TTL);
        let rules = self.rules();
        self.ink.lock().unwrap().retain(|_, b| {
            b.refill(now, rules);
            b.tokens < rules.ink_max as f32
        });
        self.refresh_peers();
    }
}

async fn load_or_seed(conn: &mut ConnectionManager, key: &str) -> anyhow::Result<Board> {
    let raw: Option<Vec<u8>> = conn.get(key).await?;
    if let Some(board) = raw.as_deref().and_then(Board::decode) {
        return Ok(board);
    }
    let seed = Board::seed();
    let _: () = conn.set(key, seed.encode()).await?;
    Ok(seed)
}

/// Keeps a subscription alive; `ready` fires once the first one is live.
async fn subscribe_loop(
    hub: Arc<Hub>,
    client: redis::Client,
    keys: Keys,
    ready: tokio::sync::oneshot::Sender<()>,
) {
    let mut backoff = Duration::from_millis(250);
    let mut ready = Some(ready);
    loop {
        match subscribe_once(&hub, &client, &keys, &mut ready).await {
            Ok(()) => tracing::warn!("valkey subscription ended, reconnecting"),
            Err(err) => tracing::warn!(%err, "valkey subscription failed, reconnecting"),
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(10));
    }
}

async fn subscribe_once(
    hub: &Hub,
    client: &redis::Client,
    keys: &Keys,
    ready: &mut Option<tokio::sync::oneshot::Sender<()>>,
) -> anyhow::Result<()> {
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(&keys.events).await?;
    // Subscribed first, then resync, so no event falls in the gap.
    if let Backend::Valkey { conn, .. } = &hub.backend {
        let board = load_or_seed(&mut conn.clone(), &keys.board).await?;
        hub.deliver(BusEvent::Board {
            board: board.encode(),
        });
    }
    tracing::info!(channel = %keys.events, "subscribed");
    if let Some(ready) = ready.take() {
        let _ = ready.send(());
    }
    let mut messages = pubsub.on_message();
    while let Some(msg) = messages.next().await {
        let payload: String = msg.get_payload()?;
        match serde_json::from_str::<BusEvent>(&payload) {
            Ok(ev) => hub.deliver(ev),
            Err(err) => tracing::warn!(%err, "ignoring malformed bus event"),
        }
    }
    Ok(())
}

async fn heartbeat_loop(hub: Arc<Hub>) {
    let mut tick = tokio::time::interval(HEARTBEAT);
    loop {
        tick.tick().await;
        hub.publish_count().await;
        hub.prune();
    }
}

fn instance_id() -> u64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    u64::from(nanos ^ std::process::id().rotate_left(13)) & 0xF_FFFF
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;

    use super::*;
    use crate::pixels::board::CELLS;

    const IP: IpAddr = IpAddr::V4(Ipv4Addr::LOCALHOST);

    #[tokio::test]
    async fn paint_spends_ink_and_reverts_overflow() {
        let hub = Hub::start(None, "px").await.unwrap();
        let free: Vec<Cell> = (0..CELLS as u16)
            .filter(|&i| hub.board.read().unwrap().get(i) == board::EMPTY)
            .take(INK_MAX as usize + 5)
            .map(|i| (i, 2))
            .collect();

        let ServerMessage::Ack { ink, revert } = hub.paint(1, IP, free.clone()).await else {
            panic!("expected ack");
        };
        assert_eq!(ink, 0);
        assert_eq!(revert.len(), 5);
        assert!(revert.iter().all(|&(_, c)| c == board::EMPTY));
        assert_eq!(hub.board.read().unwrap().get(free[0].0), 2);
    }

    #[tokio::test]
    async fn a_locked_board_refuses_every_stroke() {
        let hub = Hub::start(None, "px").await.unwrap();
        hub.set_rules(Rules {
            locked: true,
            ..Rules::default()
        })
        .await;
        let current = hub.board.read().unwrap().get(0);
        let other = if current == 1 { 2 } else { 1 };
        let ServerMessage::Ack { ink, revert } = hub.paint(1, IP, vec![(0, other)]).await else {
            panic!("expected ack");
        };
        assert_eq!((ink, revert), (INK_MAX, vec![(0, current)]));
        assert_eq!(hub.board.read().unwrap().get(0), current);
    }

    #[tokio::test]
    async fn noop_and_invalid_cells_are_free() {
        let hub = Hub::start(None, "px").await.unwrap();
        let current = hub.board.read().unwrap().get(0);
        let ServerMessage::Ack { ink, revert } = hub
            .paint(1, IP, vec![(0, current), (CELLS as u16, 1), (1, 42)])
            .await
        else {
            panic!("expected ack");
        };
        assert_eq!(ink, INK_MAX);
        assert!(revert.is_empty());
    }

    /// The Lua fold must agree with [`history::Memory`]. Needs `VALKEY_URL`
    /// (CI has it); skipped otherwise.
    #[tokio::test]
    async fn valkey_folds_old_history_into_the_base() {
        let Ok(url) = std::env::var("VALKEY_URL") else {
            return;
        };
        let mut conn = ConnectionManager::new(redis::Client::open(url).unwrap())
            .await
            .unwrap();
        let ns = format!("test:fold:{}", std::process::id());
        let keys = [
            format!("{ns}:board"),
            format!("{ns}:events"),
            format!("{ns}:history"),
            format!("{ns}:history:base"),
        ];
        let _: () = conn.set(&keys[0], Board::empty().encode()).await.unwrap();
        let script = paint_script(3, 2);
        for i in 0..4u16 {
            let line = history::paint_line(u64::from(i), &[(i, 2)]);
            let mut inv = script.prepare_invoke();
            for k in &keys {
                inv.key(k);
            }
            inv.arg("{}").arg(&line).arg(i).arg(&b"2"[..]);
            let () = inv.invoke_async(&mut conn).await.unwrap();
        }
        let base: Vec<u8> = conn.get(&keys[3]).await.unwrap();
        let lines: Vec<String> = conn.lrange(&keys[2], 0, -1).await.unwrap();
        let _: () = conn.del(&keys).await.unwrap();

        // Four paints, at most three lines: the first two fold into the base.
        let base = Board::decode(&base).unwrap();
        assert_eq!(
            (base.get(0), base.get(1), base.get(2)),
            (2, 2, board::EMPTY)
        );
        assert_eq!(lines, vec!["2 p 2:2", "3 p 3:2"]);
        assert_eq!(history::board_at(&base, &lines, u64::MAX).get(3), 2);
    }

    #[tokio::test]
    async fn paints_are_broadcast() {
        let hub = Hub::start(None, "px").await.unwrap();
        let mut rx = hub.subscribe();
        hub.paint(7, IP, vec![(0, 3)]).await;
        let text = rx.recv().await.unwrap();
        assert!(text.contains(r#""t":"paint""#) && text.contains(r#""by":7"#));
    }
}
