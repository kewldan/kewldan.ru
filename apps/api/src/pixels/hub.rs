//! The shared board: validation, ink limits, persistence and fan-out.
//!
//! Every change becomes a [`BusEvent`]. Without Valkey the event is applied
//! and broadcast in-process. With Valkey a Lua script persists the change and
//! publishes it in one atomic step; every instance (this one included) then
//! applies it from its subscription, so all mirrors see the same order.

use std::{
    collections::HashMap,
    net::IpAddr,
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicU32, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use futures_util::StreamExt;
use redis::{AsyncCommands, Script, aio::ConnectionManager};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use super::{
    board::{self, Board, HEIGHT, PALETTE, WIDTH},
    protocol::{Cell, ServerMessage},
};

const HEARTBEAT: Duration = Duration::from_secs(5);
const PEER_TTL: Duration = Duration::from_secs(15);
const MAX_BATCH: usize = 256;

pub const INK_MAX: u32 = 40;
pub const INK_REGEN: f32 = 5.0;

/// Paints and publishes in one round trip: ARGV[1] is the event, then
/// offset/byte pairs.
const PAINT_LUA: &str = r"
for i = 2, #ARGV, 2 do
  redis.call('SETRANGE', KEYS[1], ARGV[i], ARGV[i + 1])
end
redis.call('PUBLISH', KEYS[2], ARGV[1])
";
const REPLACE_LUA: &str = r"
redis.call('SET', KEYS[1], ARGV[2])
redis.call('PUBLISH', KEYS[2], ARGV[1])
";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "k", rename_all = "camelCase")]
enum BusEvent {
    Paint { by: u64, cells: Vec<Cell> },
    Board { board: String },
    Cursor { id: u64, x: f32, y: f32, c: i8 },
    Gone { id: u64 },
    Count { instance: u64, n: u32 },
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

/// `{ns}:board` holds the cells, `{ns}:events` carries the bus.
#[derive(Clone)]
struct Keys {
    board: String,
    events: String,
}

struct Bucket {
    tokens: f32,
    at: Instant,
}

impl Bucket {
    fn full() -> Self {
        Self {
            tokens: INK_MAX as f32,
            at: Instant::now(),
        }
    }

    fn refill(&mut self, now: Instant) {
        let gained = now.duration_since(self.at).as_secs_f32() * INK_REGEN;
        self.tokens = (self.tokens + gained).min(INK_MAX as f32);
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
            board: RwLock::new(board),
            tx: broadcast::channel(1024).0,
            next_id: AtomicU64::new(1),
            local_peers: AtomicU32::new(0),
            sent_peers: AtomicU32::new(0),
            remote_peers: Mutex::new(HashMap::new()),
            ink: Mutex::new(HashMap::new()),
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
            ink_max: INK_MAX,
            ink_regen: INK_REGEN,
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
        let (accepted, revert, ink) = {
            let board = self.board.read().unwrap();
            let mut buckets = self.ink.lock().unwrap();
            let bucket = buckets.entry(ip).or_insert_with(Bucket::full);
            bucket.refill(Instant::now());

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
                if bucket.tokens >= 1.0 {
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
        let mut buckets = self.ink.lock().unwrap();
        buckets.get_mut(&ip).map_or(INK_MAX, |b| {
            b.refill(Instant::now());
            b.tokens as u32
        })
    }

    async fn emit(&self, ev: BusEvent) {
        let Backend::Valkey { conn, keys, .. } = &self.backend else {
            self.deliver(ev);
            return;
        };
        let mut conn = conn.clone();
        let payload = serde_json::to_string(&ev).expect("bus events serialize");
        let result: redis::RedisResult<()> = match &ev {
            BusEvent::Paint { cells, .. } => {
                let script = Script::new(PAINT_LUA);
                let mut inv = script.key(&keys.board);
                inv.key(&keys.events).arg(&payload);
                for &(i, c) in cells {
                    inv.arg(i).arg(&[board::encode_cell(c)][..]);
                }
                inv.invoke_async(&mut conn).await
            }
            BusEvent::Board { board } => {
                Script::new(REPLACE_LUA)
                    .key(&keys.board)
                    .key(&keys.events)
                    .arg(&payload)
                    .arg(board)
                    .invoke_async(&mut conn)
                    .await
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
        self.ink.lock().unwrap().retain(|_, b| {
            b.refill(now);
            b.tokens < INK_MAX as f32
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

    #[tokio::test]
    async fn paints_are_broadcast() {
        let hub = Hub::start(None, "px").await.unwrap();
        let mut rx = hub.subscribe();
        hub.paint(7, IP, vec![(0, 3)]).await;
        let text = rx.recv().await.unwrap();
        assert!(text.contains(r#""t":"paint""#) && text.contains(r#""by":7"#));
    }
}
