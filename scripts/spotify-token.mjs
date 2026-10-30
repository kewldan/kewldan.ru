// Gets the Spotify refresh token the site uses to see what is playing.
// Run once on the Mac, with the app's keys from developer.spotify.com:
//
//   SPOTIFY_CLIENT_ID=… SPOTIFY_CLIENT_SECRET=… node scripts/spotify-token.mjs
//
// It opens Spotify's consent page, catches the redirect on
// http://127.0.0.1:8888/callback and prints SPOTIFY_REFRESH_TOKEN.
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";

const id = process.env.SPOTIFY_CLIENT_ID;
const secret = process.env.SPOTIFY_CLIENT_SECRET;
if (!id || !secret) {
  console.error("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET first.");
  process.exit(1);
}

const redirect = "http://127.0.0.1:8888/callback";
const scope =
  "user-read-currently-playing user-read-recently-played user-top-read";
const state = crypto.randomBytes(16).toString("hex");
const consent =
  "https://accounts.spotify.com/authorize?" +
  new URLSearchParams({
    client_id: id,
    response_type: "code",
    redirect_uri: redirect,
    scope,
    state,
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", redirect);
  if (url.pathname !== "/callback") return res.writeHead(404).end();
  const code = url.searchParams.get("code");
  if (url.searchParams.get("state") !== state || !code) {
    res
      .writeHead(400)
      .end(`Refused: ${url.searchParams.get("error") ?? "bad state"}`);
    return;
  }
  const reply = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
    }),
  });
  const token = await reply.json();
  server.close();
  if (!token.refresh_token) {
    res.writeHead(500).end("No refresh token, see the terminal.");
    console.error(token);
    process.exitCode = 1;
    return;
  }
  res.end("Done. Back to the terminal.");
  console.log(`\nSPOTIFY_REFRESH_TOKEN=${token.refresh_token}\n`);
});

server.listen(8888, "127.0.0.1", () => {
  console.log(`Opening Spotify to approve access…\n${consent}`);
  execFile("open", [consent]);
});
