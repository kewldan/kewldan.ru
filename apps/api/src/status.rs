//! Live status of the projects with a public URL. Every `probe` in the content
//! is checked every few minutes, and the site shows a dot next to it.

use std::{
    collections::BTreeMap,
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};

use futures_util::future::join_all;
use serde::Serialize;
use ts_rs::TS;

use crate::content::Library;

const EVERY: Duration = Duration::from_secs(180);
const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "ProbeStatus")]
pub struct Probe {
    pub up: bool,
    /// Response time of the last check.
    pub ms: u32,
    /// Unix ms when `up` last changed (or when this process first checked).
    #[ts(type = "number")]
    pub since: u64,
    #[ts(type = "number")]
    pub checked: u64,
}

#[derive(Default)]
pub struct Monitor {
    results: RwLock<BTreeMap<String, Probe>>,
}

impl Monitor {
    pub fn snapshot(&self) -> BTreeMap<String, Probe> {
        self.results.read().unwrap().clone()
    }

    fn record(&self, url: &str, up: bool, ms: u32, now: u64) {
        let mut results = self.results.write().unwrap();
        let since = match results.get(url) {
            Some(prev) if prev.up == up => prev.since,
            _ => now,
        };
        results.insert(
            url.to_owned(),
            Probe {
                up,
                ms,
                since,
                checked: now,
            },
        );
    }

    /// Forgets URLs the content no longer mentions.
    fn retain(&self, urls: &[String]) {
        self.results
            .write()
            .unwrap()
            .retain(|url, _| urls.contains(url));
    }
}

pub fn spawn(monitor: Arc<Monitor>, content: Arc<RwLock<Arc<Library>>>) {
    tokio::spawn(async move {
        let http = match reqwest::Client::builder()
            .user_agent("kewldan.ru status (github.com/kewldan/kewldan.ru)")
            .timeout(TIMEOUT)
            .build()
        {
            Ok(c) => c,
            Err(err) => return tracing::error!(%err, "status: no HTTP client"),
        };
        let mut tick = tokio::time::interval(EVERY);
        loop {
            tick.tick().await;
            let urls = content.read().unwrap().snapshot.content.probes();
            monitor.retain(&urls);
            let http = &http;
            let checks = urls.iter().map(|url| async move {
                let (up, ms) = check_twice(http, url).await;
                (url, up, ms)
            });
            for (url, up, ms) in join_all(checks).await {
                if !up {
                    tracing::warn!(url, "status: probe is down");
                }
                monitor.record(url, up, ms, crate::unix_ms());
            }
        }
    });
}

/// A second try before calling a site down, so one dropped packet does not
/// flip the dot.
async fn check_twice(http: &reqwest::Client, url: &str) -> (bool, u32) {
    let first = check(http, url).await;
    if first.0 {
        return first;
    }
    tokio::time::sleep(Duration::from_secs(2)).await;
    check(http, url).await
}

/// Up means any answer below 400, after redirects.
async fn check(http: &reqwest::Client, url: &str) -> (bool, u32) {
    let started = Instant::now();
    let up = http
        .get(url)
        .send()
        .await
        .is_ok_and(|res| res.status().as_u16() < 400);
    let ms = u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX);
    (up, ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn since_moves_only_when_the_state_flips() {
        let m = Monitor::default();
        m.record("https://a", true, 80, 1_000);
        m.record("https://a", true, 90, 2_000);
        assert_eq!(m.snapshot()["https://a"].since, 1_000);
        m.record("https://a", false, 10_000, 3_000);
        let down = &m.snapshot()["https://a"];
        assert_eq!((down.up, down.since, down.checked), (false, 3_000, 3_000));
        m.retain(&[]);
        assert!(m.snapshot().is_empty());
    }
}
