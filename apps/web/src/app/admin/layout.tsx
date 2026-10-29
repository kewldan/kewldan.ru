import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";

import "./admin.css";

const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <div className={schibsted.variable}>{children}</div>;
}
