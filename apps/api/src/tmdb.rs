//! Posters for Watched, from The Movie Database (`TMDB_TOKEN`, a read
//! access token). Only the admin searches; visitors get the poster path
//! stored on the title, and the site loads the image through Next.js.

use std::time::Duration;

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use ts_rs::TS;

use crate::{AppState, watched::Kind};

pub struct Tmdb {
    token: String,
    http: reqwest::Client,
}

/// One search result, ready to fill the admin form.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "TmdbHit")]
pub struct Hit {
    pub title: String,
    pub year: Option<u16>,
    pub kind: Kind,
    /// TMDB file path, e.g. `/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg`.
    pub poster: Option<String>,
}

impl Tmdb {
    pub fn new(token: String) -> anyhow::Result<Self> {
        Ok(Self {
            token,
            http: reqwest::Client::builder()
                .user_agent("kewldan.ru watched")
                .timeout(Duration::from_secs(10))
                .build()?,
        })
    }

    async fn get(&self, path: &str, query: &[(&str, String)]) -> anyhow::Result<Value> {
        Ok(self
            .http
            .get(format!("https://api.themoviedb.org/3{path}"))
            .bearer_auth(&self.token)
            .query(query)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }

    /// Films and series matching `q`, the best first.
    pub async fn search(&self, q: &str) -> anyhow::Result<Vec<Hit>> {
        let res = self
            .get(
                "/search/multi",
                &[("query", q.to_owned()), ("include_adult", "false".into())],
            )
            .await?;
        Ok(res["results"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(hit)
            .take(8)
            .collect())
    }

    /// The likeliest match for a title already on the list.
    pub async fn best(
        &self,
        title: &str,
        year: Option<u16>,
        kind: Kind,
    ) -> anyhow::Result<Option<Hit>> {
        let (path, year_key) = match kind {
            Kind::Movie => ("/search/movie", "year"),
            Kind::Series => ("/search/tv", "first_air_date_year"),
        };
        let mut query = vec![("query", title.to_owned())];
        if let Some(y) = year {
            query.push((year_key, y.to_string()));
        }
        let res = self.get(path, &query).await?;
        let kind_tag = if kind == Kind::Movie { "movie" } else { "tv" };
        Ok(res["results"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|r| {
                let mut r = r.clone();
                r["media_type"] = kind_tag.into();
                hit(&r)
            })
            .find(|h| h.poster.is_some()))
    }
}

fn hit(r: &Value) -> Option<Hit> {
    let kind = match r["media_type"].as_str()? {
        "movie" => Kind::Movie,
        "tv" => Kind::Series,
        _ => return None,
    };
    let title = r["title"].as_str().or(r["name"].as_str())?.to_owned();
    let date = r["release_date"]
        .as_str()
        .or(r["first_air_date"].as_str())
        .unwrap_or("");
    Some(Hit {
        title,
        year: date.get(..4).and_then(|y| y.parse().ok()),
        kind,
        poster: r["poster_path"].as_str().map(str::to_owned),
    })
}

/// A TMDB poster path: `/` and a file name, nothing a URL could be bent with.
pub fn valid_poster(path: &str) -> bool {
    path.len() <= 64
        && path.starts_with('/')
        && (path.ends_with(".jpg") || path.ends_with(".png"))
        && path[1..]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
}

#[derive(Deserialize)]
pub struct SearchQuery {
    q: String,
}

fn unavailable() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({ "error": "tmdb" })),
    )
        .into_response()
}

/// `GET /api/admin/tmdb/search?q=`
pub async fn search(State(app): State<AppState>, Query(q): Query<SearchQuery>) -> Response {
    let Some(tmdb) = &app.tmdb else {
        return unavailable();
    };
    let q = q.q.trim();
    if q.is_empty() || q.chars().count() > 100 {
        return Json(Vec::<Hit>::new()).into_response();
    }
    match tmdb.search(q).await {
        Ok(hits) => Json(hits).into_response(),
        Err(err) => {
            tracing::warn!(error = %format!("{err:#}"), "tmdb search failed");
            unavailable()
        }
    }
}

/// `POST /api/admin/watched/posters`: finds a poster for every title that
/// has none. Returns what it filled and what it could not match.
pub async fn backfill(State(app): State<AppState>) -> Response {
    let Some(tmdb) = &app.tmdb else {
        return unavailable();
    };
    let titles = match app.watched.list().await {
        Ok(t) => t,
        Err(err) => {
            tracing::error!(error = %format!("{err:#}"), "watched store failed");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let (mut filled, mut missed) = (0, Vec::new());
    for mut t in titles.into_iter().filter(|t| t.input.poster.is_none()) {
        let found = tmdb.best(&t.input.title, t.input.year, t.input.kind).await;
        match found {
            Ok(Some(Hit {
                poster: Some(p), ..
            })) if valid_poster(&p) => {
                t.input.poster = Some(p);
                if app.watched.save(&t).await.is_ok() {
                    filled += 1;
                }
            }
            Ok(_) => missed.push(t.input.title),
            Err(err) => {
                tracing::warn!(error = %format!("{err:#}"), title = t.input.title, "tmdb lookup failed");
                missed.push(t.input.title);
            }
        }
    }
    Json(json!({ "filled": filled, "missed": missed })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_search_results() {
        let tv = json!({ "media_type": "tv", "name": "Chernobyl", "first_air_date": "2019-05-06", "poster_path": "/a.jpg" });
        let h = hit(&tv).unwrap();
        assert_eq!(
            (h.title.as_str(), h.year, h.kind),
            ("Chernobyl", Some(2019), Kind::Series)
        );
        assert!(hit(&json!({ "media_type": "person", "name": "Nolan" })).is_none());
    }

    #[test]
    fn only_plain_poster_paths() {
        assert!(valid_poster("/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg"));
        assert!(!valid_poster("gEU2.jpg"));
        assert!(!valid_poster("/../x.jpg"));
        assert!(!valid_poster("//evil.com/x.jpg"));
        assert!(!valid_poster("/x.svg"));
    }
}
