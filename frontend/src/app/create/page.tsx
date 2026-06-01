"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { api, AgentConfig } from "@/lib/api"

type Step = "describe" | "review" | "creating"

const EXAMPLES = [
  "Monitor our payment approval rates across all PSP connectors and alert me when any drops below 85%",
  "Investigate open chargebacks by looking up transaction details and summarize patterns",
  "Search the web for the latest news on payment fraud trends and summarize findings",
  "Query the payments database to find the top 3 connectors by transaction volume this week",
]

const ALL_TOOLS = [
  { id: "web_search",                  label: "Web Search",          category: "General",       icon: "🔍" },
  { id: "database_query",              label: "Database Query",       category: "General",       icon: "🗄" },
  { id: "yuno_list_connectors",        label: "List Connectors",      category: "Yuno Payments", icon: "🔗" },
  { id: "yuno_get_approval_rate",      label: "Approval Rate",        category: "Yuno Payments", icon: "📈" },
  { id: "yuno_list_chargebacks",       label: "List Chargebacks",     category: "Yuno Payments", icon: "↩" },
  { id: "yuno_get_transaction_detail", label: "Transaction Detail",   category: "Yuno Payments", icon: "🧾" },
]

const INPUT_CLASS =
  "w-full px-3 py-2.5 border border-[#E8E8EC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/20 focus:border-[#534AB7] transition-colors bg-white placeholder-[#C4C4CC]"

export default function CreatePage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("describe")
  const [description, setDescription] = useState("")
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [editedConfig, setEditedConfig] = useState<AgentConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleGenerate = async () => {
    if (!description.trim()) return
    setLoading(true)
    setError("")
    try {
      const result = await api.generateConfig(description)
      setConfig(result)
      setEditedConfig({ ...result })
      setStep("review")
    } catch (e: any) {
      setError(e.message ?? "Failed to generate config")
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!editedConfig) return
    setStep("creating")
    try {
      const agent = await api.createAgent({
        ...editedConfig,
        description: editedConfig.enhanced_description,
      })
      router.push(`/agents/${agent.id}`)
    } catch (e: any) {
      setError(e.message ?? "Failed to create agent")
      setStep("review")
    }
  }

  const updateField = (field: keyof AgentConfig, value: any) =>
    setEditedConfig(prev => prev ? { ...prev, [field]: value } : prev)

  const toggleTool = (tool: string) => {
    setEditedConfig(prev => {
      if (!prev) return prev
      const tools = prev.tools.includes(tool)
        ? prev.tools.filter(t => t !== tool)
        : [...prev.tools, tool]
      return { ...prev, tools }
    })
  }

  // ── Step 1: Describe ──────────────────────────────────────────────────────────

  if (step === "describe") {
    return (
      <div className="max-w-xl mx-auto px-6 py-10">

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-xl font-bold text-[#1A1A2E] tracking-tight mb-1.5">Create an Agent</h1>
          <p className="text-[#9CA3AF] text-sm leading-relaxed">
            Describe what you need in plain English — AI will configure the right tools, system prompt, and model.
          </p>
        </div>

        {/* Input card */}
        <div className="bg-white rounded-2xl border border-[#E8E8EC] p-6 shadow-card mb-4">
          <label className="block text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-2">
            What should your agent do?
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Monitor payment approval rates across PSP connectors and alert when any drops below 85%"
            className={`${INPUT_CLASS} h-28 resize-none`}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate() }}
          />

          {error && (
            <div className="mt-3 flex items-center gap-2 text-xs text-[#EF4444] bg-[#FEF2F2] border border-[#FCA5A5]/40 rounded-lg px-3 py-2">
              <span>⚠</span> {error}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={!description.trim() || loading}
            className="mt-4 w-full bg-[#534AB7] text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-[#4840A0] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating configuration…
              </>
            ) : (
              <>Generate Agent Config →</>
            )}
          </button>
        </div>

        {/* Examples */}
        <p className="text-[11px] text-[#C4C4CC] uppercase tracking-widest font-semibold mb-3 px-1">
          Try an example
        </p>
        <div className="grid gap-2">
          {EXAMPLES.map(ex => (
            <button
              key={ex}
              onClick={() => setDescription(ex)}
              className="text-left text-sm text-[#6B7280] px-4 py-3 bg-white border border-[#E8E8EC] rounded-xl hover:border-[#534AB7]/40 hover:text-[#1A1A2E] hover:shadow-card transition-all"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Step 2: Review ────────────────────────────────────────────────────────────

  if (step === "review" && editedConfig) {
    const toolsByCategory = ALL_TOOLS.reduce<Record<string, typeof ALL_TOOLS>>((acc, t) => {
      acc[t.category] ??= []
      acc[t.category].push(t)
      return acc
    }, {})

    return (
      <div className="max-w-xl mx-auto px-6 py-10">

        {/* Page header */}
        <div className="flex items-start justify-between mb-7">
          <div>
            <h1 className="text-xl font-bold text-[#1A1A2E] tracking-tight mb-1">Review Configuration</h1>
            <p className="text-[#9CA3AF] text-sm">AI generated this — review and edit before creating.</p>
          </div>
          <button
            onClick={() => setStep("describe")}
            className="text-sm text-[#9CA3AF] hover:text-[#1A1A2E] transition-colors flex items-center gap-1"
          >
            ← Back
          </button>
        </div>

        {/* AI reasoning */}
        {config?.reasoning && (
          <div className="flex gap-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-4 py-3 mb-5 text-sm text-[#92400E]">
            <span className="flex-shrink-0 mt-0.5">✦</span>
            <span><strong>AI reasoning:</strong> {config.reasoning}</span>
          </div>
        )}

        <div className="space-y-4">

          {/* Name */}
          <div className="bg-white rounded-xl border border-[#E8E8EC] p-5 shadow-card">
            <label className="block text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide mb-2">
              Agent Name
            </label>
            <input
              value={editedConfig.name}
              onChange={e => updateField("name", e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          {/* Description */}
          <div className="bg-white rounded-xl border border-[#E8E8EC] p-5 shadow-card">
            <label className="block text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide mb-2">
              Description
            </label>
            <textarea
              value={editedConfig.enhanced_description}
              onChange={e => updateField("enhanced_description", e.target.value)}
              className={`${INPUT_CLASS} h-20 resize-none`}
            />
          </div>

          {/* Model */}
          <div className="bg-white rounded-xl border border-[#E8E8EC] p-5 shadow-card">
            <label className="block text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide mb-2">
              Model
            </label>
            <select
              value={editedConfig.model}
              onChange={e => updateField("model", e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="gpt-5">GPT-5 — most capable</option>
              <option value="gpt-4o">GPT-4o — fast &amp; capable</option>
              <option value="gpt-4o-mini">GPT-4o mini — fastest</option>
            </select>
          </div>

          {/* System Prompt */}
          <div className="bg-white rounded-xl border border-[#E8E8EC] p-5 shadow-card">
            <label className="block text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide mb-2">
              System Prompt
            </label>
            <textarea
              value={editedConfig.system_prompt}
              onChange={e => updateField("system_prompt", e.target.value)}
              className={`${INPUT_CLASS} h-36 resize-none font-mono text-xs`}
            />
          </div>

          {/* Tools */}
          <div className="bg-white rounded-xl border border-[#E8E8EC] p-5 shadow-card">
            <label className="block text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide mb-4">
              Tools
            </label>
            <div className="space-y-4">
              {Object.entries(toolsByCategory).map(([cat, tools]) => (
                <div key={cat}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#C4C4CC] mb-2 px-0.5">{cat}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {tools.map(tool => {
                      const active = editedConfig.tools.includes(tool.id)
                      return (
                        <button
                          key={tool.id}
                          onClick={() => toggleTool(tool.id)}
                          className={`text-left px-3 py-2.5 rounded-xl border text-sm transition-all ${
                            active
                              ? "border-[#534AB7] bg-[#534AB7]/5 text-[#534AB7]"
                              : "border-[#E8E8EC] text-[#9CA3AF] hover:border-[#C4C4CC] hover:text-[#6B7280]"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-base">{tool.icon}</span>
                            <div>
                              <div className="font-semibold text-xs">{tool.label}</div>
                              <div className="text-[10px] opacity-60 mt-0.5">{tool.category}</div>
                            </div>
                            {active && (
                              <span className="ml-auto text-[#534AB7]">
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                  <circle cx="7" cy="7" r="6" fill="#534AB7"/>
                                  <path d="M4.5 7l2 2 3-3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 text-xs text-[#EF4444] bg-[#FEF2F2] border border-[#FCA5A5]/40 rounded-lg px-3 py-2">
            <span>⚠</span> {error}
          </div>
        )}

        <button
          onClick={handleCreate}
          className="mt-6 w-full bg-[#534AB7] text-white py-3 rounded-xl text-sm font-bold hover:bg-[#4840A0] transition-colors shadow-card-md"
        >
          Create Agent
        </button>
      </div>
    )
  }

  // ── Step 3: Creating ──────────────────────────────────────────────────────────

  return (
    <div className="flex items-center justify-center py-32">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-[#534AB7]/20 border-t-[#534AB7] rounded-full animate-spin mx-auto mb-5" />
        <p className="text-[#6B7280] text-sm font-medium">Creating your agent…</p>
      </div>
    </div>
  )
}
