"use client"
import { useEffect, useState } from "react"
import { startRegistration, startAuthentication } from "@simplewebauthn/browser"
import { auth, setToken, type AuthStatus } from "@/lib/api"

const PURPLE = "#534AB7"

function Logo() {
  return (
    <div className="flex items-center gap-2 mb-6">
      <div className="w-9 h-9 rounded-lg bg-[#534AB7] flex items-center justify-center">
        <svg width="18" height="18" viewBox="0 0 15 15" fill="none">
          <path d="M7.5 1.5L13 4.5V10.5L7.5 13.5L2 10.5V4.5L7.5 1.5Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
          <circle cx="7.5" cy="7.5" r="2" fill="white" />
        </svg>
      </div>
      <span className="text-lg font-bold text-[#1A1A2E] tracking-tight">Yuno Agents</span>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F7F9] p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#E8E8EC] shadow-sm p-8">
        <Logo />
        {children}
      </div>
    </div>
  )
}

export default function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [err, setErr] = useState("")

  useEffect(() => {
    auth.status().then(setStatus).catch(() => setErr("Cannot reach the server."))
  }, [])

  if (err && !status) {
    return <Card><p className="text-sm text-red-600">{err}</p></Card>
  }
  if (!status) {
    return <Card><p className="text-sm text-[#6B7280]">Loading…</p></Card>
  }

  return (
    <Card>
      {status.configured
        ? <Login status={status} onAuthed={onAuthed} />
        : <Setup onAuthed={onAuthed} />}
    </Card>
  )
}

// ─── Login (app already configured) ───────────────────────────────────────────
function Login({ status, onAuthed }: { status: AuthStatus; onAuthed: () => void }) {
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState("")
  const [err, setErr] = useState("")

  async function biometric() {
    setErr(""); setBusy(true)
    try {
      const { state, options } = await auth.loginPasskeyBegin()
      const credential = await startAuthentication({ optionsJSON: JSON.parse(options) })
      const { token } = await auth.loginPasskeyComplete(state, credential)
      setToken(token)
      onAuthed()
    } catch (e: any) {
      setErr(e?.message || "Biometric sign-in failed or was cancelled.")
    } finally {
      setBusy(false)
    }
  }

  async function totp(e: React.FormEvent) {
    e.preventDefault()
    setErr(""); setBusy(true)
    try {
      const { token } = await auth.loginTotp(code.trim())
      setToken(token)
      onAuthed()
    } catch (e: any) {
      setErr(e?.message || "Invalid code.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-[#1A1A2E] mb-1">Sign in</h1>
      <p className="text-sm text-[#6B7280] mb-6">Use your biometric or an authenticator code.</p>

      {status.has_passkey && (
        <button
          onClick={biometric}
          disabled={busy}
          className="w-full mb-5 py-2.5 rounded-lg bg-[#534AB7] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <FingerprintIcon /> Use biometric
        </button>
      )}

      <div className="flex items-center gap-3 mb-5">
        <div className="h-px bg-[#E8E8EC] flex-1" />
        <span className="text-xs text-[#9CA3AF]">{status.has_passkey ? "or" : ""}</span>
        <div className="h-px bg-[#E8E8EC] flex-1" />
      </div>

      <form onSubmit={totp}>
        <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Authenticator code</label>
        <input
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          className="w-full px-3 py-2.5 rounded-lg border border-[#E8E8EC] text-center text-lg tracking-[0.3em] font-mono focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30"
        />
        <button
          type="submit"
          disabled={busy || code.length !== 6}
          className="w-full mt-3 py-2.5 rounded-lg border border-[#534AB7] text-[#534AB7] text-sm font-semibold hover:bg-[#534AB7]/5 disabled:opacity-50"
        >
          Continue
        </button>
      </form>

      {err && <p className="text-sm text-red-600 mt-4">{err}</p>}
    </div>
  )
}

// ─── Setup (first run) ────────────────────────────────────────────────────────
function Setup({ onAuthed }: { onAuthed: () => void }) {
  const [step, setStep] = useState<"totp" | "passkey">("totp")
  const [enroll, setEnroll] = useState<{ secret: string; qr: string } | null>(null)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  useEffect(() => {
    auth.setupTotpBegin()
      .then(d => setEnroll({ secret: d.secret, qr: d.qr }))
      .catch(() => setErr("Could not start setup."))
  }, [])

  async function verifyTotp(e: React.FormEvent) {
    e.preventDefault()
    setErr(""); setBusy(true)
    try {
      const { token } = await auth.setupTotpVerify(code.trim())
      setToken(token)               // logged in; app is now configured
      setStep("passkey")            // offer biometric on this device
    } catch (e: any) {
      setErr(e?.message || "Invalid code.")
    } finally {
      setBusy(false)
    }
  }

  async function addPasskey() {
    setErr(""); setBusy(true)
    try {
      const { state, options } = await auth.addPasskeyBegin()  // session-authed
      const credential = await startRegistration({ optionsJSON: JSON.parse(options) })
      await auth.addPasskeyComplete(state, credential)
      onAuthed()
    } catch (e: any) {
      setErr(e?.message || "Biometric setup failed or was cancelled.")
    } finally {
      setBusy(false)
    }
  }

  if (step === "passkey") {
    return (
      <div>
        <h1 className="text-xl font-bold text-[#1A1A2E] mb-1">Add biometric</h1>
        <p className="text-sm text-[#6B7280] mb-6">
          Authenticator is set up. Add this device&apos;s Touch ID / Face ID so you can sign in
          with a tap. You can skip this and still log in with your authenticator code.
        </p>
        <button
          onClick={addPasskey}
          disabled={busy}
          className="w-full py-2.5 rounded-lg bg-[#534AB7] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <FingerprintIcon /> Enable biometric on this device
        </button>
        <button
          onClick={onAuthed}
          disabled={busy}
          className="w-full mt-3 py-2.5 rounded-lg border border-[#E8E8EC] text-[#6B7280] text-sm font-medium hover:bg-[#F7F7F9] disabled:opacity-50"
        >
          Skip for now
        </button>
        {err && <p className="text-sm text-red-600 mt-4">{err}</p>}
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-[#1A1A2E] mb-1">Set up your authenticator</h1>
      <p className="text-sm text-[#6B7280] mb-5">
        Scan this with Google Authenticator, Authy, or 1Password, then enter the 6-digit code.
      </p>

      {enroll ? (
        <>
          <div className="flex justify-center mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enroll.qr} alt="Authenticator QR code" className="w-44 h-44 rounded-lg border border-[#E8E8EC]" />
          </div>
          <p className="text-[11px] text-[#9CA3AF] text-center mb-5 break-all">
            Can&apos;t scan? Enter this key: <span className="font-mono text-[#6B7280]">{enroll.secret}</span>
          </p>
          <form onSubmit={verifyTotp}>
            <input
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="w-full px-3 py-2.5 rounded-lg border border-[#E8E8EC] text-center text-lg tracking-[0.3em] font-mono focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30"
            />
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="w-full mt-3 py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-50"
              style={{ background: PURPLE }}
            >
              Verify &amp; continue
            </button>
          </form>
        </>
      ) : (
        <p className="text-sm text-[#6B7280]">Preparing…</p>
      )}
      {err && <p className="text-sm text-red-600 mt-4">{err}</p>}
    </div>
  )
}

function FingerprintIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4" />
      <path d="M5 19.5C5.5 18 6 16 6 12a6 6 0 0 1 12 0v3" />
      <path d="M12 12v6" />
      <path d="M9 12a3 3 0 0 1 6 0v3" />
      <path d="M18 18.72a9 9 0 0 0 .6-3.72" />
    </svg>
  )
}
