//! Live numbers for the content placeholders (`{gh.contributions}`,
//! `{steam.games}`, ...).
//!
//! `content/stats.json` holds the fallback values. A background task refreshes
//! them from GitHub and Steam every few hours; whatever a source cannot
//! provide (no token, an outage) keeps its last known value.

use std::{collections::BTreeMap, sync::RwLock, time::Duration};

use anyhow::Context;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::content::Locale;

pub struct Stats {
    values: RwLock<BTreeMap<String, u64>>,
}

impl Stats {
    pub fn new(defaults: BTreeMap<String, u64>) -> Self {
        Self {
            values: RwLock::new(defaults),
        }
    }

    /// New defaults after a content reload; live values win over them.
    pub fn merge_defaults(&self, defaults: &BTreeMap<String, u64>) {
        let mut values = self.values.write().unwrap();
        for (k, v) in defaults {
            values.entry(k.clone()).or_insert(*v);
        }
    }

    pub fn update(&self, fresh: BTreeMap<String, u64>) {
        if fresh.is_empty() {
            return;
        }
        tracing::info!(?fresh, "stats refreshed");
        self.values.write().unwrap().extend(fresh);
    }

    pub fn snapshot(&self) -> BTreeMap<String, u64> {
        self.values.read().unwrap().clone()
    }

    /// Replaces every known `{key}` in `template` with its number, formatted
    /// for `locale`.
    pub fn render(&self, template: &str, locale: Locale) -> String {
        let values = self.values.read().unwrap();
        let mut out = String::with_capacity(template.len());
        let mut rest = template;
        while let Some(start) = rest.find('{') {
            out.push_str(&rest[..start]);
            let after = &rest[start + 1..];
            match after
                .find('}')
                .and_then(|end| values.get(&after[..end]).map(|v| (end, *v)))
            {
                Some((end, value)) => {
                    out.push_str(&format_number(value, locale));
                    rest = &after[end + 1..];
                }
                None => {
                    out.push('{');
                    rest = after;
                }
            }
        }
        out.push_str(rest);
        out
    }
}

/// `2195` → `2,195` in English, `2 195` (non-breaking space) in Russian.
pub fn format_number(n: u64, locale: Locale) -> String {
    let sep = match locale {
        Locale::En => ",",
        Locale::Ru => "\u{a0}",
    };
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push_str(sep);
        }
        out.push(c);
    }
    out
}

/// Where the live numbers come from. Every credential is optional.
#[derive(Debug, Clone)]
pub struct Sources {
    pub github_login: String,
    /// Read-only token; unlocks contribution counts and private repos.
    pub github_token: Option<String>,
    pub steam_key: Option<String>,
    /// 64-bit SteamID of the profile.
    pub steam_id: Option<String>,
    pub every: Duration,
}

const CS2_APP_ID: u64 = 730;

pub fn spawn_refresh(stats: std::sync::Arc<Stats>, sources: Sources) {
    tokio::spawn(async move {
        let http = match reqwest::Client::builder()
            .user_agent("kewldan.ru stats (github.com/kewldan/kewldan.ru)")
            .timeout(Duration::from_secs(20))
            .build()
        {
            Ok(c) => c,
            Err(err) => return tracing::error!(%err, "stats: no HTTP client"),
        };
        let mut tick = tokio::time::interval(sources.every);
        loop {
            tick.tick().await;
            match github(&http, &sources).await {
                Ok(fresh) => stats.update(fresh),
                Err(err) => {
                    tracing::warn!(error = %format!("{err:#}"), "stats: GitHub refresh failed")
                }
            }
            if let (Some(key), Some(id)) = (&sources.steam_key, &sources.steam_id) {
                match steam(&http, key, id).await {
                    Ok(fresh) => stats.update(fresh),
                    Err(err) => {
                        tracing::warn!(error = %format!("{err:#}"), "stats: Steam refresh failed")
                    }
                }
            }
        }
    });
}

async fn github(http: &reqwest::Client, src: &Sources) -> anyhow::Result<BTreeMap<String, u64>> {
    let now = time_now();
    match &src.github_token {
        Some(token) => github_graphql(http, &src.github_login, token, now).await,
        None => github_public(http, &src.github_login, now).await,
    }
}

/// With a token: the whole picture, private work included.
async fn github_graphql(
    http: &reqwest::Client,
    login: &str,
    token: &str,
    now: Instant,
) -> anyhow::Result<BTreeMap<String, u64>> {
    const QUERY: &str = r"
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    createdAt
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar { totalContributions }
      restrictedContributionsCount
      totalPullRequestContributions
      commitContributionsByRepository(maxRepositories: 100) {
        repository { isPrivate }
        contributions { totalCount }
      }
    }
    pub: repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount }
    priv: repositories(privacy: PRIVATE, ownerAffiliations: OWNER) { totalCount }
  }
}";
    let body = json!({
        "query": QUERY,
        "variables": { "login": login, "from": now.year_ago_iso(), "to": now.iso() },
    });
    let res: Value = http
        .post("https://api.github.com/graphql")
        .bearer_auth(token)
        .json(&body)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    if let Some(errors) = res.get("errors") {
        anyhow::bail!("GraphQL: {errors}");
    }
    let user = &res["data"]["user"];
    let cc = &user["contributionsCollection"];
    let n = |v: &Value| v.as_u64().context("missing number");

    let total = n(&cc["contributionCalendar"]["totalContributions"])?;
    // Private work: what the token cannot itemise plus commits in private repos.
    let private_commits: u64 = cc["commitContributionsByRepository"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|r| r["repository"]["isPrivate"].as_bool() == Some(true))
        .filter_map(|r| r["contributions"]["totalCount"].as_u64())
        .sum();
    let private = (n(&cc["restrictedContributionsCount"])? + private_commits).min(total);

    let mut out = BTreeMap::new();
    out.insert("gh.contributions".into(), total);
    out.insert("gh.private".into(), private);
    out.insert("gh.public".into(), total - private);
    out.insert("gh.prs".into(), n(&cc["totalPullRequestContributions"])?);
    out.insert("gh.repos_public".into(), n(&user["pub"]["totalCount"])?);
    out.insert("gh.repos_private".into(), n(&user["priv"]["totalCount"])?);
    if let Some(created) = user["createdAt"].as_str() {
        out.insert("gh.years".into(), now.years_since(created));
    }
    Ok(out)
}

/// Without a token: what the public REST API tells anyone.
async fn github_public(
    http: &reqwest::Client,
    login: &str,
    now: Instant,
) -> anyhow::Result<BTreeMap<String, u64>> {
    #[derive(Deserialize)]
    struct User {
        public_repos: u64,
        created_at: String,
    }
    #[derive(Deserialize)]
    struct Search {
        total_count: u64,
    }
    let user: User = http
        .get(format!("https://api.github.com/users/{login}"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let prs: Search = http
        .get("https://api.github.com/search/issues")
        .query(&[(
            "q",
            format!(
                "author:{login} type:pr created:>={}",
                &now.year_ago_iso()[..10]
            ),
        )])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let mut out = BTreeMap::new();
    out.insert("gh.repos_public".into(), user.public_repos);
    out.insert("gh.years".into(), now.years_since(&user.created_at));
    out.insert("gh.prs".into(), prs.total_count);
    Ok(out)
}

async fn steam(
    http: &reqwest::Client,
    key: &str,
    id: &str,
) -> anyhow::Result<BTreeMap<String, u64>> {
    let games: Value = http
        .get("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/")
        .query(&[
            ("key", key),
            ("steamid", id),
            ("include_played_free_games", "1"),
        ])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let level: Value = http
        .get("https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/")
        .query(&[("key", key), ("steamid", id)])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let response = &games["response"];
    let count = response["game_count"]
        .as_u64()
        .context("profile or game details are private")?;
    let mut out = BTreeMap::new();
    out.insert("steam.games".into(), count);
    if let Some(minutes) = response["games"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|g| g["appid"].as_u64() == Some(CS2_APP_ID))
        .and_then(|g| g["playtime_forever"].as_u64())
    {
        out.insert("steam.cs2".into(), minutes / 60);
    }
    if let Some(l) = level["response"]["player_level"].as_u64() {
        out.insert("steam.level".into(), l);
    }
    Ok(out)
}

/// Just enough calendar maths for "a year ago" and "years since", without a
/// date crate.
#[derive(Clone, Copy)]
struct Instant {
    year: i64,
    month: u32,
    day: u32,
    secs_of_day: u64,
}

fn time_now() -> Instant {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let (year, month, day) = civil_from_days((secs / 86_400) as i64);
    Instant {
        year,
        month,
        day,
        secs_of_day: secs % 86_400,
    }
}

/// Howard Hinnant's days → (year, month, day).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

impl Instant {
    fn iso(self) -> String {
        let s = self.secs_of_day;
        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
            self.year,
            self.month,
            self.day,
            s / 3600,
            s / 60 % 60,
            s % 60
        )
    }

    fn year_ago_iso(self) -> String {
        // 29 February a year ago does not exist; the 28th is close enough.
        let day = if self.month == 2 && self.day == 29 {
            28
        } else {
            self.day
        };
        Instant {
            year: self.year - 1,
            day,
            ..self
        }
        .iso()
    }

    /// Whole years since an ISO date like `2018-07-14T10:00:00Z`.
    fn years_since(self, iso: &str) -> u64 {
        let part =
            |r: std::ops::Range<usize>| iso.get(r).and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        let (y, m, d) = (part(0..4), part(5..7), part(8..10));
        let mut years = self.year - y;
        if (i64::from(self.month), i64::from(self.day)) < (m, d) {
            years -= 1;
        }
        years.max(0) as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats() -> Stats {
        Stats::new(BTreeMap::from([
            ("gh.contributions".into(), 2195),
            ("steam.games".into(), 90),
        ]))
    }

    #[test]
    fn formats_per_locale() {
        assert_eq!(format_number(2195, Locale::En), "2,195");
        assert_eq!(format_number(2195, Locale::Ru), "2\u{a0}195");
        assert_eq!(format_number(1_234_567, Locale::En), "1,234,567");
        assert_eq!(format_number(42, Locale::Ru), "42");
    }

    #[test]
    fn renders_known_keys_only() {
        let out = stats().render(
            r#"{"v":"{gh.contributions}","s":"{steam.games} games {x}"}"#,
            Locale::En,
        );
        assert_eq!(out, r#"{"v":"2,195","s":"90 games {x}"}"#);
    }

    #[test]
    fn live_values_beat_defaults() {
        let s = stats();
        s.update(BTreeMap::from([("gh.contributions".into(), 3000)]));
        s.merge_defaults(&BTreeMap::from([
            ("gh.contributions".into(), 1),
            ("gh.prs".into(), 65),
        ]));
        let snap = s.snapshot();
        assert_eq!(snap["gh.contributions"], 3000);
        assert_eq!(snap["gh.prs"], 65);
    }

    #[test]
    fn calendar_maths() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_754), (2026, 10, 28));
        let now = Instant {
            year: 2026,
            month: 10,
            day: 28,
            secs_of_day: 3661,
        };
        assert_eq!(now.iso(), "2026-10-28T01:01:01Z");
        assert_eq!(now.year_ago_iso(), "2025-10-28T01:01:01Z");
        assert_eq!(now.years_since("2018-07-14T10:00:00Z"), 8);
        assert_eq!(now.years_since("2018-11-01T10:00:00Z"), 7);
    }
}
