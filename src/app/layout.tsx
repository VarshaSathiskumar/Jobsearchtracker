import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Job Tracker", template: "%s | Job Tracker" },
  description: "A private, AI-assisted tracker for your job applications, built from your Gmail.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#f5f6fb", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
        <Toaster richColors closeButton position="top-right" />
      </body>
    </html>
  );
}
