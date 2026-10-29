//! End-to-end checks against a real server on a random port. With
//! `VALKEY_URL` set (as in CI) the same tests run through Valkey.

use std::{net::SocketAddr, time::Duration};

use futures_util::{SinkExt, StreamExt};
use portfolio_api::{AppState, Config, router};
use serde_json::{Value, json};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async, tungstenite::Message};

type Ws = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

async fn spawn() -> SocketAddr {
    let mut config = Config::for_tests();
    config.valkey_url = std::env::var("VALKEY_URL").ok();
    // Tests run in parallel against one Valkey: each gets its own board.
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    config.valkey_namespace = format!("test:{}:{n}", std::process::id());
    let state = AppState::new(config).await.unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            router(state).into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    addr
}

async fn connect(addr: SocketAddr) -> Ws {
    connect_async(format!("ws://{addr}/api/pixels/ws"))
        .await
        .unwrap()
        .0
}

/// Next message of type `t`, skipping the rest.
async fn next_of(ws: &mut Ws, t: &str) -> Value {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(Ok(Message::Text(text))) = ws.next().await {
                let v: Value = serde_json::from_str(&text).unwrap();
                if v["t"] == t {
                    return v;
                }
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("no {t:?} message"))
}

#[tokio::test]
async fn serves_content_with_etag() {
    let addr = spawn().await;
    let http = |etag: Option<&str>| {
        let mut req = format!("GET /api/content HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n");
        if let Some(e) = etag {
            req.push_str(&format!("If-None-Match: {e}\r\n"));
        }
        req.push_str("\r\n");
        async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
            s.write_all(req.as_bytes()).await.unwrap();
            let mut out = String::new();
            s.read_to_string(&mut out).await.unwrap();
            out
        }
    };
    let first = http(None).await;
    assert!(first.starts_with("HTTP/1.1 200"));
    assert!(first.contains("\"handle\":\"kewldan\""));
    let etag = first
        .lines()
        .find_map(|l| l.strip_prefix("etag: "))
        .expect("etag header")
        .to_owned();
    assert!(http(Some(&etag)).await.starts_with("HTTP/1.1 304"));
}

#[tokio::test]
async fn paint_reaches_other_clients() {
    let addr = spawn().await;
    let mut a = connect(addr).await;
    let mut b = connect(addr).await;
    let hello_a = next_of(&mut a, "hello").await;
    let hello_b = next_of(&mut b, "hello").await;
    assert_eq!(hello_a["board"].as_str().unwrap().len(), 64 * 32);

    // Paint a cell to whatever it is not right now.
    let board = hello_b["board"].as_str().unwrap().as_bytes();
    let color = if board[5] == b'4' { 5 } else { 4 };
    a.send(Message::text(
        json!({ "t": "paint", "cells": [[5, color]] }).to_string(),
    ))
    .await
    .unwrap();

    let ack = next_of(&mut a, "ack").await;
    assert_eq!(ack["revert"], json!([]));
    let seen = next_of(&mut b, "paint").await;
    assert_eq!(seen["cells"], json!([[5, color]]));
    assert_eq!(seen["by"], hello_a["id"]);
}

#[tokio::test]
async fn cursors_and_departures_are_shared() {
    let addr = spawn().await;
    let mut a = connect(addr).await;
    let mut b = connect(addr).await;
    let id_a = next_of(&mut a, "hello").await["id"].clone();
    next_of(&mut b, "hello").await;

    a.send(Message::text(
        json!({ "t": "cursor", "x": 0.5, "y": 0.25, "c": 2 }).to_string(),
    ))
    .await
    .unwrap();
    let cursor = next_of(&mut b, "cursor").await;
    assert_eq!(cursor["id"], id_a);

    a.close(None).await.unwrap();
    let gone = next_of(&mut b, "gone").await;
    assert_eq!(gone["id"], id_a);
}

#[tokio::test]
async fn garbage_closes_the_socket() {
    let addr = spawn().await;
    let mut a = connect(addr).await;
    next_of(&mut a, "hello").await;
    a.send(Message::text("{\"t\":\"nope\"}")).await.unwrap();
    let closed = tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(msg) = a.next().await {
            if matches!(msg, Ok(Message::Close(_)) | Err(_)) {
                return true;
            }
        }
        true
    })
    .await;
    assert_eq!(closed, Ok(true));
}

/// One HTTP/1.1 request over a raw socket: `(status, body)`.
async fn request(
    addr: SocketAddr,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (u16, String) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let body = body.map(|b| b.to_string()).unwrap_or_default();
    let mut req = format!(
        "{method} {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\nContent-Length: {}\r\n",
        body.len()
    );
    if !body.is_empty() {
        req.push_str("Content-Type: application/json\r\n");
    }
    if let Some(t) = token {
        req.push_str(&format!("Authorization: Bearer {t}\r\n"));
    }
    req.push_str("\r\n");
    req.push_str(&body);
    let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
    s.write_all(req.as_bytes()).await.unwrap();
    let mut out = String::new();
    s.read_to_string(&mut out).await.unwrap();
    let status = out[9..12].parse().unwrap();
    let body = out
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_owned())
        .unwrap_or_default();
    (status, body)
}

#[tokio::test]
async fn watched_list_is_public_and_edits_need_the_token() {
    let addr = spawn().await;
    let title = json!({
        "title": "Severance", "kind": "series", "year": 2022, "rating": 10,
        "status": "watching", "seasons": "1–2", "note": "Music dance experience.", "watched": "autumn 2026"
    });

    assert_eq!(
        request(
            addr,
            "POST",
            "/api/admin/watched",
            None,
            Some(title.clone())
        )
        .await
        .0,
        401
    );
    assert_eq!(
        request(
            addr,
            "POST",
            "/api/admin/watched",
            Some("nope"),
            Some(title.clone())
        )
        .await
        .0,
        401
    );
    assert_eq!(
        request(addr, "GET", "/api/admin/check", Some("test-token"), None)
            .await
            .0,
        204
    );

    let mut bad = title.clone();
    bad["rating"] = json!(11);
    let (status, body) = request(
        addr,
        "POST",
        "/api/admin/watched",
        Some("test-token"),
        Some(bad),
    )
    .await;
    assert_eq!(status, 422);
    assert!(body.contains("\"rating\""));

    let (status, body) = request(
        addr,
        "POST",
        "/api/admin/watched",
        Some("test-token"),
        Some(title.clone()),
    )
    .await;
    assert_eq!(status, 201);
    let id = serde_json::from_str::<Value>(&body).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let mut edited = title.clone();
    edited["rating"] = json!(8.5);
    let path = format!("/api/admin/watched/{id}");
    assert_eq!(
        request(addr, "PUT", &path, Some("test-token"), Some(edited))
            .await
            .0,
        200
    );

    let (status, body) = request(addr, "GET", "/api/watched", None, None).await;
    assert_eq!(status, 200);
    let items = serde_json::from_str::<Value>(&body).unwrap()["items"].clone();
    assert_eq!(items[0]["id"], json!(id));
    assert_eq!(items[0]["rating"], json!(8.5));
    assert_eq!(items[0]["seasons"], json!("1–2"));

    assert_eq!(
        request(addr, "DELETE", &path, Some("test-token"), None)
            .await
            .0,
        204
    );
    assert_eq!(
        request(addr, "DELETE", &path, Some("test-token"), None)
            .await
            .0,
        404
    );
}

#[tokio::test]
async fn content_has_stats_filled_in() {
    let addr = spawn().await;
    let (status, body) = request(addr, "GET", "/api/content", None, None).await;
    assert_eq!(status, 200);
    let content: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(content["numbers"]["value"], json!("2,195"));
    assert!(!body.contains("{gh."), "every placeholder is filled");
}

#[tokio::test]
async fn passkey_endpoints_guard_the_admin() {
    let addr = spawn().await;
    let (status, body) = request(addr, "GET", "/api/auth/passkey", None, None).await;
    assert_eq!(status, 200);
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap()["available"],
        json!(false)
    );

    // Nothing to sign in with yet.
    let (status, body) = request(addr, "POST", "/api/auth/passkey/login/start", None, None).await;
    assert_eq!(status, 404);
    assert!(body.contains("no_passkeys"));

    // Adding a passkey needs the admin.
    assert_eq!(
        request(
            addr,
            "POST",
            "/api/admin/passkeys/register/start",
            None,
            None
        )
        .await
        .0,
        401
    );
    let (status, body) = request(
        addr,
        "POST",
        "/api/admin/passkeys/register/start",
        Some("test-token"),
        None,
    )
    .await;
    assert_eq!(status, 200);
    let start: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        start["options"]["publicKey"]["rp"]["id"],
        json!("localhost")
    );
    assert!(start["id"].as_str().is_some_and(|s| !s.is_empty()));

    // A finish without the ceremony behind it is refused.
    let bogus = json!({ "id": "nope", "credential": {
        "id": "x", "rawId": "eA", "type": "public-key",
        "response": { "attestationObject": "eA", "clientDataJSON": "eA" } } });
    let (status, body) = request(
        addr,
        "POST",
        "/api/admin/passkeys/register/finish",
        Some("test-token"),
        Some(bogus),
    )
    .await;
    assert_eq!(status, 400);
    assert!(body.contains("expired"));

    // Logging out always clears the cookie.
    let (status, _) = request(addr, "POST", "/api/auth/logout", None, None).await;
    assert_eq!(status, 204);
}

#[tokio::test]
async fn history_replays_rewinds_and_erases() {
    let addr = spawn().await;
    let mut ws = connect(addr).await;
    let hello = next_of(&mut ws, "hello").await;
    let before = hello["board"].as_str().unwrap().to_owned();
    let color = if before.as_bytes()[7] == b'3' { 2 } else { 3 };
    ws.send(Message::text(
        json!({ "t": "paint", "cells": [[7, color], [8, color]] }).to_string(),
    ))
    .await
    .unwrap();
    next_of(&mut ws, "ack").await;
    next_of(&mut ws, "paint").await;

    // The history is public: the base, then one line per change.
    let (status, body) = request(addr, "GET", "/api/pixels/history", None, None).await;
    assert_eq!(status, 200);
    let mut lines = body.lines();
    assert_eq!(lines.next().unwrap(), before);
    let last = lines.last().unwrap();
    assert!(last.ends_with(&format!(" p 7:{color},8:{color}")), "{last}");
    let painted_at: u64 = last.split(' ').next().unwrap().parse().unwrap();

    // Moderation needs the token.
    let erase = json!({ "x": 7, "y": 0, "w": 1, "h": 1 });
    let (status, _) = request(
        addr,
        "POST",
        "/api/admin/pixels/erase",
        None,
        Some(erase.clone()),
    )
    .await;
    assert_eq!(status, 401);
    let (status, _) = request(
        addr,
        "POST",
        "/api/admin/pixels/erase",
        Some("test-token"),
        Some(erase),
    )
    .await;
    assert_eq!(status, 204);
    let erased = next_of(&mut ws, "paint").await;
    assert_eq!(erased["cells"], json!([[7, -1]]));
    let bad = json!({ "x": 60, "y": 0, "w": 10, "h": 1 });
    let (status, _) = request(
        addr,
        "POST",
        "/api/admin/pixels/erase",
        Some("test-token"),
        Some(bad),
    )
    .await;
    assert_eq!(status, 422);

    // Back to just before the paint: the board from `hello` again.
    let rewind = json!({ "at": painted_at - 1 });
    let (status, _) = request(
        addr,
        "POST",
        "/api/admin/pixels/rewind",
        Some("test-token"),
        Some(rewind),
    )
    .await;
    assert_eq!(status, 204);
    let board = next_of(&mut ws, "board").await;
    assert_eq!(board["board"], before);
}

#[tokio::test]
async fn contact_form_keeps_abuse_out() {
    use portfolio_api::contact::proof_ok;

    let addr = spawn().await;
    let mut challenges = Vec::new();
    for _ in 0..7 {
        let (status, body) = request(addr, "GET", "/api/contact/challenge", None, None).await;
        assert_eq!(status, 200);
        let v: Value = serde_json::from_str(&body).unwrap();
        challenges.push(v["id"].as_str().unwrap().to_owned());
    }
    let solve = |id: &str| {
        (0u64..)
            .map(|n| n.to_string())
            .find(|n| proof_ok(id, n))
            .unwrap()
    };
    let form = |id: &str, nonce: &str, message: &str, website: &str| {
        json!({
            "challenge": id, "nonce": nonce, "name": "Ann", "contact": "@ann",
            "message": message, "website": website,
        })
    };
    let post = |body: Value| request(addr, "POST", "/api/contact", None, Some(body));

    // Answered at once: a script. The challenge is spent either way.
    let id = &challenges[0];
    let (status, body) = post(form(id, &solve(id), "Hello, I have a project", "")).await;
    assert_eq!((status, body.contains("too_fast")), (400, true));

    tokio::time::sleep(std::time::Duration::from_millis(3100)).await;
    let (status, _) = post(form(id, &solve(id), "Hello, I have a project", "")).await;
    assert_eq!(status, 400, "a challenge is good for one message");

    let id = &challenges[1];
    let (status, body) = post(form(id, "nope", "Hello, I have a project", "")).await;
    assert_eq!((status, body.contains("challenge")), (400, true));

    // The honeypot gets a quiet success and no delivery.
    let id = &challenges[2];
    let (status, _) = post(form(id, &solve(id), "Buy cheap stuff now", "https://spam")).await;
    assert_eq!(status, 204);

    let id = &challenges[3];
    let (status, body) = post(form(id, &solve(id), "hi", "")).await;
    assert_eq!((status, body.contains("message")), (422, true));

    // Valid, but no Telegram in tests: unavailable. Still counted.
    let id = &challenges[4];
    let (status, _) = post(form(id, &solve(id), "Hello, I have a project", "")).await;
    assert_eq!(status, 503);
    let id = &challenges[5];
    let (status, _) = post(form(id, &solve(id), "hello,  I have a PROJECT", "")).await;
    assert_eq!(status, 409, "the same message twice a day");
    let id = &challenges[6];
    let (status, _) = post(form(id, &solve(id), "Another thing entirely", "")).await;
    assert_eq!(status, 503);

    let (_, body) = request(addr, "GET", "/api/contact/challenge", None, None).await;
    let id = serde_json::from_str::<Value>(&body).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    tokio::time::sleep(std::time::Duration::from_millis(3100)).await;
    let (status, body) = post(form(&id, &solve(&id), "A fourth message this hour", "")).await;
    assert_eq!((status, body.contains("rate")), (429, true));
}

#[tokio::test]
async fn site_settings_reach_the_content_and_the_board() {
    let addr = spawn().await;
    assert_eq!(
        request(addr, "GET", "/api/admin/settings", None, None)
            .await
            .0,
        401
    );
    let (status, body) =
        request(addr, "GET", "/api/admin/settings", Some("test-token"), None).await;
    assert_eq!(status, 200);
    let mut settings: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(settings["openToOffers"], json!(true));

    let mut ws = connect(addr).await;
    assert_eq!(next_of(&mut ws, "hello").await["locked"], json!(false));

    settings["headline"] = json!("New ==headline==");
    settings["pixels"] = json!(false);
    settings["projectOrder"] = json!(["tether"]);
    settings["hiddenProjects"] = json!(["goitmo"]);
    settings["board"] = json!({ "locked": true, "inkMax": 10, "inkRegen": 1.5 });
    let (status, _) = request(
        addr,
        "PUT",
        "/api/admin/settings",
        Some("test-token"),
        Some(settings.clone()),
    )
    .await;
    assert_eq!(status, 200);
    let rules = next_of(&mut ws, "rules").await;
    assert_eq!(
        (rules["locked"].clone(), rules["inkMax"].clone()),
        (json!(true), json!(10))
    );

    let (_, body) = request(addr, "GET", "/api/content", None, None).await;
    let content: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(content["hero"]["headline"], "New ==headline==");
    assert_eq!(content["hidden"], json!(["pixels"]));
    assert_eq!(content["work"]["projects"][0]["id"], "tether");
    let goitmo = content["work"]["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "goitmo")
        .unwrap();
    assert_eq!(goitmo["hidden"], json!(true));

    // Turning the token off needs a passkey to fall back on.
    settings["tokenSignIn"] = json!(false);
    let (status, body) = request(
        addr,
        "PUT",
        "/api/admin/settings",
        Some("test-token"),
        Some(settings),
    )
    .await;
    assert_eq!(status, 409);
    assert!(body.contains("no_passkeys"));

    let (status, body) =
        request(addr, "GET", "/api/admin/sessions", Some("test-token"), None).await;
    assert_eq!((status, body.as_str()), (200, r#"{"items":[]}"#));
    let (status, body) =
        request(addr, "GET", "/api/admin/auth/log", Some("test-token"), None).await;
    assert_eq!((status, body.as_str()), (200, r#"{"items":[]}"#));
}

#[tokio::test]
async fn a_vandal_is_found_undone_and_banned_quietly() {
    let addr = spawn().await;
    let mut vandal = connect(addr).await;
    let mut watcher = connect(addr).await;
    let hello = next_of(&mut vandal, "hello").await;
    next_of(&mut watcher, "hello").await;
    let board = hello["board"].as_str().unwrap().as_bytes().to_vec();
    let other = |i: usize| if board[i] == b'4' { 5 } else { 4 };

    // Two cells in the top-left corner.
    vandal
        .send(Message::text(
            json!({ "t": "paint", "cells": [[0, other(0)], [1, other(1)]] }).to_string(),
        ))
        .await
        .unwrap();
    next_of(&mut vandal, "ack").await;
    next_of(&mut watcher, "paint").await;

    let area = json!({ "x": 0, "y": 0, "w": 4, "h": 4 });
    let (status, body) = request(
        addr,
        "POST",
        "/api/admin/pixels/painters",
        Some("test-token"),
        Some(area),
    )
    .await;
    assert_eq!(status, 200);
    let found: Value = serde_json::from_str(&body).unwrap();
    let painter = &found["items"][0];
    assert_eq!(painter["cells"], json!(2));
    let who = painter["who"].as_str().unwrap().to_owned();

    let (status, body) = request(
        addr,
        "POST",
        "/api/admin/pixels/undo",
        Some("test-token"),
        Some(json!({ "who": who, "since": painter["first"] })),
    )
    .await;
    assert_eq!((status, body.as_str()), (200, r#"{"cells":2}"#));
    // The watcher sees the cells go back.
    let back = next_of(&mut watcher, "paint").await;
    assert_eq!(back["cells"].as_array().unwrap().len(), 2);

    let (_, body) = request(
        addr,
        "GET",
        "/api/admin/pixels/bans",
        Some("test-token"),
        None,
    )
    .await;
    assert!(body.contains(&who));

    // Banned: the vandal is answered as usual, nobody else sees a thing.
    vandal
        .send(Message::text(
            json!({ "t": "paint", "cells": [[2, other(2)]] }).to_string(),
        ))
        .await
        .unwrap();
    assert_eq!(next_of(&mut vandal, "ack").await["revert"], json!([]));
    let quiet =
        tokio::time::timeout(Duration::from_millis(500), next_of(&mut watcher, "paint")).await;
    assert!(quiet.is_err(), "a banned stroke reached someone else");
    let (_, body) = request(addr, "GET", "/api/pixels", None, None).await;
    let now: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(now["board"].as_str().unwrap().as_bytes()[2], board[2]);
}
