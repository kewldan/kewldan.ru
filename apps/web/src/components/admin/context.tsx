"use client";

import { createContext, useContext } from "react";

import type { Board } from "@/lib/admin";
import type { Content } from "@/lib/api/generated/Content";
import type { ProbeStatus } from "@/lib/api/generated/ProbeStatus";
import type { SiteSettings } from "@/lib/api/generated/SiteSettings";
import type { Credential } from "@/lib/admin-auth";

export type Section = "overview" | "pixels" | "projects" | "site" | "security";

export type Data = {
  board: Board | null;
  settings: SiteSettings | null;
  content: Content | null;
  status: Record<string, ProbeStatus> | null;
  health: { status: string; board: string } | null;
};

export type Admin = {
  /** The token, or `null` for the passkey session cookie. */
  cred: Credential;
  data: Data;
  reload: (what: keyof Data) => Promise<void>;
  /** Saves the settings; throws the API's error code. */
  saveSettings: (next: SiteSettings) => Promise<void>;
  go: (section: Section) => void;
  /** The session ended under us: back to the sign-in. */
  expired: (err: unknown) => boolean;
};

export const AdminContext = createContext<Admin | null>(null);

export function useAdmin() {
  const admin = useContext(AdminContext);
  if (!admin) throw new Error("useAdmin outside the admin");
  return admin;
}
