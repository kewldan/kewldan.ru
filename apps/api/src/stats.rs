//! Live numbers for the content placeholders (`{gh.contributions}`,
//! `{steam.games}`, ...).
//!
//! `content/stats.json` holds the fallback values. A background task refreshes
//! them from GitHub and Steam every few hours; whatever a source cannot
//! provide (no token, an outage) keeps its last known value.

use std::{collections::BTreeMap, sync::RwLock, time::Duration};

use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use ts_rs::TS;

pub struct Stats {
    values: RwLock<BTreeMap<String, u64>>,
    calendar: RwLock<Option<Calendar>>,
}

/// The last year of GitHub contributions, one count per day.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Calendar {
    pub total: u32,
    /// `YYYY-MM-DD` of `days[0]`. GitHub weeks run Sunday to Saturday, and
    /// the first one is usually partial.
    pub start: String,
    pub days: Vec<u16>,
}

impl Stats {
    pub fn new(defaults: BTreeMap<String, u64>) -> Self {
        Self {
            values: RwLock::new(defaults),
            calendar: RwLock::new(None),
        }
    }

    /// `None` until GitHub has answered with a token at least once.
    pub fn calendar(&self) -> Option<Calendar> {
        self.calendar.read().unwrap().clone()
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
    /// ("2,195").
    pub fn render(&self, template: &str) -> String {
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
                    out.push_str(&format_number(value));
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

/// `2195` → `2,195`.
pub fn format_number(n: u64) -> String {
    let sep = ",";
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
    /// 64-bit SteamIDs; several accounts are merged into one set of numbers.
    pub steam_ids: Vec<String>,
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
                Ok((fresh, calendar)) => {
                    stats.update(fresh);
                    if calendar.is_some() {
                        *stats.calendar.write().unwrap() = calendar;
                    }
                }
                Err(err) => {
                    tracing::warn!(error = %format!("{err:#}"), "stats: GitHub refresh failed")
                }
            }
            if let Some(key) = sources
                .steam_key
                .as_deref()
                .filter(|_| !sources.steam_ids.is_empty())
            {
                match steam(&http, key, &sources.steam_ids).await {
                    Ok(fresh) => stats.update(fresh),
                    Err(err) => {
                        tracing::warn!(error = %format!("{err:#}"), "stats: Steam refresh failed")
                    }
                }
            }
        }
    });
}

type GithubFresh = (BTreeMap<String, u64>, Option<Calendar>);

async fn github(http: &reqwest::Client, src: &Sources) -> anyhow::Result<GithubFresh> {
    let now = time_now();
    match &src.github_token {
        Some(token) => github_graphql(http, &src.github_login, token, now).await,
        None => Ok((github_public(http, &src.github_login, now).await?, None)),
    }
}

/// With a token: the whole picture, private work included.
async fn github_graphql(
    http: &reqwest::Client,
    login: &str,
    token: &str,
    now: Instant,
) -> anyhow::Result<GithubFresh> {
    const MAIN: &str = r"
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    createdAt
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
      restrictedContributionsCount
      totalPullRequestContributions
    }
    pub: repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount }
    priv: repositories(privacy: PRIVATE, ownerAffiliations: OWNER) { totalCount }
  }
}";
    // Asked separately: it touches every repository, and one organisation
    // refusing the token (e.g. over its lifetime) nulls the whole answer.
    const BY_REPO: &str = r"
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      commitContributionsByRepository(maxRepositories: 100) {
        repository { isPrivate }
        contributions { totalCount }
      }
    }
  }
}";
    let vars = json!({ "login": login, "from": now.year_ago_iso(), "to": now.iso() });
    let res = graphql(http, token, MAIN, &vars).await?;
    let user = &res["user"];
    let cc = &user["contributionsCollection"];
    let n = |v: &Value| v.as_u64().context("missing number");

    let total = n(&cc["contributionCalendar"]["totalContributions"])?;
    // Private work: what the token cannot itemise plus commits in private repos.
    let private_commits: u64 = match graphql(http, token, BY_REPO, &vars).await {
        Ok(by_repo) => {
            by_repo["user"]["contributionsCollection"]["commitContributionsByRepository"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|r| r["repository"]["isPrivate"].as_bool() == Some(true))
                .filter_map(|r| r["contributions"]["totalCount"].as_u64())
                .sum()
        }
        Err(err) => {
            tracing::warn!(error = %format!("{err:#}"), "stats: per-repo contributions unavailable");
            0
        }
    };
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
    Ok((out, parse_calendar(&cc["contributionCalendar"])))
}

/// GitHub's `weeks[].contributionDays[]` flattened into one run of days.
fn parse_calendar(cal: &Value) -> Option<Calendar> {
    let days: Vec<&Value> = cal["weeks"]
        .as_array()?
        .iter()
        .filter_map(|w| w["contributionDays"].as_array())
        .flatten()
        .collect();
    Some(Calendar {
        total: u32::try_from(cal["totalContributions"].as_u64()?).ok()?,
        start: days.first()?["date"].as_str()?.to_owned(),
        days: days
            .iter()
            .map(|d| {
                d["contributionCount"]
                    .as_u64()
                    .map_or(0, |n| n.min(u16::MAX.into()) as u16)
            })
            .collect(),
    })
}

/// One GraphQL request; `data` on success, an error if GitHub sent any.
async fn graphql(
    http: &reqwest::Client,
    token: &str,
    query: &str,
    vars: &Value,
) -> anyhow::Result<Value> {
    let res: Value = http
        .post("https://api.github.com/graphql")
        .bearer_auth(token)
        .json(&json!({ "query": query, "variables": vars }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    if let Some(errors) = res.get("errors") {
        anyhow::bail!("GraphQL: {errors}");
    }
    Ok(res["data"].clone())
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

/// One account's library: app id → minutes played, plus its Steam level.
struct Library {
    playtime: BTreeMap<u64, u64>,
    level: Option<u64>,
}

async fn steam_library(http: &reqwest::Client, key: &str, id: &str) -> anyhow::Result<Library> {
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
    let list = games["response"]["games"]
        .as_array()
        .with_context(|| format!("{id}: profile or game details are private"))?;
    let playtime = list
        .iter()
        .filter_map(|g| {
            Some((
                g["appid"].as_u64()?,
                g["playtime_forever"].as_u64().unwrap_or(0),
            ))
        })
        .collect();
    Ok(Library {
        playtime,
        level: level["response"]["player_level"].as_u64(),
    })
}

/// Several accounts as one: a game owned twice counts once, hours add up,
/// and the level is the highest of them.
fn merge_libraries(libraries: &[Library]) -> BTreeMap<String, u64> {
    let mut playtime: BTreeMap<u64, u64> = BTreeMap::new();
    for lib in libraries {
        for (app, minutes) in &lib.playtime {
            *playtime.entry(*app).or_default() += minutes;
        }
    }
    let mut out = BTreeMap::new();
    out.insert("steam.games".into(), playtime.len() as u64);
    if let Some(minutes) = playtime.get(&CS2_APP_ID) {
        out.insert("steam.cs2".into(), minutes / 60);
    }
    if let Some(level) = libraries.iter().filter_map(|l| l.level).max() {
        out.insert("steam.level".into(), level);
    }
    out
}

async fn steam(
    http: &reqwest::Client,
    key: &str,
    ids: &[String],
) -> anyhow::Result<BTreeMap<String, u64>> {
    let mut libraries = Vec::new();
    for id in ids {
        match steam_library(http, key, id).await {
            Ok(lib) => libraries.push(lib),
            // One private account should not hide the others.
            Err(err) => {
                tracing::warn!(error = %format!("{err:#}"), "stats: skipping a Steam account")
            }
        }
    }
    anyhow::ensure!(!libraries.is_empty(), "no Steam account could be read");
    Ok(merge_libraries(&libraries))
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
    fn formats_thousands() {
        assert_eq!(format_number(2195), "2,195");
        assert_eq!(format_number(1_234_567), "1,234,567");
        assert_eq!(format_number(42), "42");
    }

    #[test]
    fn renders_known_keys_only() {
        let out = stats().render(r#"{"v":"{gh.contributions}","s":"{steam.games} games {x}"}"#);
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
    fn merges_steam_accounts() {
        let a = Library {
            playtime: BTreeMap::from([(CS2_APP_ID, 600), (427_520, 60)]),
            level: Some(12),
        };
        let b = Library {
            playtime: BTreeMap::from([(CS2_APP_ID, 120), (548_430, 30)]),
            level: Some(5),
        };
        let out = merge_libraries(&[a, b]);
        assert_eq!(out["steam.games"], 3, "CS2 on both accounts counts once");
        assert_eq!(out["steam.cs2"], 12, "10 h + 2 h");
        assert_eq!(out["steam.level"], 12);
    }

    #[test]
    fn flattens_the_contribution_calendar() {
        let cal = json!({
            "totalContributions": 7,
            "weeks": [
                { "contributionDays": [{ "date": "2025-10-26", "contributionCount": 1 }] },
                { "contributionDays": [
                    { "date": "2025-11-02", "contributionCount": 0 },
                    { "date": "2025-11-03", "contributionCount": 6 }
                ] }
            ]
        });
        assert_eq!(
            parse_calendar(&cal),
            Some(Calendar {
                total: 7,
                start: "2025-10-26".into(),
                days: vec![1, 0, 6],
            })
        );
        assert_eq!(parse_calendar(&json!({})), None);
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
