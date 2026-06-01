import type { Metadata } from "next"
import "./globals.css"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Yuno Agent Platform",
  description: "AI agent orchestration for payments",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#F7F7F9] flex flex-col h-screen overflow-hidden font-sans">
        <nav className="bg-white border-b border-[#E8E8EC] px-5 flex items-center gap-1 h-[54px] flex-shrink-0">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 mr-4">
            <div className="w-7 h-7 rounded-lg bg-[#534AB7] flex items-center justify-center flex-shrink-0">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path
                  d="M7.5 1.5L13 4.5V10.5L7.5 13.5L2 10.5V4.5L7.5 1.5Z"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  fill="none"
                />
                <circle cx="7.5" cy="7.5" r="2" fill="white" />
              </svg>
            </div>
            <span className="text-sm font-bold text-[#1A1A2E] tracking-tight">Yuno Agents</span>
          </Link>

          <div className="w-px h-4 bg-[#E8E8EC] mr-1" />

          <Link
            href="/"
            className="px-3 py-1.5 text-sm text-[#6B7280] hover:text-[#1A1A2E] hover:bg-[#F7F7F9] rounded-lg transition-colors font-medium"
          >
            Agents
          </Link>
          <Link
            href="/workflow"
            className="px-3 py-1.5 text-sm text-[#6B7280] hover:text-[#1A1A2E] hover:bg-[#F7F7F9] rounded-lg transition-colors font-medium"
          >
            Workflows
          </Link>
          <Link
            href="/create"
            className="px-3 py-1.5 text-sm text-[#6B7280] hover:text-[#1A1A2E] hover:bg-[#F7F7F9] rounded-lg transition-colors font-medium"
          >
            Create
          </Link>
          <Link
            href="/monitoring"
            className="px-3 py-1.5 text-sm text-[#6B7280] hover:text-[#1A1A2E] hover:bg-[#F7F7F9] rounded-lg transition-colors font-medium"
          >
            Monitoring
          </Link>
          <Link
            href="/settings"
            className="px-3 py-1.5 text-sm text-[#6B7280] hover:text-[#1A1A2E] hover:bg-[#F7F7F9] rounded-lg transition-colors font-medium"
          >
            Settings
          </Link>

          <div className="flex-1" />

          {/* Avatar */}
          <div className="w-8 h-8 rounded-full bg-[#534AB7] flex items-center justify-center text-white text-xs font-bold select-none">
            Y
          </div>
        </nav>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </body>
    </html>
  )
}
