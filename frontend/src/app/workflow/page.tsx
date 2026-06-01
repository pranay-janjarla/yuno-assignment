"use client"
import { useEffect, useState } from "react"
import { api, type Workflow } from "@/lib/api"
import Link from "next/link"

function WorkflowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="6" width="5" height="5" rx="2" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="12" y="2" width="5" height="5" rx="2" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="12" y="11" width="5" height="5" rx="2" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M6 8.5h3.5V4.5H12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 8.5h3.5v5H12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export default function WorkflowListPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.listWorkflows().then(setWorkflows).finally(() => setLoading(false))
  }, [])

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete workflow "${name}"?`)) return
    await api.deleteWorkflow(id)
    setWorkflows(prev => prev.filter(w => w.id !== id))
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-xl font-bold text-[#1A1A2E] tracking-tight">Workflows</h1>
          <p className="text-[#9CA3AF] mt-0.5 text-sm">
            {loading ? "Loading…" : `${workflows.length} workflow${workflows.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <Link
          href="/workflow/new"
          className="inline-flex items-center gap-1.5 bg-[#534AB7] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#4840A0] transition-colors shadow-sm"
        >
          <span className="text-base leading-none">+</span>
          New Workflow
        </Link>
      </div>

      {/* States */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-[#534AB7]/20 border-t-[#534AB7] rounded-full animate-spin" />
        </div>

      ) : workflows.length === 0 ? (
        <div className="text-center py-20 bg-white border border-[#E8E8EC] rounded-2xl shadow-card">
          <div className="w-14 h-14 rounded-2xl bg-[#534AB7]/8 flex items-center justify-center mx-auto mb-4 text-[#534AB7]">
            <WorkflowIcon />
          </div>
          <h2 className="text-[#1A1A2E] font-semibold text-base mb-1.5">No workflows yet</h2>
          <p className="text-[#9CA3AF] text-sm mb-6 max-w-xs mx-auto leading-relaxed">
            Connect agents together visually to build automated payment pipelines
          </p>
          <Link
            href="/workflow/new"
            className="inline-flex items-center gap-1.5 bg-[#534AB7] text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#4840A0] transition-colors"
          >
            Create your first workflow
          </Link>
        </div>

      ) : (
        <div className="grid gap-3">
          {workflows.map((wf, i) => (
            <div
              key={wf.id}
              className="group bg-white rounded-xl border border-[#E8E8EC] px-5 py-4 flex items-center gap-4 hover:border-[#534AB7]/40 hover:shadow-card-md transition-all"
            >
              {/* Icon */}
              <div className="w-10 h-10 rounded-xl bg-[#534AB7]/8 flex items-center justify-center flex-shrink-0 text-[#534AB7]">
                <WorkflowIcon />
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5 mb-0.5">
                  <span className="font-semibold text-[#1A1A2E] text-sm">{wf.name}</span>
                  {/* Status — alternate Published / Archived for visual demo */}
                  {i % 3 !== 1 ? (
                    <span className="flex items-center gap-1 text-[11px] text-[#10B981] font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                      Published
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] text-[#9CA3AF] font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#D1D5DB]" />
                      Archived
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#C4C4CC]">
                  {wf.nodes.length} node{wf.nodes.length !== 1 ? "s" : ""} ·{" "}
                  {wf.edges.length} connection{wf.edges.length !== 1 ? "s" : ""}
                  {wf.created_at ? ` · ${new Date(wf.created_at).toLocaleDateString()}` : ""}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <Link
                  href={`/workflow/${wf.id}`}
                  className="bg-[#534AB7] text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold hover:bg-[#4840A0] transition-colors"
                >
                  View
                </Link>
                <button
                  onClick={() => handleDelete(wf.id, wf.name)}
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
