//! Runtime configuration from environment variables.

use std::{net::SocketAddr, path::PathBuf};

use axum::http::HeaderValue;

#[derive(Debug, Clone)]
pub struct Config {
    /// `ADDR`, default `0.0.0.0:8080`.
    pub addr: SocketAddr,
    /// `VALKEY_URL`, e.g. `redis://valkey:6379`. Unset keeps the board in
    /// memory.
    pub valkey_url: Option<String>,
    /// `VALKEY_NAMESPACE`, default `px`: prefix for the board key and channel.
    pub valkey_namespace: String,
    /// `CONTENT_DIR` with `en.json`, `ru.json` and `stats.json`. Unset
    /// serves the copies compiled into the binary.
    pub content_dir: Option<PathBuf>,
    /// `GITHUB_LOGIN` (default `kewldan`), `GITHUB_TOKEN`, `STEAM_API_KEY`,
    /// `STEAM_ID` (comma-separated) and/or `STEAM_ID1`..`STEAM_ID9`,
    /// `STATS_REFRESH_SECS` (default 6 hours).
    pub stats: crate::stats::Sources,
    /// `STATS_REFRESH=0` turns the background refresh off (tests, offline).
    pub stats_refresh: bool,
    /// `ADMIN_TOKEN`. Unset disables every `/api/admin` route.
    pub admin_token: Option<String>,
    /// `WEBAUTHN_ORIGIN`, where the site is served; passkeys are bound to its
    /// host. Default `http://localhost:3000` for development.
    pub webauthn_origin: String,
    /// `ALLOWED_ORIGINS`, comma separated. Empty allows any origin, which is
    /// only meant for development.
    pub allowed_origins: Vec<String>,
    /// `TRUST_PROXY=1` reads the client IP from `X-Forwarded-For` (behind
    /// Traefik).
    pub trust_proxy: bool,
    /// `LOG_FORMAT=json` for structured logs.
    pub json_logs: bool,
    /// `TELEGRAM_BOT_TOKEN` for the contact form, and `TELEGRAM_OWNER` (default
    /// `kewldan`): the username whose `/start` makes the bot deliver to them.
    pub telegram: Option<crate::contact::Telegram>,
    /// `TMDB_TOKEN`, a read access token: posters for Watched.
    pub tmdb_token: Option<String>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        Ok(Self {
            addr: var("ADDR")
                .unwrap_or_else(|| "0.0.0.0:8080".into())
                .parse()?,
            valkey_url: var("VALKEY_URL"),
            valkey_namespace: var("VALKEY_NAMESPACE").unwrap_or_else(|| "px".into()),
            content_dir: var("CONTENT_DIR").map(PathBuf::from),
            stats: crate::stats::Sources {
                github_login: var("GITHUB_LOGIN").unwrap_or_else(|| "kewldan".into()),
                github_token: var("GITHUB_TOKEN"),
                steam_key: var("STEAM_API_KEY"),
                // STEAM_ID may list several ids; STEAM_ID1..9 add more.
                steam_ids: {
                    let mut ids: Vec<String> = std::iter::once(var("STEAM_ID"))
                        .chain((1..=9).map(|i| var(&format!("STEAM_ID{i}"))))
                        .flatten()
                        .flat_map(|v| {
                            v.split(',')
                                .map(|s| s.trim().to_owned())
                                .collect::<Vec<_>>()
                        })
                        .filter(|s| !s.is_empty())
                        .collect();
                    ids.sort();
                    ids.dedup();
                    ids
                },
                every: std::time::Duration::from_secs(
                    var("STATS_REFRESH_SECS")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(6 * 3600),
                ),
            },
            stats_refresh: var("STATS_REFRESH").is_none_or(|v| v != "0"),
            admin_token: var("ADMIN_TOKEN"),
            webauthn_origin: var("WEBAUTHN_ORIGIN")
                .unwrap_or_else(|| "http://localhost:3000".into()),
            allowed_origins: var("ALLOWED_ORIGINS")
                .map(|v| {
                    v.split(',')
                        .map(|s| s.trim().trim_end_matches('/').to_owned())
                        .collect()
                })
                .unwrap_or_default(),
            trust_proxy: var("TRUST_PROXY").is_some_and(|v| v == "1" || v == "true"),
            json_logs: var("LOG_FORMAT").is_some_and(|v| v == "json"),
            telegram: var("TELEGRAM_BOT_TOKEN").map(|token| crate::contact::Telegram {
                token,
                owner: var("TELEGRAM_OWNER").unwrap_or_else(|| "kewldan".into()),
            }),
            tmdb_token: var("TMDB_TOKEN"),
        })
    }

    /// Settings for tests: in-memory board, embedded content, any origin.
    pub fn for_tests() -> Self {
        Self {
            addr: "127.0.0.1:0".parse().unwrap(),
            valkey_url: None,
            valkey_namespace: "px".into(),
            content_dir: None,
            stats: crate::stats::Sources {
                github_login: "kewldan".into(),
                github_token: None,
                steam_key: None,
                steam_ids: Vec::new(),
                every: std::time::Duration::from_secs(3600),
            },
            stats_refresh: false,
            admin_token: Some("test-token".into()),
            webauthn_origin: "http://localhost:3000".into(),
            allowed_origins: Vec::new(),
            trust_proxy: false,
            json_logs: false,
            telegram: None,
            tmdb_token: None,
        }
    }

    pub fn origin_allowed(&self, origin: Option<&HeaderValue>) -> bool {
        if self.allowed_origins.is_empty() {
            return true;
        }
        origin
            .and_then(|o| o.to_str().ok())
            .is_some_and(|o| self.allowed_origins.iter().any(|a| a == o))
    }
}
