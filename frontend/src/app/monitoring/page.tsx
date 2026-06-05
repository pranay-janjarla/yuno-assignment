"use client"
import { useEffect, useRef, useState, useCallback } from "react"
import { getToken } from "@/lib/api"

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

// ─── Types ────────────────────────────────────────────────────────────────────

interface PipelineNode { id: string; type: string; label: string }

interface Run {
  id: string
  workflow_id: string
  workflow_name: string
  status: "running" | "completed" | "failed"
  task: string
  pipeline: PipelineNode[]
  trigger_source: "app" | "telegram" | "webhook"
  created_at: string
  completed_at: string | null
}

interface RunEvent {
  type: string
  node_id?: string
  agent_name?: string
  message?: string
  ts?: string
  extra?: Record<string, unknown>
}

interface StepState {
  nodeId: string
  label: string
  nodeType: string
  status: "pending" | "running" | "done" | "error"
  output?: string
  error?: string
  toolCalls: Array<{ tool: string; inputs: Record<string, unknown> | null; result?: string }>
  startTs?: string
  doneTs?: string
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function duration(start: string, end?: string | null) {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function buildSteps(pipeline: PipelineNode[], events: RunEvent[]): StepState[] {
  const steps: Record<string, StepState> = {}
  for (const p of pipeline) {
    steps[p.id] = { nodeId: p.id, label: p.label, nodeType: p.type, status: "pending", toolCalls: [] }
  }
  for (const evt of events) {
    const nid = evt.node_id
    if (!nid || !steps[nid]) continue
    const step = steps[nid]
    if (evt.type === "node_start") { step.status = "running"; step.startTs = evt.ts }
    else if (evt.type === "node_done") { step.status = "done"; step.doneTs = evt.ts }
    else if (evt.type === "text") { step.output = evt.message }
    else if (evt.type === "error") { step.status = "error"; step.error = evt.message }
    else if (evt.type === "tool_call") {
      step.toolCalls.push({ tool: (evt.extra?.tool as string) || "", inputs: (evt.extra?.inputs as Record<string, unknown>) ?? null })
    } else if (evt.type === "tool_result") {
      const last = step.toolCalls[step.toolCalls.length - 1]
      if (last && !last.result) last.result = (evt.extra?.result as string) || ""
    }
  }
  return pipeline.map(p => steps[p.id]).filter(Boolean)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: Run["trigger_source"] }) {
  if (source === "telegram") return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600,
      color: "#0088CC", background: "#E8F4FB", border: "1px solid #BAD9F0", borderRadius: 99, padding: "1px 6px" }}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="#0088CC">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
      </svg>
      Telegram
    </span>
  )
  if (source === "webhook") return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600,
      color: "#854F0B", background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 99, padding: "1px 6px" }}>
      ⚡ Webhook
    </span>
  )
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600,
      color: "#534AB7", background: "#F0EEFF", border: "1px solid #C4B5FD", borderRadius: 99, padding: "1px 6px" }}>
      App
    </span>
  )
}

function StatusBadge({ status }: { status: Run["status"] | "pending" | "running" | "done" | "error" }) {
  const map: Record<string, { bg: string; dot: string; label: string }> = {
    running:   { bg: "#EFF6FF", dot: "#3B82F6", label: "Running" },
    completed: { bg: "#ECFDF5", dot: "#10B981", label: "Completed" },
    done:      { bg: "#ECFDF5", dot: "#10B981", label: "Done" },
    failed:    { bg: "#FEF2F2", dot: "#EF4444", label: "Failed" },
    error:     { bg: "#FEF2F2", dot: "#EF4444", label: "Error" },
    pending:   { bg: "#F3F4F6", dot: "#9CA3AF", label: "Pending" },
  }
  const s = map[status] ?? map.pending
  return (
    <span style={{ background: s.bg, color: s.dot, border: `1px solid ${s.dot}20` }}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold">
      <span style={{ background: s.dot, width: 6, height: 6, borderRadius: "50%", display: "inline-block",
        animation: status === "running" ? "pulse 1.5s ease-in-out infinite" : "none" }} />
      {s.label}
    </span>
  )
}

function NodeTypeIcon({ type }: { type: string }) {
  if (type === "agentNode") return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="3" width="12" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5" cy="7" r="1.2" fill="currentColor" />
      <circle cx="9" cy="7" r="1.2" fill="currentColor" />
    </svg>
  )
  if (type === "sendTelegramNode") return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 7L12 2L9 12L6.5 9L2 7Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
  if (type === "webhookResponseNode") return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 4V7L9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function StepRow({ step, index, isLast }: { step: StepState; index: number; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = step.output || step.error || step.toolCalls.length > 0

  const statusColor: Record<string, string> = {
    pending: "#D1D5DB", running: "#3B82F6", done: "#10B981", error: "#EF4444",
  }
  const color = statusColor[step.status] ?? "#D1D5DB"

  return (
    <div className="flex gap-3">
      {/* Timeline spine */}
      <div className="flex flex-col items-center" style={{ width: 24, flexShrink: 0 }}>
        <div style={{ width: 24, height: 24, borderRadius: "50%", background: `${color}22`,
          border: `2px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center",
          color, flexShrink: 0 }}>
          {step.status === "running"
            ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: color,
                animation: "pulse 1s ease-in-out infinite" }} />
            : step.status === "done"
            ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5L4 7L8 3" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            : step.status === "error"
            ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M3 3L7 7M7 3L3 7" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            : <span style={{ fontSize: 9, fontWeight: 700, color }}>{index + 1}</span>
          }
        </div>
        {!isLast && (
          <div style={{ width: 2, flex: 1, minHeight: 16, background: step.status !== "pending" ? `${color}44` : "#E5E7EB", marginTop: 2 }} />
        )}
      </div>

      {/* Step content */}
      <div style={{ paddingBottom: isLast ? 0 : 16, flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => hasDetails && setExpanded(e => !e)}
          style={{ userSelect: "none" }}>
          <div style={{ color: "#6B7280" }}>
            <NodeTypeIcon type={step.nodeType} />
          </div>
          <span className="font-medium text-sm text-[#1A1A2E] truncate">{step.label}</span>
          <StatusBadge status={step.status} />
          {step.startTs && step.status !== "pending" && (
            <span className="text-xs text-[#9CA3AF] ml-auto shrink-0">
              {step.doneTs ? duration(step.startTs, step.doneTs) : duration(step.startTs)}
            </span>
          )}
          {hasDetails && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
              style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s", marginLeft: step.startTs ? 4 : "auto", color: "#9CA3AF", flexShrink: 0 }}>
              <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </div>

        {expanded && hasDetails && (
          <div style={{ marginTop: 8, marginLeft: 0 }}>
            {/* Tool calls */}
            {step.toolCalls.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                {step.toolCalls.map((tc, i) => (
                  <div key={i} style={{ background: "#F8F9FF", border: "1px solid #E0E0F0", borderRadius: 8, padding: "8px 12px", marginBottom: 6 }}>
                    <div className="flex items-center gap-2 mb-1">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <rect x="1" y="5" width="10" height="6" rx="1.5" stroke="#534AB7" strokeWidth="1.2" />
                        <path d="M4 5V3.5C4 2.4 4.9 1.5 6 1.5s2 .9 2 2V5" stroke="#534AB7" strokeWidth="1.2" />
                      </svg>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#534AB7", fontFamily: "monospace" }}>{tc.tool}()</span>
                    </div>
                    {tc.inputs && (
                      <pre style={{ fontSize: 10, color: "#6B7280", margin: 0, overflow: "auto", maxHeight: 80 }}>
                        {JSON.stringify(tc.inputs, null, 2)}
                      </pre>
                    )}
                    {tc.result && (
                      <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid #E0E0F0" }}>
                        <span style={{ fontSize: 10, color: "#6B7280", fontWeight: 500 }}>→ </span>
                        <span style={{ fontSize: 10, color: "#374151", fontFamily: "monospace" }}>{tc.result.slice(0, 300)}{tc.result.length > 300 ? "…" : ""}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* Agent output */}
            {step.output && (
              <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "8px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#15803D", marginBottom: 4 }}>OUTPUT</div>
                <p style={{ fontSize: 12, color: "#1A1A2E", margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                  {step.output}
                </p>
              </div>
            )}
            {/* Error */}
            {step.error && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "8px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#DC2626", marginBottom: 4 }}>ERROR</div>
                <p style={{ fontSize: 12, color: "#7F1D1D", margin: 0, fontFamily: "monospace" }}>{step.error}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MonitoringPage() {
  const [runs, setRuns] = useState<Run[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [liveEvents, setLiveEvents] = useState<RunEvent[]>([])
  const [liveStatus, setLiveStatus] = useState<Run["status"] | null>(null)
  const [globalMessage, setGlobalMessage] = useState("")
  const [loading, setLoading] = useState(true)
  const esRef = useRef<EventSource | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/runs`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      })
      if (res.ok) {
        const data: Run[] = await res.json()
        setRuns(data)
        // Auto-select the most recent running run if nothing is selected yet
        setSelectedId(prev => {
          if (prev) return prev
          const running = data.find(r => r.status === "running")
          return running ? running.id : prev
        })
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Adaptive polling: fast (1.5s) when any run is running, slower (4s) otherwise
  useEffect(() => {
    fetchRuns()
    const tick = () => {
      fetchRuns()
      const hasRunning = runs.some(r => r.status === "running")
      pollRef.current = setTimeout(tick, hasRunning ? 1500 : 4000)
    }
    pollRef.current = setTimeout(tick, 1500)
    return () => { if (pollRef.current) clearTimeout(pollRef.current) }
  }, [fetchRuns]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedRun = runs.find(r => r.id === selectedId)

  // When selected run changes, connect SSE
  useEffect(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    setLiveEvents([])
    setLiveStatus(null)
    setGlobalMessage("")
    if (!selectedId) return

    const run = runs.find(r => r.id === selectedId)
    if (!run) return

    // Always connect to SSE stream (it handles both live and completed)
    const es = new EventSource(`${API}/api/runs/${selectedId}/stream?token=${encodeURIComponent(getToken() ?? "")}`)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const evt: RunEvent = JSON.parse(e.data)
        if (evt.type === "heartbeat") return
        if (evt.type === "done") {
          setLiveStatus(prev => prev === "running" ? "completed" : (prev || "completed"))
          fetchRuns()
          return
        }
        if (evt.type === "status") { setGlobalMessage(evt.message || ""); return }
        if (evt.type === "__end__") return
        setLiveEvents(prev => [...prev, evt])
      } catch {}
    }
    es.onerror = () => es.close()

    setLiveStatus(run.status)
    return () => { es.close() }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedRunFinal = selectedRun
  const steps = selectedRunFinal ? buildSteps(selectedRunFinal.pipeline, liveEvents) : []

  const runningCount = runs.filter(r => r.status === "running").length
  const completedCount = runs.filter(r => r.status === "completed").length
  const failedCount = runs.filter(r => r.status === "failed").length

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.9); }
        }
      `}</style>

      <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>

        {/* ── Left sidebar: run list ─────────────────────────────── */}
        <div style={{ width: 288, flexShrink: 0, borderRight: "1px solid #E8E8EC",
          background: "white", display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Sidebar header */}
          <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid #E8E8EC" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-sm text-[#1A1A2E]">Workflow Runs</h2>
              <button onClick={fetchRuns}
                style={{ background: "#F3F4F6", border: "none", borderRadius: 6, padding: "4px 8px",
                  fontSize: 11, color: "#6B7280", cursor: "pointer", fontWeight: 600 }}>
                Refresh
              </button>
            </div>
            {/* Stats row */}
            <div className="flex gap-2">
              {[
                { label: "Running", count: runningCount, color: "#3B82F6" },
                { label: "Done", count: completedCount, color: "#10B981" },
                { label: "Failed", count: failedCount, color: "#EF4444" },
              ].map(s => (
                <div key={s.label} style={{ flex: 1, background: `${s.color}11`, borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.count}</div>
                  <div style={{ fontSize: 10, color: "#6B7280", fontWeight: 500 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Run list */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading && (
              <div style={{ padding: 24, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Loading runs…</div>
            )}
            {!loading && runs.length === 0 && (
              <div style={{ padding: 24, textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                <div style={{ fontSize: 13, color: "#6B7280" }}>No runs yet.</div>
                <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>Run a workflow to see it here.</div>
              </div>
            )}
            {runs.map(run => (
              <button
                key={run.id}
                onClick={() => setSelectedId(run.id)}
                style={{
                  width: "100%", textAlign: "left", padding: "12px 16px",
                  borderBottom: "1px solid #F3F4F6", cursor: "pointer",
                  background: selectedId === run.id ? "#F5F3FF" : "white",
                  borderLeft: selectedId === run.id ? "3px solid #534AB7" : "3px solid transparent",
                  transition: "background 0.12s",
                }}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1A2E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {run.workflow_name || "Unnamed"}</span>
                  <StatusBadge status={run.status} />
                </div>
                <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }} className="truncate">
                  {run.task || "—"}
                </div>
                <div className="flex items-center justify-between">
                  <div style={{ fontSize: 10, color: "#9CA3AF" }}>{timeAgo(run.created_at)}</div>
                  <SourceBadge source={run.trigger_source || "app"} />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Right panel: run detail ────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#F7F7F9" }}>
          {!selectedRunFinal ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 48 }}>🔍</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#1A1A2E" }}>Select a run to inspect</div>
              <div style={{ fontSize: 13, color: "#9CA3AF" }}>Click any run in the list to see its live execution.</div>
            </div>
          ) : (
            <div style={{ flex: 1, overflow: "auto" }}>
              {/* Run header */}
              <div style={{ background: "white", borderBottom: "1px solid #E8E8EC", padding: "20px 28px" }}>
                <div className="flex items-start justify-between gap-4">
                  <div style={{ minWidth: 0 }}>
                    <div className="flex items-center gap-3 mb-2">
                      <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1A1A2E", margin: 0 }}>
                        {selectedRunFinal.workflow_name || "Unnamed Workflow"}
                      </h1>
                      <StatusBadge status={liveStatus || selectedRunFinal.status} />
                      <SourceBadge source={selectedRunFinal.trigger_source || "app"} />
                      {(liveStatus || selectedRunFinal.status) === "running" && (
                        <span style={{ fontSize: 11, color: "#3B82F6", fontWeight: 600, background: "#EFF6FF",
                          padding: "2px 8px", borderRadius: 99 }}>● LIVE</span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
                      <span style={{ fontWeight: 500, color: "#6B7280" }}>Task: </span>{selectedRunFinal.task}
                    </div>
                    <div className="flex items-center gap-4" style={{ fontSize: 11, color: "#9CA3AF" }}>
                      <span>Started {timeAgo(selectedRunFinal.created_at)}</span>
                      {selectedRunFinal.completed_at && (
                        <span>Duration: {duration(selectedRunFinal.created_at, selectedRunFinal.completed_at)}</span>
                      )}
                      {!selectedRunFinal.completed_at && (
                        <span>Running for {duration(selectedRunFinal.created_at)}</span>
                      )}
                      <span style={{ fontFamily: "monospace", fontSize: 10 }}>{selectedRunFinal.id.slice(0, 8)}…</span>
                    </div>
                    {globalMessage && (
                      <div style={{ marginTop: 8, fontSize: 12, color: "#6B7280", fontStyle: "italic" }}>{globalMessage}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Pipeline steps */}
              <div style={{ padding: "24px 28px" }}>
                {steps.length === 0 ? (
                  <div style={{ background: "white", borderRadius: 12, padding: 32, textAlign: "center",
                    border: "1px solid #E8E8EC" }}>
                    <div style={{ fontSize: 13, color: "#9CA3AF" }}>No pipeline steps recorded yet.</div>
                  </div>
                ) : (
                  <div style={{ background: "white", borderRadius: 12, padding: "24px 24px 16px",
                    border: "1px solid #E8E8EC" }}>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: "#1A1A2E", margin: "0 0 20px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Pipeline · {steps.length} step{steps.length !== 1 ? "s" : ""}
                    </h3>
                    {steps.map((step, i) => (
                      <StepRow key={step.nodeId} step={step} index={i} isLast={i === steps.length - 1} />
                    ))}
                  </div>
                )}

                {/* Raw event log */}
                {liveEvents.length > 0 && (
                  <div style={{ marginTop: 16, background: "white", borderRadius: 12, border: "1px solid #E8E8EC", overflow: "hidden" }}>
                    <details>
                      <summary style={{ padding: "14px 20px", cursor: "pointer", fontSize: 12,
                        fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.05em",
                        userSelect: "none", listStyle: "none", display: "flex", alignItems: "center", gap: 6 }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                        Raw Event Log · {liveEvents.length} events
                      </summary>
                      <div style={{ borderTop: "1px solid #F3F4F6", maxHeight: 320, overflowY: "auto", padding: "12px 20px" }}>
                        {liveEvents.map((evt, i) => {
                          const colorMap: Record<string, string> = {
                            node_start: "#3B82F6", node_done: "#10B981", text: "#10B981",
                            error: "#EF4444", tool_call: "#8B5CF6", tool_result: "#F59E0B",
                            status: "#6B7280", done: "#10B981",
                          }
                          const c = colorMap[evt.type] ?? "#9CA3AF"
                          return (
                            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 6, fontSize: 11, alignItems: "flex-start" }}>
                              <span style={{ fontFamily: "monospace", color: "#9CA3AF", flexShrink: 0, marginTop: 1 }}>
                                {evt.ts ? new Date(evt.ts).toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}
                              </span>
                              <span style={{ background: `${c}18`, color: c, padding: "1px 6px", borderRadius: 4,
                                fontFamily: "monospace", fontWeight: 600, flexShrink: 0, fontSize: 10 }}>
                                {evt.type}
                              </span>
                              {evt.agent_name && <span style={{ color: "#534AB7", fontWeight: 500, flexShrink: 0 }}>[{evt.agent_name}]</span>}
                              {evt.message && <span style={{ color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(evt.message)}</span>}
                              {!!evt.extra?.tool && <span style={{ color: "#8B5CF6", fontFamily: "monospace" }}>{String(evt.extra.tool)}()</span>}
                            </div>
                          )
                        })}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
