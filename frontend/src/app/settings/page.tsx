"use client"
import { useEffect, useState, useRef } from "react"
import { api, Credential } from "@/lib/api"

const GROUP_ORDER = ["AI Models", "Telegram", "Yuno API", "App", "Custom"]
const GROUP_ICONS: Record<string, string> = {
  "AI Models": "🧠",
  "Telegram":  "✈️",
  "Yuno API":  "💳",
  "App":       "⚙️",
  "Custom":    "🔑",
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 2l12 12M6.5 6.6A2 2 0 0010.4 9.5M4.2 4.3C2.8 5.3 1 8 1 8s2.5 5 7 5c1.4 0 2.7-.4 3.8-1M6 3.1C6.6 3 7.3 3 8 3c4.5 0 7 5 7 5s-.7 1.4-1.9 2.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2.5 7l3 3 6-6" stroke="#10B981" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// ─── Credential row ───────────────────────────────────────────────────────────

function CredentialRow({
  cred, onSaved, onDelete,
}: {
  cred: Credential
  onSaved: (key: string, value: string) => void
  onDelete?: (key: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [visible, setVisible] = useState(false)
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setValue("")
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [editing])

  const handleSave = async () => {
    if (!value.trim()) { setEditing(false); return }
    setSaving(true)
    try {
      await api.updateCredentials([{ key: cred.key, value: value.trim() }])
      onSaved(cred.key, value.trim())
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      setEditing(false)
      setValue("")
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave()
    if (e.key === "Escape") { setEditing(false); setValue("") }
  }

  return (
    <div className="flex items-center gap-3 py-3.5 border-b border-[#F0F0F4] last:border-0">
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cred.is_set ? "bg-[#10B981]" : cred.required ? "bg-[#F59E0B]" : "bg-[#D1D5DB]"}`} />

      <div className="w-44 flex-shrink-0">
        <div className="text-sm font-medium text-[#1A1A2E]">{cred.label}</div>
        <div className="text-[11px] text-[#9CA3AF] font-mono">{cred.key}</div>
      </div>

      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type={cred.secret && !visible ? "password" : "text"}
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Enter ${cred.label}`}
                className="w-full px-3 py-1.5 text-sm border border-[#534AB7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#534AB7]/20 font-mono bg-white"
              />
              {cred.secret && (
                <button type="button" onClick={() => setVisible(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#6B7280]">
                  <EyeIcon open={visible} />
                </button>
              )}
            </div>
            <button onClick={handleSave} disabled={saving}
              className="px-3 py-1.5 bg-[#534AB7] text-white text-xs font-semibold rounded-lg hover:bg-[#4840A0] disabled:opacity-50 transition-colors flex-shrink-0">
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => { setEditing(false); setValue("") }}
              className="px-3 py-1.5 text-xs text-[#6B7280] hover:text-[#1A1A2E] rounded-lg hover:bg-[#F7F7F9] flex-shrink-0">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className={`text-sm font-mono ${cred.is_set ? "text-[#374151]" : "text-[#9CA3AF]"}`}>
              {cred.is_set ? (cred.secret ? cred.masked_value : cred.masked_value || "—") : "Not set"}
            </span>
            {saved && (
              <span className="flex items-center gap-1 text-[#10B981] text-xs font-medium">
                <CheckIcon /> Saved
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {!editing && (
          <button onClick={() => setEditing(true)}
            className="text-xs text-[#534AB7] font-semibold hover:underline">
            {cred.is_set ? "Update" : "Set"}
          </button>
        )}
        {cred.user_defined && onDelete && !editing && (
          <button
            onClick={() => {
              if (confirm(`Delete credential "${cred.label}" (${cred.key})?`)) onDelete(cred.key)
            }}
            className="text-xs text-[#EF4444] hover:text-[#DC2626] font-medium hover:underline"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Add Credential Modal ─────────────────────────────────────────────────────

function AddCredentialModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (cred: Credential) => void
}) {
  const [label, setLabel] = useState("")
  const [key, setKey] = useState("")
  const [value, setValue] = useState("")
  const [group, setGroup] = useState("Custom")
  const [secret, setSecret] = useState(true)
  const [showValue, setShowValue] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const labelRef = useRef<HTMLInputElement>(null)

  useEffect(() => { labelRef.current?.focus() }, [])

  // Auto-generate key from label
  useEffect(() => {
    setKey(label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, ""))
  }, [label])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!label.trim() || !value.trim()) return
    setSaving(true)
    setError("")
    try {
      const cred = await api.createCustomCredential({ label, key: key || undefined, value, group, secret })
      onCreated({ ...cred, required: false, user_defined: true, masked_value: secret ? value.slice(0,4)+"••••"+value.slice(-4) : value })
      onClose()
    } catch (e: any) {
      setError(e.message?.includes("409") ? `Key "${key}" already exists.` : e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-[#F0F0F4] flex items-center justify-between">
          <h2 className="text-base font-bold text-[#1A1A2E]">Add Credential</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-[#C4C4CC] hover:text-[#6B7280] hover:bg-[#F7F7F9] rounded-lg">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[11px] uppercase tracking-widest font-bold text-[#9CA3AF] mb-1.5">Label *</label>
            <input ref={labelRef} value={label} onChange={e => setLabel(e.target.value)} required
              placeholder="My API Key"
              className="w-full px-3 py-2 text-sm border border-[#E8E8EC] rounded-lg focus:outline-none focus:border-[#534AB7] focus:ring-2 focus:ring-[#534AB7]/15 bg-[#F7F7F9]" />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-widest font-bold text-[#9CA3AF] mb-1.5">Key (env var name)</label>
            <input value={key} onChange={e => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
              placeholder="MY_API_KEY"
              className="w-full px-3 py-2 text-sm border border-[#E8E8EC] rounded-lg focus:outline-none focus:border-[#534AB7] focus:ring-2 focus:ring-[#534AB7]/15 font-mono bg-[#F7F7F9]" />
            <p className="mt-1 text-[10px] text-[#9CA3AF]">Auto-generated from label. Used in the credential picker.</p>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-widest font-bold text-[#9CA3AF] mb-1.5">Value *</label>
            <div className="relative">
              <input value={value} onChange={e => setValue(e.target.value)} required
                type={secret && !showValue ? "password" : "text"}
                placeholder="Paste your credential value"
                className="w-full px-3 py-2 text-sm border border-[#E8E8EC] rounded-lg focus:outline-none focus:border-[#534AB7] focus:ring-2 focus:ring-[#534AB7]/15 font-mono bg-[#F7F7F9] pr-10" />
              <button type="button" onClick={() => setShowValue(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#6B7280]">
                <EyeIcon open={showValue} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-[11px] uppercase tracking-widest font-bold text-[#9CA3AF] mb-1.5">Group</label>
              <select value={group} onChange={e => setGroup(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#E8E8EC] rounded-lg focus:outline-none focus:border-[#534AB7] bg-[#F7F7F9]">
                {["Custom", "AI Models", "Telegram", "Yuno API", "App"].map(g => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-widest font-bold text-[#9CA3AF] mb-1.5">Secret</label>
              <button type="button" onClick={() => setSecret(s => !s)}
                className={`w-10 h-6 rounded-full transition-colors flex items-center ${secret ? "bg-[#534AB7]" : "bg-[#D1D5DB]"}`}>
                <span className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform mx-1 ${secret ? "translate-x-4" : ""}`} />
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-[#EF4444]">{error}</p>}

          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={saving || !label.trim() || !value.trim()}
              className="flex-1 py-2.5 bg-[#534AB7] text-white text-sm font-semibold rounded-xl hover:bg-[#4840A0] disabled:opacity-40 transition-colors">
              {saving ? "Saving…" : "Save Credential"}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 text-sm text-[#6B7280] hover:text-[#1A1A2E] hover:bg-[#F7F7F9] rounded-xl transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [showAddModal, setShowAddModal] = useState(false)

  useEffect(() => {
    api.getCredentials()
      .then(setCredentials)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const handleSaved = (key: string, value: string) => {
    setCredentials(prev =>
      prev.map(c =>
        c.key === key
          ? { ...c, is_set: true, masked_value: c.secret ? value.slice(0, 4) + "••••" + value.slice(-4) : value }
          : c
      )
    )
  }

  const handleCreated = (cred: Credential) => {
    setCredentials(prev => [...prev, cred])
  }

  const handleDelete = async (key: string) => {
    try {
      await api.deleteCustomCredential(key)
      setCredentials(prev => prev.filter(c => c.key !== key))
    } catch (e: any) {
      alert("Failed to delete: " + e.message)
    }
  }

  // Merge user-defined credentials into their configured group
  const grouped = GROUP_ORDER.map(group => ({
    group,
    items: credentials.filter(c => c.group === group),
  })).filter(g => g.items.length > 0)

  const totalSet = credentials.filter(c => c.is_set).length
  const totalRequired = credentials.filter(c => c.required).length
  const requiredSet = credentials.filter(c => c.required && c.is_set).length

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {showAddModal && (
        <AddCredentialModal
          onClose={() => setShowAddModal(false)}
          onCreated={handleCreated}
        />
      )}

      {/* Header */}
      <div className="mb-7 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#1A1A2E] tracking-tight">Settings</h1>
          <p className="text-[#9CA3AF] mt-0.5 text-sm">
            {loading ? "Loading…" : `${totalSet} of ${credentials.length} credentials configured · ${requiredSet}/${totalRequired} required`}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#534AB7] text-white text-sm font-semibold rounded-xl hover:bg-[#4840A0] transition-colors shadow-sm"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          Add Credential
        </button>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-[#534AB7]/20 border-t-[#534AB7] rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {grouped.map(({ group, items }) => (
            <div key={group} className="bg-white rounded-xl border border-[#E8E8EC] overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-[#F0F0F4] bg-[#FAFAFA] flex items-center gap-2">
                <span className="text-base">{GROUP_ICONS[group] ?? "🔑"}</span>
                <span className="text-sm font-semibold text-[#1A1A2E]">{group}</span>
                <span className="ml-auto text-xs text-[#9CA3AF]">
                  {items.filter(c => c.is_set).length}/{items.length} set
                </span>
              </div>
              <div className="px-5">
                {items.map(cred => (
                  <CredentialRow
                    key={cred.key}
                    cred={cred}
                    onSaved={handleSaved}
                    onDelete={cred.user_defined ? handleDelete : undefined}
                  />
                ))}
              </div>
            </div>
          ))}

          {credentials.length === 0 && (
            <div className="text-center py-12 text-[#9CA3AF] text-sm">No credentials configured.</div>
          )}

          <div className="flex items-center gap-4 text-[11px] text-[#9CA3AF] mt-1">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#10B981]" /> Set</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#F59E0B]" /> Required — not set</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#D1D5DB]" /> Optional — not set</span>
          </div>
        </div>
      )}
    </div>
  )
}
