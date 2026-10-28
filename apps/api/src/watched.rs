//! Watched: films and series with a score from 1 to 10.
//!
//! Anyone can read the list; only the admin token can change it. Titles live
//! in one Valkey hash (`{ns}:watched`, id → JSON) or, without Valkey, in
//! memory.

use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use redis::{AsyncCommands, aio::ConnectionManager};
use serde::{Deserialize, Serialize};
use serde_json::json;
use ts_rs::TS;

use crate::AppState;

const MAX_TITLES: usize = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Kind {
    Movie,
    Series,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename = "WatchStatus")]
pub enum Status {
    Watched,
    Watching,
    Dropped,
}

/// What the admin form sends.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TitleInput {
    pub title: String,
    pub kind: Kind,
    pub year: Option<u16>,
    /// 1 to 10.
    pub rating: u8,
    pub status: Status,
    /// Free text for series, e.g. "1–3".
    #[serde(default)]
    pub seasons: String,
    #[serde(default)]
    pub note: String,
    /// `YYYY-MM-DD`.
    pub watched: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Title {
    pub id: String,
    #[serde(flatten)]
    #[ts(flatten)]
    pub input: TitleInput,
    /// Unix milliseconds; breaks ties between titles watched the same day.
    #[ts(type = "number")]
    pub created_at: u64,
}

impl TitleInput {
    /// Trims and checks every field; the error is shown to the admin as is.
    fn validate(mut self) -> Result<Self, String> {
        self.title = self.title.trim().to_owned();
        self.seasons = self.seasons.trim().to_owned();
        self.note = self.note.trim().to_owned();
        if self.title.is_empty() {
            return Err("Add a title first.".into());
        }
        if self.title.chars().count() > 160
            || self.note.chars().count() > 400
            || self.seasons.chars().count() > 40
        {
            return Err("Too long: title up to 160 characters, note up to 400.".into());
        }
        if !(1..=10).contains(&self.rating) {
            return Err("Pick a score from 1 to 10.".into());
        }
        if self.year.is_some_and(|y| !(1880..2100).contains(&y)) {
            return Err("The year looks wrong.".into());
        }
        let date = self.watched.as_bytes();
        let ok_date = date.len() == 10
            && date.iter().enumerate().all(|(i, b)| {
                if i == 4 || i == 7 {
                    *b == b'-'
                } else {
                    b.is_ascii_digit()
                }
            });
        if !ok_date {
            return Err("The date must look like 2026-10-28.".into());
        }
        if self.kind == Kind::Movie {
            self.seasons.clear();
        }
        Ok(self)
    }
}

enum Backend {
    Memory(Mutex<HashMap<String, Title>>),
    Valkey {
        conn: ConnectionManager,
        key: String,
    },
}

pub struct Store {
    backend: Backend,
    next: AtomicU64,
}

impl Store {
    pub async fn open(valkey_url: Option<&str>, namespace: &str) -> anyhow::Result<Self> {
        let backend = match valkey_url {
            None => Backend::Memory(Mutex::new(HashMap::new())),
            Some(url) => Backend::Valkey {
                conn: ConnectionManager::new(redis::Client::open(url)?).await?,
                key: format!("{namespace}:watched"),
            },
        };
        Ok(Self {
            backend,
            next: AtomicU64::new(0),
        })
    }

    pub async fn list(&self) -> anyhow::Result<Vec<Title>> {
        let mut titles: Vec<Title> = match &self.backend {
            Backend::Memory(map) => map.lock().unwrap().values().cloned().collect(),
            Backend::Valkey { conn, key } => {
                let raw: HashMap<String, String> = conn.clone().hgetall(key).await?;
                // Skip a row that no longer parses rather than failing the page.
                raw.values()
                    .filter_map(|v| serde_json::from_str(v).ok())
                    .collect()
            }
        };
        titles.sort_by(|a, b| {
            b.input
                .watched
                .cmp(&a.input.watched)
                .then(b.created_at.cmp(&a.created_at))
        });
        Ok(titles)
    }

    async fn len(&self) -> anyhow::Result<usize> {
        Ok(match &self.backend {
            Backend::Memory(map) => map.lock().unwrap().len(),
            Backend::Valkey { conn, key } => conn.clone().hlen(key).await?,
        })
    }

    async fn put(&self, title: &Title) -> anyhow::Result<()> {
        match &self.backend {
            Backend::Memory(map) => {
                map.lock().unwrap().insert(title.id.clone(), title.clone());
            }
            Backend::Valkey { conn, key } => {
                let _: () = conn
                    .clone()
                    .hset(key, &title.id, serde_json::to_string(title)?)
                    .await?;
            }
        }
        Ok(())
    }

    async fn remove(&self, id: &str) -> anyhow::Result<bool> {
        Ok(match &self.backend {
            Backend::Memory(map) => map.lock().unwrap().remove(id).is_some(),
            Backend::Valkey { conn, key } => conn.clone().hdel::<_, _, u32>(key, id).await? > 0,
        })
    }

    fn new_id(&self) -> (String, u64) {
        let ms = now_ms();
        let n = self.next.fetch_add(1, Ordering::Relaxed);
        (format!("t{ms:x}{n:x}"), ms)
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn bad_request(message: String) -> Response {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(json!({ "error": message })),
    )
        .into_response()
}

fn internal(err: anyhow::Error) -> Response {
    tracing::error!(error = %format!("{err:#}"), "watched store failed");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "Could not save. Try again in a moment." })),
    )
        .into_response()
}

/// `GET /api/watched`: newest first.
pub async fn list(State(app): State<AppState>) -> Response {
    match app.watched.list().await {
        Ok(items) => Json(json!({ "items": items })).into_response(),
        Err(err) => internal(err),
    }
}

/// `POST /api/admin/watched`
pub async fn create(State(app): State<AppState>, Json(input): Json<TitleInput>) -> Response {
    let input = match input.validate() {
        Ok(i) => i,
        Err(msg) => return bad_request(msg),
    };
    match app.watched.len().await {
        Ok(n) if n >= MAX_TITLES => {
            return bad_request("The list is full. Delete a few titles first.".into());
        }
        Err(err) => return internal(err),
        Ok(_) => {}
    }
    let (id, created_at) = app.watched.new_id();
    let title = Title {
        id,
        input,
        created_at,
    };
    match app.watched.put(&title).await {
        Ok(()) => (StatusCode::CREATED, Json(title)).into_response(),
        Err(err) => internal(err),
    }
}

/// `PUT /api/admin/watched/{id}`
pub async fn update(
    State(app): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<TitleInput>,
) -> Response {
    let input = match input.validate() {
        Ok(i) => i,
        Err(msg) => return bad_request(msg),
    };
    let existing = match app.watched.list().await {
        Ok(items) => items.into_iter().find(|t| t.id == id),
        Err(err) => return internal(err),
    };
    let Some(existing) = existing else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let title = Title {
        id,
        input,
        created_at: existing.created_at,
    };
    match app.watched.put(&title).await {
        Ok(()) => Json(title).into_response(),
        Err(err) => internal(err),
    }
}

/// `DELETE /api/admin/watched/{id}`
pub async fn delete(State(app): State<AppState>, Path(id): Path<String>) -> Response {
    match app.watched.remove(&id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(err) => internal(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> TitleInput {
        TitleInput {
            title: "  Dune: Part Two ".into(),
            kind: Kind::Movie,
            year: Some(2024),
            rating: 9,
            status: Status::Watched,
            seasons: "1".into(),
            note: String::new(),
            watched: "2026-10-28".into(),
        }
    }

    #[test]
    fn trims_and_drops_seasons_for_movies() {
        let v = input().validate().unwrap();
        assert_eq!(v.title, "Dune: Part Two");
        assert!(v.seasons.is_empty());
    }

    #[test]
    fn rejects_bad_fields() {
        assert!(
            TitleInput {
                rating: 0,
                ..input()
            }
            .validate()
            .is_err()
        );
        assert!(
            TitleInput {
                rating: 11,
                ..input()
            }
            .validate()
            .is_err()
        );
        assert!(
            TitleInput {
                title: " ".into(),
                ..input()
            }
            .validate()
            .is_err()
        );
        assert!(
            TitleInput {
                year: Some(1700),
                ..input()
            }
            .validate()
            .is_err()
        );
        assert!(
            TitleInput {
                watched: "28.10.2026".into(),
                ..input()
            }
            .validate()
            .is_err()
        );
    }

    #[tokio::test]
    async fn store_lists_newest_first() {
        let store = Store::open(None, "t").await.unwrap();
        for (i, day) in ["2026-01-01", "2026-03-01", "2026-02-01"]
            .iter()
            .enumerate()
        {
            let (id, created_at) = store.new_id();
            let input = TitleInput {
                title: format!("t{i}"),
                watched: (*day).into(),
                ..input()
            };
            store
                .put(&Title {
                    id,
                    input,
                    created_at,
                })
                .await
                .unwrap();
        }
        let days: Vec<_> = store
            .list()
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.input.watched)
            .collect();
        assert_eq!(days, ["2026-03-01", "2026-02-01", "2026-01-01"]);
    }
}
