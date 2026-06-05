"use client"
import { useEffect, useState } from "react"
import { auth } from "@/lib/api"
import AuthScreen from "./AuthScreen"

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "in" | "out">("checking")

  async function check() {
    setState((await auth.me()) ? "in" : "out")
  }

  useEffect(() => {
    check()
    // Any 401 from authFetch flips us back to the login screen.
    const onUnauthorized = () => setState("out")
    window.addEventListener("yuno-unauthorized", onUnauthorized)
    return () => window.removeEventListener("yuno-unauthorized", onUnauthorized)
  }, [])

  if (state === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F7F9]">
        <div className="w-6 h-6 rounded-full border-2 border-[#E8E8EC] border-t-[#534AB7] animate-spin" />
      </div>
    )
  }

  if (state === "out") {
    return <AuthScreen onAuthed={() => setState("in")} />
  }

  return <>{children}</>
}
