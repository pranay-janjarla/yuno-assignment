"use client"
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { api, Agent } from "@/lib/api"
import Link from "next/link"

const ALL_TOOLS = [
  { id: "web_search",                  label: "Web Search",         category: "General",       color: "#3B82F6" },
  { id: "database_query",              label: "Database Query",      category: "General",       color: "#8B5CF6" },
  { id: "yuno_list_connectors",        label: "List Connectors",     category: "Yuno",          color: "#0F6E56" },
  { id: "yuno_get_approval_rate",      label: "Approval Rate",       category: "Yuno",          color: "#0F6E56" },
  { id: "yuno_list_chargebacks",       label: "Chargebacks",         category: "Yuno",          color: "#B45309" },
  { id: "yuno_get_transaction_detail", label: "Transaction Detail",  category: "Yuno",          color: "#B45309" },
]

function modelLabel(m: string) {
  return m === "gpt-5" ? "GPT-5" : m?.includes("mini") ? "GPT-4o mini" : "GPT-4o"
}

export default function AgentPage() {
  const { id } = useParams<{ id: string }>()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [task, setTask] = useState("")
  const [answer, setAnswer] = useState("")
  const [running, setRunning] = useState(false)
  const [error, setError] = useState("")
  const [editingTools, setEditingTools] = useState(false)
  const [savingTools, setSavingTools] = useState(false)

  const toggleTool = async (toolId: string) => {
    if (!agent) return
    const current = agent.tools ?? []
    const updated = current.includes(toolId)
      ? current.filter(t => t !== toolId)
      : [...current, toolId]
    setSavingTools(true)
    const patched = await api.patchAgent(id, { tools: updated })
    setAgent(patched)
    setSavingTools(false)
  }

  useEffect(() => {
    api.getAgent(id).then(setAgent).catch(() => setError("Agent not found"))
  }, [id])

  const handleRun = async () => {
    if (!task.trim() || running) return
    setRunning(true)
    setAnswer("")
    setError("")
    try {
      for await (const event of api.streamTaskFetch(id, task)) {
        if (event.type === "text") setAnswer(event.message)
        if (event.type === "done") break
      }
    } catch (e: any) {
      setError(e.message ?? "Task failed")
    } finally {
      setRunning(false)
    }
  }

  if (!agent && !error) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-[#534AB7]/20 border-t-[#534AB7] rounded-full animate-spin" />
      </div>
    )
  }

  if (error && !agent) {
    return (
      <div className="text-center py-20">
        <p className="text-[#EF4444] mb-4 text-sm">{error}</p>
        <Link href="/" className="text-[#534AB7] hover:underline text-sm">← Back to agents</Link>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">

      {/* Breadcrumb */}
      <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-[#9CA3AF] hover:text-[#6B7280] mb-5 transition-colors">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        All agents
      </Link>

      {/* Agent card */}
      <div className="bg-white rounded-2xl border border-[#E8E8EC] p-6 shadow-card mb-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#534AB7]/8 flex items-center justify-center text-[#534AB7] flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="5" width="16" height="11" rx="3.5" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="7" cy="10.5" r="2" fill="currentColor"/>
                <circle cx="13" cy="10.5" r="2" fill="currentColor"/>
                <path d="M7 13.5q3 2 6 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-[#1A1A2E]">{agent!.name}</h1>
              <p className="text-xs text-[#9CA3AF] mt-0.5">{agent!.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px] text-[#10B981] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
              Published
            </span>
            <span className="text-[11px] bg-[#F7F7F9] border border-[#E8E8EC] text-[#6B7280] px-2.5 py-1 rounded-full font-medium">
              {modelLabel(agent!.model)}
            </span>
          </div>
        </div>

        {/* Tools section */}
        <div className="border-t border-[#F3F3F5] pt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold text-[#C4C4CC] uppercase tracking-widest">Tools</span>
            <button
              onClick={() => setEditingTools(t => !t)}
              className="text-xs text-[#534AB7] hover:text-[#4840A0] font-medium transition-colors"
            >
              {editingTools ? "Done" : "Edit"}
            </button>
          </div>

          {editingTools ? (
            <div className="grid grid-cols-3 gap-2">
              {ALL_TOOLS.map(tool => {
                const active = (agent!.tools ?? []).includes(tool.id)
                return (
                  <button
                    key={tool.id}
                    onClick={() => toggleTool(tool.id)}
                    disabled={savingTools}
                    className={`text-left px-3 py-2 rounded-xl border text-xs transition-all disabled:opacity-50 ${
                      active
                        ? "border-[#534AB7] bg-[#534AB7]/5 text-[#534AB7]"
                        : "border-[#E8E8EC] text-[#9CA3AF] hover:border-[#C4C4CC]"
                    }`}
                  >
                    <div className="font-semibold">{tool.label}</div>
                    <div className="opacity-50 text-[10px] mt-0.5">{tool.category}</div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {(agent!.tools ?? []).map(t => {
                const meta = ALL_TOOLS.find(a => a.id === t)
                return (
                  <span
                    key={t}
                    className="text-[11px] px-2.5 py-1 rounded-full font-medium border"
                    style={meta
                      ? { color: meta.color, background: `${meta.color}12`, borderColor: `${meta.color}30` }
                      : { color: "#6B7280", background: "#F7F7F9", borderColor: "#E8E8EC" }
                    }
                  >
                    {meta?.label ?? t.replace(/_/g, " ")}
                  </span>
                )
              })}
              {(agent!.tools ?? []).length === 0 && (
                <span className="text-xs text-[#C4C4CC]">No tools — click Edit to add some</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Task input */}
      <div className="bg-white rounded-2xl border border-[#E8E8EC] p-5 shadow-card mb-5">
        <label className="block text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide mb-2">
          Give this agent a task
        </label>
        <textarea
          value={task}
          onChange={e => setTask(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRun() }}
          placeholder="e.g. Check all connectors and report any with approval rate below 85%"
          disabled={running}
          className="w-full h-24 px-3 py-2.5 border border-[#E8E8EC] rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#534AB7]/20 focus:border-[#534AB7] disabled:bg-[#FAFAFA] transition-colors placeholder-[#C4C4CC]"
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-[#C4C4CC]">⌘↵ to run</span>
          <button
            onClick={handleRun}
            disabled={!task.trim() || running}
            className="bg-[#534AB7] text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-[#4840A0] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {running && (
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {running ? "Running…" : "Run Task"}
          </button>
        </div>
      </div>

      {/* Answer panel */}
      {(answer || running) && (
        <div className="bg-white rounded-2xl border border-[#E8E8EC] shadow-card overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-[#F3F3F5]">
            {running ? (
              <span className="w-2 h-2 rounded-full bg-[#534AB7] animate-pulse" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-[#10B981]" />
            )}
            <span className="text-xs font-semibold text-[#6B7280]">
              {running ? "Thinking…" : "Answer"}
            </span>
          </div>
          <div className="px-5 py-4">
            {running && !answer ? (
              <div className="flex items-center gap-2 text-sm text-[#9CA3AF]">
                <span className="w-4 h-4 border-2 border-[#534AB7]/20 border-t-[#534AB7] rounded-full animate-spin" />
                Working on it…
              </div>
            ) : (
              <p className="text-sm text-[#1A1A2E] leading-relaxed whitespace-pre-wrap">{answer}</p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-center gap-2 text-xs text-[#EF4444] bg-[#FEF2F2] border border-[#FCA5A5]/40 rounded-xl px-4 py-3">
          <span>⚠</span> {error}
        </div>
      )}
    </div>
  )
}
