import { parseRich } from "@/components/rich";
import type { Content } from "@/lib/api/generated/Content";

import { ogFamily as f } from "./fonts";

/** Token values, inlined: Satori sees no CSS variables. */
const c = {
  paper: "#fafaf7",
  ink: "#0d0d0f",
  muted: "#5f6166",
  cobalt: "#2a35ff",
  yellow: "#ffe14d",
  live: "#14a052",
  accents: { pink: "#ff8fd0", blue: "#7aa2ff", green: "#5fe39a", yellow: "#ffe14d", orange: "#ff9a4d" } as Record<
    string,
    string
  >,
};

const brutal = { border: `4px solid ${c.ink}`, boxShadow: `6px 6px 0 ${c.ink}` };

/** The home page share card: marquee, logo, the headline, stickers, footer line. */
export function HomeCard({ content, domain }: { content: Content; domain: string }) {
  const { hero, marquee, profile } = content;
  const live = hero.meta.find((m) => m.live);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: c.paper,
        color: c.ink,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 28,
          height: 40,
          alignItems: "center",
          padding: "0 20px",
          background: c.ink,
          color: c.yellow,
          fontFamily: f.mono,
          fontSize: 15,
          letterSpacing: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {[...marquee, ...marquee].map((w, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            {w}
            {/* JetBrains Mono has no ✶: draw the star. */}
            <svg width="13" height="13" viewBox="0 0 12 12">
              <path d="M6 0v12M0 6h12M1.8 1.8l8.4 8.4M10.2 1.8l-8.4 8.4" stroke={c.yellow} strokeWidth="1.6" />
            </svg>
          </span>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "34px 64px 0", position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              ...brutal,
              background: c.yellow,
              padding: "6px 12px",
              fontFamily: f.mono,
              fontWeight: 700,
              fontSize: 24,
            }}
          >
            {profile.handle}
          </div>
          <div style={{ display: "flex", fontFamily: f.mono, fontSize: 22 }}>{domain}</div>
        </div>

        <Headline text={hero.headline} />

        {hero.stickers.slice(0, 3).map((s, i) => (
          <div
            key={s.label}
            style={{
              position: "absolute",
              right: [80, 140, 70][i],
              top: [148, 262, 370][i],
              display: "flex",
              ...brutal,
              background: c.accents[s.accent] ?? c.yellow,
              padding: "10px 18px",
              fontFamily: f.mono,
              fontWeight: 700,
              fontSize: 24,
              transform: `rotate(${s.tilt}deg)`,
            }}
          >
            {s.label}
          </div>
        ))}

        <div
          style={{
            marginTop: "auto",
            marginBottom: 34,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `2px solid ${c.ink}`,
            paddingTop: 18,
            fontFamily: f.paper,
            fontSize: 22,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{profile.name}</span>
            <span style={{ color: c.muted, fontWeight: 500 }}>· {profile.role}</span>
          </div>
          {live && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 500 }}>
              <span style={{ width: 13, height: 13, borderRadius: 13, background: c.live }} />
              {live.title}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The rich headline: ==mark== becomes the yellow box, _x_ the cobalt serif. */
function Headline({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        maxWidth: 760,
        marginTop: 40,
        fontFamily: f.display,
        fontWeight: 600,
        fontSize: 118,
        lineHeight: 1,
        letterSpacing: -5,
        columnGap: 24,
        rowGap: 4,
      }}
    >
      {parseRich(text).flatMap((t, i) => {
        if (t.kind === "mark") {
          return [
            <span
              key={i}
              style={{
                ...brutal,
                border: `5px solid ${c.ink}`,
                boxShadow: `8px 8px 0 ${c.ink}`,
                background: c.yellow,
                padding: "0 12px 6px",
                transform: "rotate(-1.6deg)",
              }}
            >
              {t.text}
            </span>,
          ];
        }
        if (t.kind === "italic") {
          return [
            <span
              key={i}
              style={{ fontFamily: f.serif, fontStyle: "italic", fontWeight: 400, color: c.cobalt, letterSpacing: -2 }}
            >
              {t.text}
            </span>,
          ];
        }
        return t.text
          .split(/\s+/)
          .filter(Boolean)
          .map((w, j) => <span key={`${i}-${j}`}>{w}</span>);
      })}
    </div>
  );
}

const score = (n: number) => (n >= 9 ? "#5ef0c2" : n >= 7 ? "#6f8dff" : n >= 5 ? "#ffb36b" : "#ff5f8f");

/** The Watched share card: dark keynote, gradient title, the score scale. */
export function WatchedCard({ content, domain }: { content: Content; domain: string }) {
  const { watched, profile } = content;
  // "Watched." fits at full size; "Посмотрел." needs a smaller one.
  const titleSize = Math.min(230, Math.floor(1088 / (watched.title.length * 0.58)));
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 56px",
        background: "radial-gradient(circle at 50% 42%, #1c1a33 0%, #0b0b0e 55%, #000 100%)",
        color: "#f5f5f7",
        fontFamily: f.stage,
      }}
    >
      <div style={{ display: "flex", width: "100%", justifyContent: "space-between", fontSize: 22 }}>
        <span style={{ fontWeight: 700 }}>{profile.handle}</span>
        <span style={{ fontWeight: 500, color: "#d2d2d7" }}>{domain}/watched</span>
      </div>
      <div style={{ display: "flex", marginTop: 74, fontSize: 30, fontWeight: 500, color: "#8a8a90" }}>
        {watched.eyebrow}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 8,
          fontSize: titleSize,
          fontWeight: 700,
          letterSpacing: -titleSize * 0.06,
          lineHeight: 1,
          backgroundImage: "linear-gradient(100deg, #ffb36b 0%, #ff5f8f 38%, #8a6bff 72%, #3fb6ff 100%)",
          backgroundClip: "text",
          color: "transparent",
          paddingBottom: 12,
        }}
      >
        {watched.title}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 34 }}>
        {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => (
          <div
            key={n}
            style={{
              width: 46,
              height: 46,
              borderRadius: 46,
              background: score(n),
              color: "#0d0d0f",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 19,
              fontWeight: 500,
            }}
          >
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}
