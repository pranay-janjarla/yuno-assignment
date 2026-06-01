"use client"
import { useEffect, useState } from "react"
import { api, Agent } from "@/lib/api"
import Link from "next/link"

const TOOL_META: Record<string, { color: string; bg: string; label: string }> = {
  web_search:                { color: "#3B82F6", bg: "#EFF6FF", label: "Web Search" },
  database_query:            { color: "#8B5CF6", bg: "#F5F3FF", label: "Database Query" },
  yuno_list_connectors:      { color: "#0F6E56", bg: "#ECFDF5", label: "List Connectors" },
  yuno_get_approval_rate:    { color: "#0F6E56", bg: "#ECFDF5", label: "Approval Rate" },
  yuno_list_chargebacks:     { color: "#B45309", bg: "#FFFBEB", label: "Chargebacks" },
  yuno_get_transaction_detail: { color: "#B45309", bg: "#FFFBEB", label: "Txn Detail" },
}

function AgentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="4" width="14" height="10" rx="3" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6.5" cy="9" r="1.5" fill="currentColor" />
      <circle cx="11.5" cy="9" r="1.5" fill="currentColor" />
      <path d="M6.5 12q2.5 1.5 5 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export default function HomePage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.listAgents().then(setAgents).finally(() => setLoading(false))
  }, [])

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete agent "${name}"?`)) return
    await api.deleteAgent(id)
    setAgents(prev => prev.filter(a => a.id !== id))
  }

  const modelLabel = (m: string) =>
    m === "gpt-5" ? "GPT-5" : m?.includes("mini") ? "GPT-4o mini" : "GPT-4o"

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-xl font-bold text-[#1A1A2E] tracking-tight">Agents</h1>
          <p className="text-[#9CA3AF] mt-0.5 text-sm">
            {loading ? "Loading…" : `${agents.length} agent${agents.length !== 1 ? "s" : ""} configured`}
          </p>
        </div>
        <Link
          href="/create"
          className="inline-flex items-center gap-1.5 bg-[#534AB7] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#4840A0] transition-colors shadow-sm"
        >
          <span className="text-base leading-none">+</span>
          New Agent
        </Link>
      </div>

      {/* States */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-[#534AB7]/20 border-t-[#534AB7] rounded-full animate-spin" />
        </div>

      ) : agents.length === 0 ? (
        <div className="text-center py-20 bg-white border border-[#E8E8EC] rounded-2xl shadow-card">
          <div className="w-14 h-14 rounded-2xl bg-[#534AB7]/8 flex items-center justify-center mx-auto mb-4 text-[#534AB7]">
            <AgentIcon />
          </div>
          <h2 className="text-[#1A1A2E] font-semibold text-base mb-1.5">No agents yet</h2>
          <p className="text-[#9CA3AF] text-sm mb-6 max-w-xs mx-auto leading-relaxed">
            Describe what you need and AI will configure your first agent automatically
          </p>
          <Link
            href="/create"
            className="inline-flex items-center gap-1.5 bg-[#534AB7] text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#4840A0] transition-colors"
          >
            Create your first agent
          </Link>
        </div>

      ) : (
        <div className="grid gap-3">
          {agents.map(agent => (
            <div
              key={agent.id}
              className="group bg-white rounded-xl border border-[#E8E8EC] px-5 py-4 flex items-center gap-4 hover:border-[#534AB7]/40 hover:shadow-card-md transition-all"
            >
              {/* Icon */}
              <div className="w-10 h-10 rounded-xl bg-[#534AB7]/8 flex items-center justify-center flex-shrink-0 text-[#534AB7]">
                <AgentIcon />
              </div>

              {/* Main info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-[#1A1A2E] text-sm">{agent.name}</span>

                  {/* Active dot */}
                  <span className="flex items-center gap-1 text-[11px] text-[#10B981] font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                    Published
                  </span>

                  {/* Model chip */}
                  <span className="text-[11px] text-[#6B7280] bg-[#F7F7F9] border border-[#E8E8EC] px-2 py-0.5 rounded-full font-medium">
                    {modelLabel(agent.model)}
                  </span>
                </div>

                <p className="text-xs text-[#9CA3AF] mb-2 line-clamp-1">{agent.description}</p>

                <div className="flex flex-wrap gap-1">
                  {(agent.tools ?? []).slice(0, 5).map(t => {
                    const m = TOOL_META[t]
                    return (
                      <span
                        key={t}
                        className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                        style={m
                          ? { color: m.color, background: m.bg }
                          : { color: "#6B7280", background: "#F7F7F9" }
                        }
                      >
                        {m?.label ?? t.replace(/_/g, " ")}
                      </span>
                    )
                  })}
                  {(agent.tools ?? []).length > 5 && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full text-[#9CA3AF] bg-[#F7F7F9]">
                      +{(agent.tools ?? []).length - 5}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <Link
                  href={`/agents/${agent.id}`}
                  className="bg-[#534AB7] text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold hover:bg-[#4840A0] transition-colors"
                >
                  View
                </Link>
                <button
                  onClick={() => handleDelete(agent.id, agent.name)}
                  className="text-[#D1D5DB] hover:text-[#EF4444] p-1.5 rounded-lg hover:bg-[#FEF2F2] transition-colors"
                  title="Delete"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 3.5h10M5.5 3.5V2.5a1 1 0 011-1h1a1 1 0 011 1v1M5.5 6v5M8.5 6v5M3 3.5l.667 8a1 1 0 001 .917h4.666a1 1 0 001-.917L11 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
