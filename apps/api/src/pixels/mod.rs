//! Pixel battle: one shared 64×32 board, live for everyone on the page.

pub mod board;
pub mod guard;
pub mod history;
mod hub;
pub mod protocol;

use std::{net::IpAddr, sync::Arc, time::Duration};

use axum::{
    Json,
    extract::{
        State, WebSocketUpgrade,
        ws::{CloseFrame, Message, Utf8Bytes, WebSocket, close_code},
    },
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::{sync::broadcast::error::RecvError, time::Instant};

pub use guard::Guard;
pub use hub::{Hub, Rules};
use protocol::{ClientMessage, ServerMessage};

use crate::AppState;

const PING_EVERY: Duration = Duration::from_secs(20);
const CURSOR_EVERY: Duration = Duration::from_millis(40);
const MAX_MESSAGE: usize = 16 * 1024;
/// A painter's profile is written on their first stroke, then at most this
/// often, and once more when they leave.
const NOTE_EVERY: Duration = Duration::from_secs(30);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardResponse {
    width: usize,
    height: usize,
    palette: &'static [&'static str],
    board: String,
    /// People on the page right now.
    peers: u32,
}

/// `GET /api/pixels`: the board for clients that only want to look.
pub async fn board(State(app): State<AppState>) -> Json<BoardResponse> {
    Json(BoardResponse {
        width: board::WIDTH,
        height: board::HEIGHT,
        palette: &board::PALETTE,
        board: app.hub.snapshot(),
        peers: app.hub.peers(),
    })
}

/// `GET /api/pixels/ws`
pub async fn ws(
    State(app): State<AppState>,
    headers: HeaderMap,
    ip: crate::ClientIp,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !app.config.origin_allowed(headers.get(header::ORIGIN)) {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    let header = |name, max| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| guard::clean(v, max))
    };
    let visit = guard::Visit {
        agent: header(header::USER_AGENT, 256),
        lang: header(header::ACCEPT_LANGUAGE, 64),
        ..Default::default()
    };
    upgrade
        .max_message_size(MAX_MESSAGE)
        .on_upgrade(move |socket| session(app, socket, ip.0, visit))
}

/// Writes to the painter's profile; a failure only costs the profile.
async fn note(
    app: &AppState,
    who: &str,
    ip: IpAddr,
    visit: &guard::Visit,
    cells: u32,
    new_visit: bool,
) {
    if let Err(err) = app
        .guard
        .note(who, ip, visit, cells, new_visit, crate::unix_ms())
        .await
    {
        tracing::warn!(error = %format!("{err:#}"), "painter profile not saved");
    }
}

async fn session(app: AppState, socket: WebSocket, ip: IpAddr, mut visit: guard::Visit) {
    let hub = Arc::clone(&app.hub);
    let who = app.guard.painter(ip);
    // Cells painted since the profile was last written, and when that was.
    let mut unsaved: u32 = 0;
    let mut noted: Option<Instant> = None;
    let (mut sink, mut stream) = socket.split();
    let mut events = hub.subscribe();
    let hello = hub.join(ip).await;
    let ServerMessage::Hello { id, .. } = hello else {
        unreachable!()
    };
    tracing::debug!(id, %ip, "pixel session opened");

    let send =
        |msg: &ServerMessage| Message::Text(Utf8Bytes::from(serde_json::to_string(msg).unwrap()));
    let mut ping = tokio::time::interval(PING_EVERY);
    let mut last_cursor = Instant::now() - CURSOR_EVERY;
    let mut cursor_shown = false;

    if sink.send(send(&hello)).await.is_err() {
        hub.leave(id).await;
        return;
    }
    loop {
        tokio::select! {
            incoming = stream.next() => {
                let text = match incoming {
                    Some(Ok(Message::Text(text))) => text,
                    Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                    Some(Ok(_)) => continue,
                };
                let reply = match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(ClientMessage::Hi { device, tz, screen, umami }) => {
                        visit.hi(
                            &device,
                            tz.as_deref(),
                            screen.as_deref(),
                            umami.as_ref().map(|u| (u.website.as_str(), u.visit.as_str())),
                            crate::unix_ms(),
                        );
                        None
                    }
                    Ok(ClientMessage::Paint { cells }) => {
                        // Taken before the paint, so the history's line for it is
                        // never earlier than the stroke log says: undo looks just
                        // before this moment.
                        let at = crate::unix_ms();
                        let (ack, painted) = hub.paint(id, ip, cells, app.guard.is_banned(&who)).await;
                        if !painted.is_empty()
                            && let Some(burst) = app.guard.record(&who, &painted, at).await
                        {
                            tokio::spawn(guard::alert(app.clone(), burst));
                        }
                        unsaved += painted.len() as u32;
                        if unsaved > 0 && noted.is_none_or(|t| t.elapsed() >= NOTE_EVERY) {
                            note(&app, &who, ip, &visit, std::mem::take(&mut unsaved), noted.is_none()).await;
                            noted = Some(Instant::now());
                        }
                        Some(ack)
                    }
                    Ok(ClientMessage::Cursor { x, y, c }) => {
                        if last_cursor.elapsed() >= CURSOR_EVERY {
                            last_cursor = Instant::now();
                            cursor_shown = true;
                            hub.cursor(id, x, y, c).await;
                        }
                        None
                    }
                    Ok(ClientMessage::Leave) => {
                        if std::mem::take(&mut cursor_shown) {
                            hub.cursor_gone(id).await;
                        }
                        None
                    }
                    Err(_) => {
                        let frame = CloseFrame { code: close_code::INVALID, reason: "bad message".into() };
                        let _ = sink.send(Message::Close(Some(frame))).await;
                        break;
                    }
                };
                if let Some(reply) = reply
                    && sink.send(send(&reply)).await.is_err()
                {
                    break;
                }
            }
            event = events.recv() => {
                let msg = match event {
                    Ok(text) => Message::Text(Utf8Bytes::from(&*text)),
                    // Too slow to keep up: skip ahead to the current board.
                    Err(RecvError::Lagged(_)) => send(&ServerMessage::Board { board: hub.snapshot() }),
                    Err(RecvError::Closed) => break,
                };
                if sink.send(msg).await.is_err() {
                    break;
                }
            }
            _ = ping.tick() => {
                if sink.send(Message::Ping(Default::default())).await.is_err() {
                    break;
                }
            }
        }
    }
    hub.leave(id).await;
    if unsaved > 0 {
        note(&app, &who, ip, &visit, unsaved, noted.is_none()).await;
    }
    tracing::debug!(id, "pixel session closed");
}

/// `GET /api/pixels/history`: the timelapse. Plain text, one board per
/// line: the base first, then every change (see [`history`]).
pub async fn history(State(app): State<AppState>) -> Response {
    match app.hub.history().await {
        Ok((base, lines)) => {
            let mut body = base.encode();
            for line in lines {
                body.push('\n');
                body.push_str(&line);
            }
            (
                [
                    (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
                    (header::CACHE_CONTROL, "public, max-age=15"),
                ],
                body,
            )
                .into_response()
        }
        Err(err) => {
            tracing::warn!(%err, "pixel history unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct Rewind {
    /// Unix ms; the board goes back to how it looked then.
    at: u64,
}

/// `POST /api/admin/pixels/rewind`
pub async fn rewind(State(app): State<AppState>, Json(r): Json<Rewind>) -> StatusCode {
    match app.hub.history().await {
        Ok((base, lines)) => {
            app.hub
                .replace(history::board_at(&base, &lines, r.at))
                .await;
            StatusCode::NO_CONTENT
        }
        Err(err) => {
            tracing::warn!(%err, "pixel history unavailable");
            StatusCode::SERVICE_UNAVAILABLE
        }
    }
}

/// A rectangle of cells, in board coordinates.
#[derive(Deserialize)]
pub struct Area {
    x: usize,
    y: usize,
    w: usize,
    h: usize,
}

/// `POST /api/admin/pixels/erase`: empties a rectangle, for the drawing
/// that should not be there.
pub async fn erase(State(app): State<AppState>, Json(a): Json<Area>) -> StatusCode {
    if a.w == 0 || a.h == 0 || a.x + a.w > board::WIDTH || a.y + a.h > board::HEIGHT {
        return StatusCode::UNPROCESSABLE_ENTITY;
    }
    let cells = (a.y..a.y + a.h)
        .flat_map(|y| (a.x..a.x + a.w).map(move |x| ((y * board::WIDTH + x) as u16, board::EMPTY)))
        .collect();
    app.hub.paint_admin(cells).await;
    StatusCode::NO_CONTENT
}

/// `POST /api/admin/pixels/clear`
pub async fn clear(State(app): State<AppState>) -> StatusCode {
    app.hub.replace(board::Board::empty()).await;
    StatusCode::NO_CONTENT
}

/// `POST /api/admin/pixels/reset`
pub async fn reset(State(app): State<AppState>) -> StatusCode {
    app.hub.replace(board::Board::seed()).await;
    StatusCode::NO_CONTENT
}
