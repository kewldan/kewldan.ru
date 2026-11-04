import type { IconKey } from "./icons";

export type NetId = "bitcoin" | "ethereum" | "tron" | "ton" | "solana";
export type CoinId = "btc" | "eth" | "usdt" | "ton" | "sol";

export const NETS: Record<NetId, { name: string; icon: IconKey }> = {
  bitcoin: { name: "Bitcoin", icon: "net-bitcoin" },
  ethereum: { name: "Ethereum", icon: "net-ethereum" },
  tron: { name: "TRON · TRC-20", icon: "net-tron" },
  ton: { name: "TON", icon: "net-ton" },
  solana: { name: "Solana", icon: "net-solana" },
};

export type Coin = {
  id: CoinId;
  name: string;
  sym: string;
  icon: IconKey;
  /** The grid and wireframes take this colour. */
  tint: string;
  /** The halo behind the picked coin and the card. */
  glow: string;
  nets: { net: NetId; addr: string }[];
};

/** Where to send what. The hint for each coin × network is in the copy. */
export const COINS: Coin[] = [
  {
    id: "btc",
    name: "Bitcoin",
    sym: "BTC",
    icon: "bg-bitcoin",
    tint: "#f7931a",
    glow: "rgb(247 147 26 / 0.45)",
    nets: [{ net: "bitcoin", addr: "bc1qEXAMPLE0000000000000000000000000kewldan" }],
  },
  {
    id: "eth",
    name: "Ethereum",
    sym: "ETH",
    icon: "bg-ethereum",
    tint: "#8c8cff",
    glow: "rgb(130 140 255 / 0.45)",
    nets: [{ net: "ethereum", addr: "0xEXAMPLE00000000000000000000000000kewldan" }],
  },
  {
    id: "usdt",
    name: "Tether",
    sym: "USDT",
    icon: "bg-usdt",
    tint: "#26a17b",
    glow: "rgb(38 161 123 / 0.5)",
    nets: [
      { net: "tron", addr: "TEXAMPLE0000000000000000000kewldan" },
      { net: "ton", addr: "UQEXAMPLE_000000000000000000000000000000_kewldan" },
    ],
  },
  {
    id: "ton",
    name: "Toncoin",
    sym: "TON",
    icon: "bg-ton",
    tint: "#0098ea",
    glow: "rgb(0 152 234 / 0.5)",
    nets: [{ net: "ton", addr: "UQEXAMPLE_000000000000000000000000000000_kewldan" }],
  },
  {
    id: "sol",
    name: "Solana",
    sym: "SOL",
    icon: "bg-solana",
    tint: "#9945ff",
    glow: "rgb(153 69 255 / 0.45)",
    nets: [{ net: "solana", addr: "EXAMPLE000000000000000000000000000000kewldan" }],
  },
];
