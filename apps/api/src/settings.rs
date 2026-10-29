//! What the admin changes about the site without a deploy: which blocks
//! show, the hero headline and marquee, the featured projects' order and
//! visibility, the pixel board's rules and whether `ADMIN_TOKEN` still
//! signs in. One JSON document (`{ns}:settings`) in Valkey, or in memory;
//! [`Settings::apply`] lays it over the content every response serves.

use std::sync::RwLock;

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use redis::{AsyncCommands, aio::ConnectionManager};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use ts_rs::TS;

use crate::{AppState, pixels::Rules};

const MAX_WORDS: usize = 20;
const MAX_PROJECTS: usize = 64;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
#[ts(export, rename = "SiteSettings")]
pub struct Settings {
    /// The live "Open to offers" line in the hero.
    pub open_to_offers: bool,
    /// The "Отчислиться" button at the bottom.
    pub dropout: bool,
    /// The pixel battle after the hero, and its menu link.
    pub pixels: bool,
    /// Watched in the menu.
    pub watched_in_nav: bool,
    /// Replaces the hero headline, same markup: `==box==`, `_dim_`.
    pub headline: Option<String>,
    /// Replaces the marquee words.
    pub marquee: Option<Vec<String>>,
    /// Featured project ids, first to last; unlisted ones follow in their
    /// usual order.
    pub project_order: Vec<String>,
    /// Featured projects left off the slides. Their case pages still work.
    pub hidden_projects: Vec<String>,
    pub board: Rules,
    /// Off means passkeys only: the bearer token no longer opens the admin.
    pub token_sign_in: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            open_to_offers: true,
            dropout: true,
            pixels: true,
            watched_in_nav: true,
            headline: None,
            marquee: None,
            project_order: Vec::new(),
            hidden_projects: Vec::new(),
            board: Rules::default(),
            token_sign_in: true,
        }
    }
}

impl Settings {
    /// Trims and checks every field. Errors are codes the admin translates.
    fn validate(mut self) -> Result<Self, &'static str> {
        self.headline = self
            .headline
            .map(|h| h.trim().to_owned())
            .filter(|h| !h.is_empty());
        if self
            .headline
            .as_ref()
            .is_some_and(|h| h.chars().count() > 120)
        {
            return Err("headline");
        }
        if let Some(words) = &mut self.marquee {
            words.iter_mut().for_each(|w| *w = w.trim().to_owned());
            words.retain(|w| !w.is_empty());
            if words.len() > MAX_WORDS || words.iter().any(|w| w.chars().count() > 40) {
                return Err("marquee");
            }
        }
        let ids_ok = |ids: &[String]| {
            ids.len() <= MAX_PROJECTS && ids.iter().all(|id| !id.is_empty() && id.len() <= 64)
        };
        if !ids_ok(&self.project_order) || !ids_ok(&self.hidden_projects) {
            return Err("projects");
        }
        let b = &self.board;
        if !(1..=500).contains(&b.ink_max) || !(0.1..=50.0).contains(&b.ink_regen) {
            return Err("board");
        }
        Ok(self)
    }

    /// Lays the settings over the content JSON the API serves.
    pub fn apply(&self, content: &mut Value) {
        let mut hidden: Vec<&str> = Vec::new();
        if !self.open_to_offers
            && let Some(meta) = content
                .pointer_mut("/hero/meta")
                .and_then(Value::as_array_mut)
        {
            meta.retain(|m| m["live"] != Value::Bool(true));
        }
        if let Some(h) = &self.headline {
            content["hero"]["headline"] = json!(h);
        }
        if let Some(words) = &self.marquee {
            content["marquee"] = json!(words);
        }
        if !self.pixels {
            hidden.push("pixels");
        }
        if !self.dropout {
            hidden.push("dropout");
        }
        if let Some(nav) = content["nav"].as_array_mut() {
            nav.retain(|l| match l["href"].as_str() {
                Some("#pixels") => self.pixels,
                Some("/watched") => self.watched_in_nav,
                _ => true,
            });
        }
        if let Some(projects) = content
            .pointer_mut("/work/projects")
            .and_then(Value::as_array_mut)
        {
            let rank = |p: &Value| {
                let id = p["id"].as_str().unwrap_or_default();
                self.project_order
                    .iter()
                    .position(|o| o == id)
                    .unwrap_or(usize::MAX)
            };
            // Stable, so unlisted projects keep their order after the listed.
            projects.sort_by_key(rank);
            for p in projects.iter_mut() {
                let id = p["id"].as_str().unwrap_or_default();
                if self.hidden_projects.iter().any(|h| h == id) {
                    p["hidden"] = json!(true);
                }
            }
        }
        if !hidden.is_empty() {
            content["hidden"] = json!(hidden);
        }
    }
}

enum Backend {
    Memory,
    Valkey {
        conn: ConnectionManager,
        key: String,
    },
}

pub struct Store {
    backend: Backend,
    /// Read on every content request, so kept here rather than fetched.
    current: RwLock<Settings>,
}

impl Store {
    pub async fn open(valkey_url: Option<&str>, ns: &str) -> anyhow::Result<Self> {
        let (backend, current) = match valkey_url {
            None => (Backend::Memory, Settings::default()),
            Some(url) => {
                let mut conn = ConnectionManager::new(redis::Client::open(url)?).await?;
                let key = format!("{ns}:settings");
                let raw: Option<String> = conn.get(&key).await?;
                // A document from an older version loses unknown fields
                // rather than the whole site's settings.
                let current = raw
                    .and_then(|r| serde_json::from_str::<Value>(&r).ok())
                    .map(|mut v| {
                        if let Some(o) = v.as_object_mut() {
                            let known = serde_json::to_value(Settings::default())
                                .expect("settings serialize");
                            o.retain(|k, _| known.get(k).is_some());
                        }
                        serde_json::from_value(v).unwrap_or_default()
                    })
                    .unwrap_or_default();
                (Backend::Valkey { conn, key }, current)
            }
        };
        Ok(Self {
            backend,
            current: RwLock::new(current),
        })
    }

    pub fn get(&self) -> Settings {
        self.current.read().unwrap().clone()
    }

    pub async fn save(&self, next: Settings) -> anyhow::Result<()> {
        if let Backend::Valkey { conn, key } = &self.backend {
            let _: () = conn.clone().set(key, serde_json::to_string(&next)?).await?;
        }
        *self.current.write().unwrap() = next;
        Ok(())
    }
}

fn fail(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({ "error": code }))).into_response()
}

/// `GET /api/admin/settings`
pub async fn get(State(app): State<AppState>) -> Json<Settings> {
    Json(app.settings.get())
}

/// `PUT /api/admin/settings`: saves, applies the board rules and tells the
/// site to drop its cached content.
pub async fn put(State(app): State<AppState>, Json(next): Json<Settings>) -> Response {
    let next = match next.validate() {
        Ok(s) => s,
        Err(code) => return fail(StatusCode::UNPROCESSABLE_ENTITY, code),
    };
    if !next.token_sign_in && !app.auth.has_passkeys().await {
        // Without a passkey there would be no way back in.
        return fail(StatusCode::CONFLICT, "no_passkeys");
    }
    let before = app.settings.get();
    if let Err(err) = app.settings.save(next.clone()).await {
        tracing::error!(error = %format!("{err:#}"), "settings save failed");
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "save");
    }
    if before.board != next.board {
        app.hub.set_rules(next.board).await;
    }
    if before.token_sign_in != next.token_sign_in {
        app.auth
            .log(
                true,
                if next.token_sign_in {
                    "token sign-in on"
                } else {
                    "token sign-in off"
                },
                None,
            )
            .await;
    }
    crate::revalidate_site(&app);
    Json(next).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content() -> Value {
        json!({
            "nav": [{ "href": "#pixels" }, { "href": "#work" }, { "href": "/watched" }],
            "marquee": ["A"],
            "hero": { "headline": "old", "meta": [{ "title": "x" }, { "title": "Open", "live": true }] },
            "work": { "projects": [{ "id": "a" }, { "id": "b" }, { "id": "c" }] }
        })
    }

    #[test]
    fn defaults_leave_the_content_alone() {
        let mut c = content();
        Settings::default().apply(&mut c);
        assert_eq!(c, content());
    }

    #[test]
    fn overrides_reach_the_content() {
        let s = Settings {
            open_to_offers: false,
            pixels: false,
            dropout: false,
            watched_in_nav: false,
            headline: Some("new ==one==".into()),
            marquee: Some(vec!["B".into(), "C".into()]),
            project_order: vec!["c".into(), "a".into()],
            hidden_projects: vec!["a".into()],
            ..Settings::default()
        };
        let mut c = content();
        s.apply(&mut c);
        assert_eq!(c["nav"], json!([{ "href": "#work" }]));
        assert_eq!(c["hero"]["meta"], json!([{ "title": "x" }]));
        assert_eq!(c["hero"]["headline"], "new ==one==");
        assert_eq!(c["marquee"], json!(["B", "C"]));
        assert_eq!(
            c["work"]["projects"],
            json!([{ "id": "c" }, { "id": "a", "hidden": true }, { "id": "b" }])
        );
        assert_eq!(c["hidden"], json!(["pixels", "dropout"]));
    }

    #[test]
    fn rejects_what_would_break_the_page() {
        let long = Settings {
            headline: Some("x".repeat(121)),
            ..Settings::default()
        };
        assert_eq!(long.validate(), Err("headline"));
        let blank = Settings {
            headline: Some("  ".into()),
            marquee: Some(vec![" ".into(), "OK".into()]),
            ..Settings::default()
        }
        .validate()
        .unwrap();
        assert_eq!(
            (blank.headline, blank.marquee),
            (None, Some(vec!["OK".into()]))
        );
        let mut ink = Settings::default();
        ink.board.ink_max = 0;
        assert_eq!(ink.validate(), Err("board"));
    }
}
