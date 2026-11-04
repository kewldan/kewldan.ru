import type { IconKey } from "./icons";

export type NetId = "ethereum" | "tron" | "ton";
export type CoinId = "eth" | "usdt" | "ton";

export const NETS: Record<NetId, { name: string; icon: IconKey }> = {
  ethereum: { name: "Ethereum", icon: "net-ethereum" },
  tron: { name: "TRON · TRC-20", icon: "net-tron" },
  ton: { name: "TON", icon: "net-ton" },
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
  /** The networks it can arrive on, in the order the switch shows them. */
  nets: NetId[];
};

/**
 * What the block can show. The addresses come from the admin (site
 * settings, `wallets`); a coin with none is left out. The hint for each
 * coin × network is in the copy.
 */
export const COINS: Coin[] = [
  {
    id: "eth",
    name: "Ethereum",
    sym: "ETH",
    icon: "bg-ethereum",
    tint: "#8c8cff",
    glow: "rgb(130 140 255 / 0.45)",
    nets: ["ethereum"],
  },
  {
    id: "usdt",
    name: "Tether",
    sym: "USDT",
    icon: "bg-usdt",
    tint: "#26a17b",
    glow: "rgb(38 161 123 / 0.5)",
    nets: ["tron", "ton"],
  },
  {
    id: "ton",
    name: "Toncoin",
    sym: "TON",
    icon: "bg-ton",
    tint: "#0098ea",
    glow: "rgb(0 152 234 / 0.5)",
    nets: ["ton"],
  },
];
