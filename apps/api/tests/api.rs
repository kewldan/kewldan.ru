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
        "status": "watching", "seasons": "1–2", "note": "Music dance experience.", "watched": "2026-10-20"
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
    assert!(body.contains("score"));

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
    edited["rating"] = json!(9);
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
    assert_eq!(items[0]["rating"], json!(9));
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
