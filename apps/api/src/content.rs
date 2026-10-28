//! Site content: the typed model, loading and validation.
//!
//! The JSON in `content/en.json` is the single source of truth. It is parsed
//! into these types at startup (so a typo fails fast instead of rendering
//! `undefined`), and `cargo test` exports the same types to TypeScript for the
//! web app.
//!
//! Text fields marked "rich" accept a tiny inline markup that the web app
//! renders: `**bold**`, `_serif italic accent_` and `==highlighter box==`.

use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
    sync::Arc,
};

use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

const EMBEDDED: &str = include_str!("../content/en.json");
const EMBEDDED_STATS: &str = include_str!("../content/stats.json");

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Content {
    pub profile: Profile,
    pub nav: Vec<Link>,
    pub marquee: Vec<String>,
    pub hero: Hero,
    pub pixels: PixelsSection,
    pub about: About,
    pub work: Work,
    pub numbers: Numbers,
    pub more: More,
    pub stack: Stack,
    pub timeline: Timeline,
    pub off_screen: OffScreen,
    pub contact: Contact,
    pub dropout: Dropout,
    pub footer: Footer,
    pub watched: WatchedPage,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Profile {
    pub name: String,
    pub short_name: String,
    pub handle: String,
    /// "full-stack & systems developer", for titles and the share card.
    pub role: String,
    pub description: String,
    pub site_url: String,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Link {
    pub label: String,
    pub href: String,
    /// Rendered as the filled call to action instead of a text link.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub primary: Option<bool>,
}

/// Accent colours from the design tokens (`--accent-*`).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Accent {
    Yellow,
    Pink,
    Blue,
    Green,
    Orange,
    Cobalt,
    Ink,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Media {
    pub src: String,
    pub alt: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct SectionLabel {
    pub index: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Hero {
    pub meta: Vec<MetaItem>,
    /// Rich.
    pub headline: String,
    pub photo: Option<Media>,
    pub photo_placeholder: String,
    pub label: SectionLabel,
    pub lead: String,
    pub stickers: Vec<Sticker>,
    pub links: Vec<Link>,
    pub ctas: Vec<Cta>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct MetaItem {
    pub title: String,
    pub sub: String,
    /// Shows the pulsing "online" dot.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub live: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Sticker {
    pub label: String,
    pub accent: Accent,
    /// Resting tilt in degrees.
    pub tilt: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Cta {
    pub label: String,
    pub href: String,
    pub accent: Option<Accent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct PixelsSection {
    pub label: SectionLabel,
    /// Rich.
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct About {
    pub label: SectionLabel,
    pub pull: String,
    pub now: Vec<String>,
    pub traits: Vec<String>,
    pub traits_note: String,
    pub love: Vec<String>,
    pub hate: Vec<String>,
    pub hate_note: String,
    pub hobbies: String,
    /// Rich.
    pub desk: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Work {
    pub eyebrow: String,
    pub title: String,
    pub title_dim: String,
    pub lead: String,
    pub projects: Vec<Project>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum StageTheme {
    Dark,
    Light,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub theme: StageTheme,
    /// CSS gradient used for the eyebrow, numbers and glow.
    pub gradient: String,
    pub icon: Option<Media>,
    pub title: String,
    pub title_dim: String,
    /// Rich.
    pub lead: String,
    pub showcase: Option<Showcase>,
    pub specs: Vec<Spec>,
    pub points: Vec<String>,
    pub chips: Vec<String>,
    pub links: Vec<Link>,
    /// The long read at `/work/{id}`.
    pub case: Option<Case>,
}

/// A case study: the story behind a project.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Case {
    /// Rich. One or two sentences under the title.
    pub summary: String,
    pub facts: Vec<Spec>,
    /// The architecture as a left-to-right chain of steps.
    pub pipeline: Vec<String>,
    pub sections: Vec<CaseSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct CaseSection {
    pub title: String,
    /// Rich paragraphs. Required, even empty: the web app renders the raw
    /// JSON when the API is down, and it has no serde defaults.
    pub body: Vec<String>,
    /// Rich bullets. Required, like `body`.
    pub bullets: Vec<String>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub code: Option<String>,
}

/// The bespoke centrepiece of a project slide.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum Showcase {
    /// A screenshot in a glowing device frame.
    Device {
        media: Media,
        label: String,
        version: String,
    },
    /// Two overlapping screenshots.
    Duo { back: Media, front: Media },
    /// A horizontal pipeline of steps.
    Flow { steps: Vec<String> },
    /// Feature tiles.
    Tiles { tiles: Vec<Tile> },
    /// An interactive switch → OR gate → lamp.
    LogicDemo { hint_off: String, hint_on: String },
    /// Huge gradient numbers and an install command.
    BigNumbers { items: Vec<Spec>, command: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Tile {
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Spec {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Numbers {
    pub eyebrow: String,
    /// Counted up from zero when the slide scrolls into view. Usually a
    /// stats placeholder such as `{gh.contributions}`.
    pub value: String,
    pub title: String,
    pub title_dim: String,
    pub trio: Vec<Spec>,
    /// Rich.
    pub note: String,
    pub packages: Vec<Package>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Package {
    pub name: String,
    pub registry: String,
    pub href: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct More {
    pub label: SectionLabel,
    /// Rich.
    pub pull: String,
    pub categories: Vec<Category>,
    pub items: Vec<WorkItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Category {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct WorkItem {
    pub name: String,
    pub categories: Vec<String>,
    pub year: Option<String>,
    pub status: Option<String>,
    pub what: String,
    pub detail: String,
    pub stack: String,
    pub href: Option<String>,
    pub media: Option<Media>,
    /// Name of a live widget rendered under the title (`"oled"`).
    pub widget: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Stack {
    pub label: SectionLabel,
    pub headline: Vec<String>,
    pub note: String,
    pub groups: Vec<StackGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct StackGroup {
    pub id: String,
    pub name: String,
    pub items: Vec<String>,
    pub used_in: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Timeline {
    pub label: SectionLabel,
    pub host: String,
    pub command: String,
    pub commits: Vec<Commit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Commit {
    pub hash: String,
    pub year: String,
    pub message: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct OffScreen {
    pub label: SectionLabel,
    pub car: Car,
    pub trip: Trip,
    pub steam: Steam,
    pub cards: Vec<Card>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Car {
    pub kicker: String,
    pub name: String,
    pub note: String,
    /// Tail lights off.
    pub image: Media,
    /// The same shot with the tail lights on, wiped in over `image`.
    pub image_lit: Media,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Trip {
    pub kicker: String,
    pub from: String,
    pub to: String,
    pub from_city: String,
    pub to_city: String,
    pub motto: String,
    pub photo: Option<Media>,
    pub photo_placeholder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Steam {
    pub kicker: String,
    pub games: Vec<Game>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Game {
    pub name: String,
    pub hours: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Card {
    pub kicker: String,
    pub title: String,
    pub body: String,
    pub accent: Accent,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Contact {
    pub teaser: String,
    pub title: String,
    pub body: String,
    pub links: Vec<Link>,
    pub socials: Vec<Link>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Dropout {
    pub button: String,
    pub note: String,
    /// Who is calling, for screen readers.
    pub caller: String,
    pub meme: Media,
    /// Audio file played (looped) while the call rings.
    pub ringtone: String,
}

/// Copy for `/watched`; the titles themselves come from `/api/watched`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct WatchedPage {
    pub eyebrow: String,
    pub title: String,
    pub description: String,
    pub empty_title: String,
    pub empty_body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Footer {
    pub copyright: String,
    pub thanks: String,
    pub source: Link,
}

/// The content, serialized once. The JSON still holds stats
/// placeholders like `{gh.contributions}`; `crate::stats` fills them per
/// request.
#[derive(Debug)]
pub struct Snapshot {
    pub content: Content,
    pub json: Arc<str>,
}

impl Snapshot {
    pub fn parse(raw: &str) -> anyhow::Result<Self> {
        let content: Content =
            serde_json::from_str(raw).context("content does not match the schema")?;
        content.validate()?;
        let json: Arc<str> = serde_json::to_string(&content)?.into();
        Ok(Self { content, json })
    }
}

/// The content plus the fallback numbers for its placeholders; swapped
/// atomically on reload.
#[derive(Debug)]
pub struct Library {
    pub snapshot: Snapshot,
    pub stats: BTreeMap<String, u64>,
}

impl Library {
    pub fn parse(raw: &str, stats: &str) -> anyhow::Result<Self> {
        let stats: BTreeMap<String, u64> =
            serde_json::from_str(stats).context("stats.json must map keys to numbers")?;
        let snapshot = Snapshot::parse(raw).context("in en.json")?;
        for key in placeholders(&snapshot.json) {
            if !stats.contains_key(key) {
                bail!("en.json uses {{{key}}}, which stats.json does not define");
            }
        }
        Ok(Self { snapshot, stats })
    }

    pub fn embedded() -> anyhow::Result<Self> {
        Self::parse(EMBEDDED, EMBEDDED_STATS)
    }

    /// Reads `en.json` and `stats.json` from `dir`, or uses the embedded copies.
    pub async fn load(dir: Option<&Path>) -> anyhow::Result<Self> {
        let Some(dir) = dir else {
            return Self::embedded();
        };
        let read = |name: &'static str| async move {
            let path = dir.join(name);
            tokio::fs::read_to_string(&path)
                .await
                .with_context(|| format!("reading {}", path.display()))
        };
        Self::parse(&read("en.json").await?, &read("stats.json").await?)
    }
}

/// Every `{gh.*}` / `{steam.*}` key mentioned in `json`.
pub fn placeholders(json: &str) -> HashSet<&str> {
    let mut out = HashSet::new();
    let mut rest = json;
    while let Some(start) = rest.find('{') {
        rest = &rest[start + 1..];
        let Some(end) = rest.find('}') else { break };
        let key = &rest[..end];
        if (key.starts_with("gh.") || key.starts_with("steam."))
            && key
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b == b'.' || b == b'_' || b.is_ascii_digit())
        {
            out.insert(key);
        }
    }
    out
}

impl Content {
    /// Cross-field checks serde cannot express.
    fn validate(&self) -> anyhow::Result<()> {
        let mut ids = std::collections::HashSet::new();
        for p in &self.work.projects {
            if !ids.insert(p.id.as_str()) {
                bail!("duplicate project id {:?}", p.id);
            }
        }
        let cats: std::collections::HashSet<_> =
            self.more.categories.iter().map(|c| c.id.as_str()).collect();
        for item in &self.more.items {
            for c in &item.categories {
                if !cats.contains(c.as_str()) {
                    bail!("{:?} uses unknown category {:?}", item.name, c);
                }
            }
        }
        Ok(())
    }
}

pub fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_content_is_valid() {
        let lib = Library::embedded().expect("content must parse");
        assert!(!lib.snapshot.content.work.projects.is_empty());
    }

    #[test]
    fn rejects_unknown_category() {
        let mut v: serde_json::Value = serde_json::from_str(EMBEDDED).unwrap();
        v["more"]["items"][0]["categories"] = serde_json::json!(["nope"]);
        let err = Snapshot::parse(&v.to_string()).unwrap_err();
        assert!(format!("{err:#}").contains("unknown category"));
    }

    #[test]
    fn rejects_undefined_placeholders() {
        let mut v: serde_json::Value = serde_json::from_str(EMBEDDED).unwrap();
        v["numbers"]["value"] = serde_json::json!("{gh.nope}");
        let err = Library::parse(&v.to_string(), EMBEDDED_STATS).unwrap_err();
        assert!(format!("{err:#}").contains("gh.nope"));
    }

    #[test]
    fn finds_placeholders() {
        let keys = placeholders(r#"{"a":"{gh.prs} and {steam.cs2}","b":"{not a key}"}"#);
        assert_eq!(keys, HashSet::from(["gh.prs", "steam.cs2"]));
    }
}
