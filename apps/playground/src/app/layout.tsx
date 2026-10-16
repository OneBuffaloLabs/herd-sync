import type { Metadata } from "next";
import { ReactNode } from "react";

export const metadata: Metadata = {
  title: "HerdSync Playground",
  description: "Static export integration testbed for @onebuffalo/herd-sync",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", margin: 0, padding: "2rem" }}>
        {children}
      </body>
    </html>
  );
}
