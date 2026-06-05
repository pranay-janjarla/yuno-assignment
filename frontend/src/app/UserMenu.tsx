"use client"
import { useEffect, useRef, useState } from "react"
import { auth, clearToken } from "@/lib/api"

export default function UserMenu() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  async function logout() {
    setBusy(true)
    try {
      await auth.logout()
    } finally {
      clearToken()
      window.dispatchEvent(new Event("yuno-unauthorized"))
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-8 h-8 rounded-full bg-[#534AB7] flex items-center justify-center text-white text-xs font-bold select-none hover:opacity-90 transition-opacity"
        aria-label="Account menu"
      >
        Y
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-44 bg-white border border-[#E8E8EC] rounded-xl shadow-lg py-1 z-50">
          <button
            onClick={logout}
            disabled={busy}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#DC2626] hover:bg-[#FEF2F2] disabled:opacity-50 text-left"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            {busy ? "Logging out…" : "Log out"}
          </button>
        </div>
      )}
    </div>
  )
}
