//! What I'm listening to, from Spotify (`SPOTIFY_CLIENT_ID`,
//! `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`; the token comes from
//! `scripts/spotify-token.mjs`). The refresh token buys hour-long access
//! tokens; the answer is cached briefly, so visitors never reach Spotify.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::{
    Json,
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::AppState;

/// How long one answer is served before Spotify is asked again.
const FRESH: Duration = Duration::from_secs(15);

#[derive(Debug, Clone)]
pub struct Credentials {
    pub client_id: String,
    pub client_secret: String,
    pub refresh_token: String,
}

/// A track playing now, or the last one played.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "NowPlaying")]
pub struct Track {
    /// Playing right now; otherwise the last track played.
    pub playing: bool,
    pub title: String,
    pub artists: String,
    pub album: String,
    /// Album cover, about 300 px.
    pub image: Option<String>,
    /// The track on open.spotify.com.
    pub url: String,
    #[ts(type = "number")]
    pub duration_ms: u64,
    /// Position when asked, while playing.
    #[ts(type = "number | null")]
    pub progress_ms: Option<u64>,
    /// ISO 8601, for the last played track.
    pub played_at: Option<String>,
}

pub struct Spotify {
    creds: Credentials,
    http: reqwest::Client,
    token: Mutex<Option<(String, Instant)>>,
    answer: Mutex<Option<(Instant, Option<Track>)>>,
}

impl Spotify {
    pub fn new(creds: Credentials) -> anyhow::Result<Self> {
        Ok(Self {
            creds,
            http: reqwest::Client::builder()
                .user_agent("kewldan.ru now playing")
                .timeout(Duration::from_secs(8))
                .build()?,
            token: Mutex::default(),
            answer: Mutex::default(),
        })
    }

    async fn access_token(&self) -> anyhow::Result<String> {
        if let Some((token, until)) = self.token.lock().unwrap().clone()
            && Instant::now() < until
        {
            return Ok(token);
        }
        #[derive(Deserialize)]
        struct Grant {
            access_token: String,
            expires_in: u64,
        }
        let grant: Grant = self
            .http
            .post("https://accounts.spotify.com/api/token")
            .basic_auth(&self.creds.client_id, Some(&self.creds.client_secret))
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", self.creds.refresh_token.as_str()),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        // A minute early, so a token never expires mid-request.
        let until = Instant::now() + Duration::from_secs(grant.expires_in.saturating_sub(60));
        *self.token.lock().unwrap() = Some((grant.access_token.clone(), until));
        Ok(grant.access_token)
    }

    /// `None` from a 204: nothing playing.
    async fn get(&self, path: &str) -> anyhow::Result<Option<Value>> {
        let token = self.access_token().await?;
        let res = self
            .http
            .get(format!("https://api.spotify.com/v1{path}"))
            .bearer_auth(token)
            .send()
            .await?
            .error_for_status()?;
        if res.status() == StatusCode::NO_CONTENT {
            return Ok(None);
        }
        Ok(Some(res.json().await?))
    }

    async fn fetch(&self) -> anyhow::Result<Option<Track>> {
        if let Some(now) = self.get("/me/player/currently-playing").await?
            && let Some(track) = track(&now["item"], now["is_playing"].as_bool() == Some(true))
        {
            let progress = now["progress_ms"].as_u64();
            return Ok(Some(Track {
                progress_ms: if track.playing { progress } else { None },
                ..track
            }));
        }
        let recent = self.get("/me/player/recently-played?limit=1").await?;
        let item = recent.as_ref().map(|r| &r["items"][0]);
        Ok(item.and_then(|i| {
            track(&i["track"], false).map(|t| Track {
                played_at: i["played_at"].as_str().map(str::to_owned),
                ..t
            })
        }))
    }

    /// The current answer, from the cache while it is fresh. A failure
    /// keeps serving the last good answer.
    pub async fn now(&self) -> anyhow::Result<Option<Track>> {
        if let Some((at, track)) = self.answer.lock().unwrap().clone()
            && at.elapsed() < FRESH
        {
            return Ok(track);
        }
        match self.fetch().await {
            Ok(track) => {
                *self.answer.lock().unwrap() = Some((Instant::now(), track.clone()));
                Ok(track)
            }
            Err(err) => match self.answer.lock().unwrap().clone() {
                Some((_, track)) => {
                    tracing::warn!(error = %format!("{err:#}"), "spotify unavailable, serving the last answer");
                    Ok(track)
                }
                None => Err(err),
            },
        }
    }
}

/// A track from the Web API's track object; `None` for episodes, ads and
/// local files without an id.
fn track(v: &Value, playing: bool) -> Option<Track> {
    if v["type"].as_str() != Some("track") {
        return None;
    }
    let artists: Vec<&str> = v["artists"]
        .as_array()?
        .iter()
        .filter_map(|a| a["name"].as_str())
        .collect();
    // Covers come largest first: 640, 300, 64.
    let images = v["album"]["images"].as_array();
    let image = images
        .and_then(|i| i.get(1).or_else(|| i.first()))
        .and_then(|i| i["url"].as_str())
        .map(str::to_owned);
    Some(Track {
        playing,
        title: v["name"].as_str()?.to_owned(),
        artists: artists.join(", "),
        album: v["album"]["name"].as_str().unwrap_or_default().to_owned(),
        image,
        url: v["external_urls"]["spotify"].as_str()?.to_owned(),
        duration_ms: v["duration_ms"].as_u64().unwrap_or(0),
        progress_ms: None,
        played_at: None,
    })
}

/// `GET /api/spotify`: the track, or 204 when there is none (or Spotify
/// isn't configured).
pub async fn now(State(app): State<AppState>) -> Response {
    let Some(spotify) = &app.spotify else {
        return StatusCode::NO_CONTENT.into_response();
    };
    match spotify.now().await {
        Ok(Some(track)) => {
            ([(header::CACHE_CONTROL, "public, max-age=15")], Json(track)).into_response()
        }
        Ok(None) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => {
            tracing::warn!(error = %format!("{err:#}"), "spotify unavailable");
            StatusCode::BAD_GATEWAY.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn reads_a_track_and_skips_the_rest() {
        let v = json!({
            "type": "track",
            "name": "Pyramids",
            "artists": [{ "name": "Frank Ocean" }, { "name": "John Mayer" }],
            "album": { "name": "channel ORANGE", "images": [
                { "url": "https://i.scdn.co/640" }, { "url": "https://i.scdn.co/300" }, { "url": "https://i.scdn.co/64" }
            ]},
            "external_urls": { "spotify": "https://open.spotify.com/track/x" },
            "duration_ms": 592000
        });
        let t = track(&v, true).unwrap();
        assert_eq!(t.artists, "Frank Ocean, John Mayer");
        assert_eq!(t.image.as_deref(), Some("https://i.scdn.co/300"));
        assert!(t.playing);
        assert_eq!(
            track(&json!({ "type": "episode", "name": "x" }), true),
            None
        );
        assert_eq!(track(&Value::Null, false), None);
    }
}
