"use client"
import "@xyflow/react/dist/style.css"
import {
  ReactFlow, Background, Controls, MiniMap, Panel,
  addEdge, useNodesState, useEdgesState,
  Handle, Position, MarkerType, BackgroundVariant,
  ReactFlowProvider, useReactFlow,
  type NodeProps, type Connection, type Edge, type Node,
} from "@xyflow/react"
import { useCallback, useContext, useEffect, useRef, useState, createContext, type DragEvent } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { api, type Agent, type WorkflowNode, type WorkflowEdge, type Credential } from "@/lib/api"

const WorkflowContext = createContext<{ workflowId: string }>({ workflowId: "new" })

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toolCategory(tools: string[]) {
  if (tools.some(t => t.startsWith("yuno_"))) return { accent: "#0F6E56", bg: "#ECFDF5" }
  if (tools.includes("web_search")) return { accent: "#3B82F6", bg: "#EFF6FF" }
  if (tools.includes("database_query")) return { accent: "#8B5CF6", bg: "#F5F3FF" }
  return { accent: "#534AB7", bg: "#EEF0FB" }
}

function agentInitial(name: string) {
  return (name ?? "A").slice(0, 1).toUpperCase()
}

function statusConfig(status?: string) {
  if (status === "running") return { dot: "bg-[#3B82F6] animate-pulse", ring: "ring-2 ring-[#3B82F6]/40", label: "Running" }
  if (status === "done")    return { dot: "bg-[#10B981]",              ring: "ring-2 ring-[#10B981]/30", label: "Done" }
  if (status === "error")   return { dot: "bg-[#EF4444]",              ring: "ring-2 ring-[#EF4444]/30", label: "Error" }
  return { dot: "bg-[#D1D5DB]", ring: "", label: "Idle" }
}

// ─── Custom nodes ─────────────────────────────────────────────────────────────

function TriggerNode({ selected }: NodeProps) {
  return (
    <div
      className={`w-[200px] bg-white rounded-2xl border overflow-hidden transition-all
        ${selected ? "border-[#534AB7] shadow-[0_0_0_3px_rgba(83,74,183,0.15)]" : "border-[#E8E8EC]"}
        shadow-[0_2px_8px_rgba(0,0,0,0.08)]`}
    >
      {/* Icon header */}
      <div className="flex flex-col items-center pt-5 pb-3 px-4">
        <div className="w-12 h-12 rounded-2xl bg-[#534AB7] flex items-center justify-center mb-3 shadow-sm">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M11 4l7 4v6l-7 4-7-4V8l7-4z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
            <circle cx="11" cy="11" r="2.5" fill="white"/>
          </svg>
        </div>
        <p className="text-[#1A1A2E] text-xs font-bold text-center">Manual Trigger</p>
        <p className="text-[#9CA3AF] text-[10px] text-center mt-0.5">Starts the workflow</p>
      </div>

      {/* Status row */}
      <div className="border-t border-[#F3F3F5] px-4 py-2.5 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[#534AB7]" />
        <span className="text-[10px] text-[#6B7280] font-medium">Ready</span>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 10, height: 10, background: "#534AB7", border: "2px solid white", boxShadow: "0 0 0 1px #534AB7" }}
      />
    </div>
  )
}

function AgentNode({ data, selected }: NodeProps) {
  const tools = (data.tools as string[]) ?? []
  const { accent, bg } = toolCategory(tools)
  const status = data.status as string | undefined
  const sc = statusConfig(status)

  return (
    <div
      className={`w-[240px] bg-white rounded-2xl border overflow-hidden transition-all
        ${selected ? "border-[#534AB7] shadow-[0_0_0_3px_rgba(83,74,183,0.15)]" : "border-[#E8E8EC]"}
        ${sc.ring}
        shadow-[0_2px_8px_rgba(0,0,0,0.08)]`}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold"
          style={{ background: bg, color: accent }}
        >
          {agentInitial(data.agentName as string)}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-[#1A1A2E] leading-tight truncate">
            {data.agentName as string}
          </p>
          <p className="text-[10px] text-[#9CA3AF] mt-0.5 truncate leading-tight">
            {data.model as string}
          </p>
        </div>
      </div>

      {/* Description */}
      {!!(data.agentDescription as string) && (
        <div className="px-4 pb-2.5">
          <p className="text-[11px] text-[#9CA3AF] line-clamp-2 leading-relaxed">
            {data.agentDescription as string}
          </p>
        </div>
      )}

      {/* Tools */}
      {tools.length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-1">
          {tools.slice(0, 3).map(t => (
            <span
              key={t}
              className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ color: accent, background: bg }}
            >
              {t.replace(/yuno_/g, "").replace(/_/g, " ")}
            </span>
          ))}
          {tools.length > 3 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full text-[#9CA3AF] bg-[#F7F7F9]">
              +{tools.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Status row */}
      <div className="border-t border-[#F3F3F5] px-4 py-2.5 flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
        <span className="text-[10px] text-[#6B7280] font-medium flex-1">{sc.label}</span>
        {status === "running" && (
          <div className="w-3 h-3 border border-[#3B82F6]/30 border-t-[#3B82F6] rounded-full animate-spin" />
        )}
        {status === "done" && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6l2.5 2.5 4.5-4.5" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 10, height: 10, background: "#E8E8EC", border: "2px solid white", boxShadow: "0 0 0 1px #C4C4CC" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 10, height: 10, background: "#E8E8EC", border: "2px solid white", boxShadow: "0 0 0 1px #C4C4CC" }}
      />
    </div>
  )
}

// ─── Telegram icon (shared) ──────────────────────────────────────────────────

function TelegramIcon({ size = 18, color = "white" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M21.8 4.2L18.4 19.6c-.3 1.2-1 1.5-2 .9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.2 9.8-8.9c.4-.4-.1-.6-.7-.2L5.8 14.4l-4.8-1.5c-1-.3-1-.9.3-1.4L20.3 2.8c.9-.3 1.6.2 1.5 1.4z"
        fill={color}
      />
    </svg>
  )
}

// ─── TelegramTriggerNode ──────────────────────────────────────────────────────

function TelegramTriggerNode({ data, selected }: NodeProps) {
  const token = (data.botToken as string) || ""
  const masked = token ? `${token.slice(0, 6)}…${token.slice(-4)}` : "Not configured"
  return (
    <div
      className={`w-[210px] bg-white rounded-2xl border overflow-hidden transition-all
        ${selected ? "border-[#2AABEE] shadow-[0_0_0_3px_rgba(42,171,238,0.15)]" : "border-[#E8E8EC]"}
        shadow-[0_2px_8px_rgba(0,0,0,0.08)]`}
    >
      <div className="flex flex-col items-center pt-5 pb-3 px-4">
        <div className="w-12 h-12 rounded-2xl bg-[#2AABEE] flex items-center justify-center mb-3 shadow-sm">
          <TelegramIcon size={22} />
        </div>
        <p className="text-[#1A1A2E] text-xs font-bold text-center">Telegram Trigger</p>
        <p className="text-[#9CA3AF] text-[10px] text-center mt-0.5">Message received</p>
      </div>

      <div className="border-t border-[#F3F3F5] px-4 py-2.5 flex items-center gap-2">
        {token ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
            <span className="text-[10px] text-[#6B7280] font-medium font-mono truncate">{masked}</span>
          </>
        ) : (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
            <span className="text-[10px] text-[#F59E0B] font-medium">Token required</span>
          </>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 10, height: 10, background: "#2AABEE", border: "2px solid white", boxShadow: "0 0 0 1px #2AABEE" }}
      />
    </div>
  )
}

// ─── SendTelegramNode ─────────────────────────────────────────────────────────

function SendTelegramNode({ data, selected }: NodeProps) {
  const chatId = (data.chatId as string) || ""
  return (
    <div
      className={`w-[210px] bg-white rounded-2xl border overflow-hidden transition-all
        ${selected ? "border-[#2AABEE] shadow-[0_0_0_3px_rgba(42,171,238,0.15)]" : "border-[#E8E8EC]"}
        shadow-[0_2px_8px_rgba(0,0,0,0.08)]`}
    >
      <div className="flex flex-col items-center pt-5 pb-3 px-4">
        <div className="w-12 h-12 rounded-2xl bg-[#2AABEE] flex items-center justify-center mb-3 shadow-sm">
          <TelegramIcon size={22} />
        </div>
        <p className="text-[#1A1A2E] text-xs font-bold text-center">Send to Telegram</p>
        <p className="text-[#9CA3AF] text-[10px] text-center mt-0.5">
          {chatId ? `Chat ${chatId}` : "No chat ID set"}
        </p>
      </div>

      <div className="border-t border-[#F3F3F5] px-4 py-2.5 flex items-center gap-2">
        {chatId ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
            <span className="text-[10px] text-[#6B7280] font-medium">Ready to send</span>
          </>
        ) : (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
            <span className="text-[10px] text-[#F59E0B] font-medium">Chat ID required</span>
          </>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 10, height: 10, background: "#E8E8EC", border: "2px solid white", boxShadow: "0 0 0 1px #C4C4CC" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 10, height: 10, background: "#E8E8EC", border: "2px solid white", boxShadow: "0 0 0 1px #C4C4CC" }}
      />
    </div>
  )
}

// ─── WebhookTriggerNode ───────────────────────────────────────────────────────

function WebhookTriggerNode({ selected }: NodeProps) {
  const { workflowId } = useContext(WorkflowContext)
  const webhookUrl = workflowId === "new"
    ? null
    : `http://localhost:8000/api/webhooks/${workflowId}`
  const [copied, setCopied] = useState(false)

  const copy = () => {
    if (!webhookUrl) return
    navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      className={`w-[220px] bg-white rounded-2xl border overflow-hidden transition-all
        ${selected ? "border-[#10B981] shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" : "border-[#E8E8EC]"}
        shadow-[0_2px_8px_rgba(0,0,0,0.08)]`}
    >
      <div className="flex flex-col items-center pt-5 pb-3 px-4">
        <div className="w-12 h-12 rounded-2xl bg-[#10B981] flex items-center justify-center mb-3 shadow-sm">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M4 11h14M4 6h8M4 16h8" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
            <circle cx="17" cy="6" r="2.5" fill="white"/>
            <circle cx="17" cy="16" r="2.5" fill="white"/>
          </svg>
        </div>
        <p className="text-[#1A1A2E] text-xs font-bold text-center">Webhook Trigger</p>
        <p className="text-[#9CA3AF] text-[10px] text-center mt-0.5">POST to start workflow</p>
      </div>

      <div className="border-t border-[#F3F3F5] px-3 py-2.5 flex items-center gap-2">
        {webhookUrl ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] flex-shrink-0" />
            <span className="text-[9px] text-[#6B7280] font-mono truncate flex-1">/webhooks/{workflowId.slice(0, 8)}…</span>
            <button
              onClick={copy}
              className="text-[#9CA3AF] hover:text-[#10B981] transition-colors flex-shrink-0"
              title="Copy URL"
            >
              {copied
                ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                : <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/><path d="M2 8V2h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              }
            </button>
          </>
        ) : (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] flex-shrink-0" />
            <span className="text-[10px] text-[#F59E0B] font-medium">Save workflow to get URL</span>
          </>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 10, height: 10, background: "#10B981", border: "2px solid white", boxShadow: "0 0 0 1px #10B981" }}
      />
    </div>
  )
}

// ─── WebhookResponseNode ──────────────────────────────────────────────────────

function WebhookResponseNode({ data, selected }: NodeProps) {
  const callbackUrl = (data.callbackUrl as string) || ""
  return (
    <div
      className={`w-[220px] bg-white rounded-2xl border overflow-hidden transition-all
        ${selected ? "border-[#6366F1] shadow-[0_0_0_3px_rgba(99,102,241,0.15)]" : "border-[#E8E8EC]"}
        shadow-[0_2px_8px_rgba(0,0,0,0.08)]`}
    >
      <div className="flex flex-col items-center pt-5 pb-3 px-4">
        <div className="w-12 h-12 rounded-2xl bg-[#6366F1] flex items-center justify-center mb-3 shadow-sm">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M4 11h14M11 4l7 7-7 7" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <p className="text-[#1A1A2E] text-xs font-bold text-center">Webhook Response</p>
        <p className="text-[#9CA3AF] text-[10px] text-center mt-0.5">POST result as JSON</p>
      </div>

      <div className="border-t border-[#F3F3F5] px-3 py-2.5 flex items-center gap-2">
        {callbackUrl ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] flex-shrink-0" />
            <span className="text-[9px] text-[#6B7280] font-mono truncate">{callbackUrl.replace(/^https?:\/\//, "")}</span>
          </>
        ) : (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] flex-shrink-0" />
            <span className="text-[10px] text-[#F59E0B] font-medium">Callback URL required</span>
          </>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 10, height: 10, background: "#E8E8EC", border: "2px solid white", boxShadow: "0 0 0 1px #C4C4CC" }}
      />
    </div>
  )
}

const NODE_TYPES = {
  triggerNode: TriggerNode,
  agentNode: AgentNode,
  telegramTriggerNode: TelegramTriggerNode,
  sendTelegramNode: SendTelegramNode,
  webhookTriggerNode: WebhookTriggerNode,
  webhookResponseNode: WebhookResponseNode,
}

// ─── Output types ─────────────────────────────────────────────────────────────

interface OutputEntry {
  id: string
  type: string
  message: string
  node_id?: string
  agent_name?: string
}

interface LogEntry {
  id: string
  type: string
  message: string
  node_id?: string
  agent_name?: string
  tool?: string
  inputs?: object
  result?: string
}

// ─── Credential picker ────────────────────────────────────────────────────────

function CredentialPicker({
  label, boundKey, credentials, accentColor,
  onSelect, onClear,
}: {
  label: string
  boundKey?: string
  credentials: Credential[]
  accentColor?: string
  onSelect: (key: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const accent = accentColor ?? "#534AB7"

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as unknown as globalThis.Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const bound = boundKey ? credentials.find(c => c.key === boundKey) : null
  const available = credentials.filter(c => c.is_set)

  if (bound) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, background: `${accent}12`,
        border: `1px solid ${accent}30`, borderRadius: 8, padding: "6px 10px", marginTop: 6 }}>
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <rect x="1" y="5" width="9" height="5" rx="1.2" stroke={accent} strokeWidth="1.2"/>
          <path d="M3.5 5V3.5C3.5 2.4 4.3 1.5 5.5 1.5s2 .9 2 2V5" stroke={accent} strokeWidth="1.2"/>
        </svg>
        <span style={{ fontSize: 10, color: accent, fontWeight: 600, flex: 1 }}>{bound.label}</span>
        <span style={{ fontSize: 9, color: "#9CA3AF", fontFamily: "monospace" }}>{bound.key}</span>
        <button onClick={onClear} style={{ color: "#9CA3AF", marginLeft: 4, lineHeight: 1 }}
          title="Remove credential binding">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div ref={ref} style={{ position: "relative", marginTop: 6 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "#F7F7F9",
          border: "1px solid #E8E8EC", borderRadius: 8, padding: "5px 10px", cursor: "pointer",
          fontSize: 10, color: "#6B7280", fontWeight: 600, width: "100%" }}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <rect x="1" y="5" width="9" height="5" rx="1.2" stroke="#9CA3AF" strokeWidth="1.2"/>
          <path d="M3.5 5V3.5C3.5 2.4 4.3 1.5 5.5 1.5s2 .9 2 2V5" stroke="#9CA3AF" strokeWidth="1.2"/>
        </svg>
        {label}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: "auto" }}>
          <path d="M2 4l3 3 3-3" stroke="#9CA3AF" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
          background: "white", border: "1px solid #E8E8EC", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)", overflow: "hidden" }}>
          {available.length === 0 ? (
            <div style={{ padding: "12px 14px", fontSize: 11, color: "#9CA3AF", textAlign: "center" }}>
              No credentials saved yet.<br/>
              <Link href="/settings" style={{ color: accent, fontWeight: 600 }}>Add one in Settings →</Link>
            </div>
          ) : (
            available.map(cred => (
              <button
                key={cred.key}
                onClick={() => { onSelect(cred.key); setOpen(false) }}
                style={{ width: "100%", textAlign: "left", padding: "9px 14px", cursor: "pointer",
                  fontSize: 11, borderBottom: "1px solid #F3F4F6", background: "white",
                  display: "flex", alignItems: "center", gap: 8 }}
                onMouseOver={e => (e.currentTarget.style.background = "#F7F7F9")}
                onMouseOut={e => (e.currentTarget.style.background = "white")}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", flexShrink: 0 }} />
                <span style={{ fontWeight: 600, color: "#1A1A2E" }}>{cred.label}</span>
                <span style={{ color: "#9CA3AF", fontFamily: "monospace", fontSize: 9, marginLeft: "auto" }}>
                  {cred.key}
                </span>
                <span style={{ fontSize: 9, color: "#C4C4CC", background: "#F3F4F6",
                  padding: "1px 5px", borderRadius: 4 }}>
                  {cred.group}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Workflow builder ─────────────────────────────────────────────────────────

function WorkflowBuilder({ workflowId }: { workflowId: string }) {
  const { screenToFlowPosition } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [workflowName, setWorkflowName] = useState("Untitled Workflow")
  const [currentId, setCurrentId] = useState(workflowId)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(workflowId !== "new")
  const [running, setRunning] = useState(false)
  const [showRunModal, setShowRunModal] = useState(false)
  const [taskInput, setTaskInput] = useState("")
  const [outputs, setOutputs] = useState<OutputEntry[]>([])
  const [showOutput, setShowOutput] = useState(false)
  const [finalAnswer, setFinalAnswer] = useState("")
  const [agentSearch, setAgentSearch] = useState("")
  const outputCounter = useRef(0)

  useEffect(() => {
    api.listAgents().then(setAgents)
    api.getCredentials().then(setCredentials)
    if (workflowId === "new") {
      setNodes([{
        id: "trigger-1",
        type: "triggerNode",
        position: { x: 80, y: 160 },
        data: { label: "Start" },
      }])
    } else {
      api.getWorkflow(workflowId).then(wf => {
        setWorkflowName(wf.name)
        setNodes(wf.nodes as Node[])
        setEdges(wf.edges as Edge[])
      }).catch(() => {})
    }
  }, [workflowId])

  const onConnect = useCallback((params: Connection) => {
    setEdges(eds => addEdge({
      ...params,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#C4C4CC" },
      style: { stroke: "#C4C4CC", strokeWidth: 1.5 },
    }, eds))
    setSaved(false)
  }, [setEdges])

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }, [])

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })

    const agentRaw = e.dataTransfer.getData("application/agentnode")
    if (agentRaw) {
      const agent = JSON.parse(agentRaw) as Agent
      setNodes(nds => [...nds, {
        id: `agent-${Date.now()}`,
        type: "agentNode",
        position,
        data: {
          agentId: agent.id,
          agentName: agent.name,
          agentDescription: agent.description,
          tools: agent.tools,
          model: agent.model,
          status: "idle",
        },
      }])
      setSaved(false)
      return
    }

    if (e.dataTransfer.getData("application/triggernode")) {
      setNodes(nds => [...nds, {
        id: `trigger-${Date.now()}`,
        type: "triggerNode",
        position,
        data: { label: "Start" },
      }])
      setSaved(false)
      return
    }

    if (e.dataTransfer.getData("application/telegramtriggernode")) {
      setNodes(nds => [...nds, {
        id: `telegram-trigger-${Date.now()}`,
        type: "telegramTriggerNode",
        position,
        data: { botToken: "", label: "Telegram Trigger" },
      }])
      setSaved(false)
      return
    }

    if (e.dataTransfer.getData("application/sendtelegramnode")) {
      setNodes(nds => [...nds, {
        id: `send-telegram-${Date.now()}`,
        type: "sendTelegramNode",
        position,
        data: { chatId: "1277961041", messageTemplate: "", label: "Send to Telegram" },
      }])
      setSaved(false)
      return
    }

    if (e.dataTransfer.getData("application/webhooktriggernode")) {
      setNodes(nds => [...nds, {
        id: `webhook-trigger-${Date.now()}`,
        type: "webhookTriggerNode",
        position,
        data: { label: "Webhook Trigger" },
      }])
      setSaved(false)
      return
    }

    if (e.dataTransfer.getData("application/webhookresponsenode")) {
      setNodes(nds => [...nds, {
        id: `webhook-response-${Date.now()}`,
        type: "webhookResponseNode",
        position,
        data: { callbackUrl: "", label: "Webhook Response" },
      }])
      setSaved(false)
      return
    }
  }, [screenToFlowPosition, setNodes])

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = { name: workflowName, nodes: nodes as WorkflowNode[], edges: edges as WorkflowEdge[] }
      if (currentId === "new") {
        const wf = await api.createWorkflow(payload)
        setCurrentId(wf.id)
        window.history.replaceState({}, "", `/workflow/${wf.id}`)
      } else {
        await api.saveWorkflow(currentId, payload)
      }
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const handleRunSubmit = async () => {
    if (!taskInput.trim()) return
    setShowRunModal(false)
    setRunning(true)
    setOutputs([])
    setFinalAnswer("")
    setShowOutput(true)
    outputCounter.current = 0
    setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, status: "idle" } })))

    let wfId = currentId
    if (currentId === "new" || !saved) {
      setSaving(true)
      const payload = { name: workflowName, nodes: nodes as WorkflowNode[], edges: edges as WorkflowEdge[] }
      const wf = currentId === "new"
        ? await api.createWorkflow(payload)
        : await api.saveWorkflow(currentId, payload)
      wfId = wf.id
      setCurrentId(wf.id)
      window.history.replaceState({}, "", `/workflow/${wf.id}`)
      setSaving(false)
      setSaved(true)
    }

    try {
      for await (const event of api.streamWorkflow(wfId, taskInput)) {
        if (event.node_id) {
          if (event.type === "node_start") {
            setNodes(nds => nds.map(n =>
              n.id === event.node_id ? { ...n, data: { ...n.data, status: "running" } } : n
            ))
          } else if (event.type === "node_done") {
            setNodes(nds => nds.map(n =>
              n.id === event.node_id ? { ...n, data: { ...n.data, status: "done" } } : n
            ))
          } else if (event.type === "error") {
            setNodes(nds => nds.map(n =>
              n.id === event.node_id ? { ...n, data: { ...n.data, status: "error" } } : n
            ))
          }
        }
        // Collect only meaningful output events
        if (event.type === "text" || event.type === "error" || event.type === "node_done") {
          setOutputs(prev => [...prev, { id: String(outputCounter.current++), ...event }])
        }
        if (event.type === "done") {
          setFinalAnswer(event.message ?? "")
          break
        }
      }
    } catch (e: any) {
      setOutputs(prev => [...prev, { id: String(outputCounter.current++), type: "error", message: e.message ?? "Run failed" }])
    } finally {
      setRunning(false)
    }
  }

  const filteredAgents = agents.filter(a =>
    a.name.toLowerCase().includes(agentSearch.toLowerCase())
  )

  const agentById = Object.fromEntries(agents.map(a => [a.id, a]))
  const inspectedAgent = selectedNode?.type === "agentNode"
    ? agentById[selectedNode.data.agentId as string]
    : null

  const removeNode = (nodeId: string) => {
    setNodes(nds => nds.filter(n => n.id !== nodeId))
    setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId))
    setSelectedNode(null)
    setSaved(false)
  }

  const updateNodeData = (nodeId: string, patch: Record<string, unknown>) => {
    setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n))
    setSelectedNode(prev => prev?.id === nodeId ? { ...prev, data: { ...prev.data, ...patch } } : prev)
    setSaved(false)
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <WorkflowContext.Provider value={{ workflowId: currentId }}>
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Toolbar (matches image header style) ── */}
      <div className="h-[52px] bg-white border-b border-[#E8E8EC] flex items-center px-4 gap-3 flex-shrink-0">
        {/* Back */}
        <Link
          href="/workflow"
          className="flex items-center gap-1 text-xs text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </Link>
        <div className="w-px h-4 bg-[#E8E8EC]" />

        {/* Editable name */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-[#C4C4CC] font-medium">Route name:</span>
          <input
            value={workflowName}
            onChange={e => { setWorkflowName(e.target.value); setSaved(false) }}
            className="text-sm font-semibold text-[#1A1A2E] bg-transparent border-none outline-none w-48 hover:bg-[#F7F7F9] px-2 py-1 rounded-lg transition-colors"
            placeholder="Workflow name…"
          />
          <button className="text-[#C4C4CC] hover:text-[#9CA3AF] transition-colors">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M9.5 1.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <div className="flex-1" />

        {/* Status chip */}
        <span className={`text-[11px] font-medium flex items-center gap-1.5 ${saved ? "text-[#10B981]" : "text-[#F59E0B]"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${saved ? "bg-[#10B981]" : "bg-[#F59E0B]"}`} />
          {saving ? "Saving…" : saved ? "Saved" : "Unsaved"}
        </span>

        {/* Icon actions */}
        <button
          onClick={handleSave}
          disabled={saving}
          title="Save"
          className="p-2 rounded-lg text-[#9CA3AF] hover:text-[#6B7280] hover:bg-[#F7F7F9] disabled:opacity-40 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M13 5.5L10.5 3H3a1 1 0 00-1 1v8a1 1 0 001 1h10a1 1 0 001-1V5.5z" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M5.5 13V10h5v3M5 3v3.5h5V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Continue later (ghost) */}
        <button
          onClick={handleSave}
          className="px-3 py-1.5 text-xs font-medium text-[#6B7280] border border-[#E8E8EC] rounded-lg hover:bg-[#F7F7F9] transition-colors"
        >
          Continue later
        </button>

        {/* Run / Publish */}
        <button
          onClick={() => setShowRunModal(true)}
          disabled={running}
          className="px-4 py-1.5 text-xs font-bold bg-[#534AB7] text-white rounded-lg hover:bg-[#4840A0] disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          {running ? (
            <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Running…</>
          ) : (
            <>
              <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
                <path d="M1 1.5l8 4.5-8 4.5V1.5z" fill="white"/>
              </svg>
              Publish
            </>
          )}
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left Palette (light) ── */}
        <div className="w-[250px] bg-white border-r border-[#E8E8EC] flex flex-col flex-shrink-0 overflow-hidden">
          <div className="px-4 pt-4 pb-3 border-b border-[#F3F3F5]">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#C4C4CC] mb-3">Node Library</p>
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#C4C4CC]" width="13" height="13" viewBox="0 0 13 13" fill="none">
                <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M8.5 8.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              <input
                value={agentSearch}
                onChange={e => setAgentSearch(e.target.value)}
                placeholder="Search agents…"
                className="w-full bg-[#F7F7F9] border border-[#E8E8EC] text-[#6B7280] text-xs pl-8 pr-3 py-2 rounded-lg outline-none focus:border-[#534AB7]/40 transition-colors placeholder-[#C4C4CC]"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4 scrollbar-thin">

            {/* Triggers */}
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#C4C4CC] mb-2 px-1">Triggers</p>
              <div className="space-y-1.5">
                <div
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData("application/triggernode", "manual")
                    e.dataTransfer.effectAllowed = "move"
                  }}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#EEF0FB] border border-[#534AB7]/20 cursor-grab active:cursor-grabbing hover:border-[#534AB7]/40 transition-colors"
                >
                  <div className="w-7 h-7 rounded-lg bg-[#534AB7] flex items-center justify-center flex-shrink-0">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M6 2l5 3v4l-5 3-5-3V5l5-3z" stroke="white" strokeWidth="1.2" fill="none"/>
                      <circle cx="6" cy="6" r="1.5" fill="white"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-[#1A1A2E] text-xs font-semibold">Manual Trigger</p>
                    <p className="text-[#9CA3AF] text-[10px]">Start with a task</p>
                  </div>
                </div>

                <div
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData("application/telegramtriggernode", "telegram")
                    e.dataTransfer.effectAllowed = "move"
                  }}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#EBF7FE] border border-[#2AABEE]/20 cursor-grab active:cursor-grabbing hover:border-[#2AABEE]/40 transition-colors"
                >
                  <div className="w-7 h-7 rounded-lg bg-[#2AABEE] flex items-center justify-center flex-shrink-0">
                    <TelegramIcon size={13} />
                  </div>
                  <div>
                    <p className="text-[#1A1A2E] text-xs font-semibold">Telegram Trigger</p>
                    <p className="text-[#9CA3AF] text-[10px]">On message received</p>
                  </div>
                </div>

                <div
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData("application/webhooktriggernode", "webhook")
                    e.dataTransfer.effectAllowed = "move"
                  }}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#ECFDF5] border border-[#10B981]/20 cursor-grab active:cursor-grabbing hover:border-[#10B981]/40 transition-colors"
                >
                  <div className="w-7 h-7 rounded-lg bg-[#10B981] flex items-center justify-center flex-shrink-0">
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                      <path d="M2 6.5h9M2 3.5h5M2 9.5h5" stroke="white" strokeWidth="1.3" strokeLinecap="round"/>
                      <circle cx="10" cy="3.5" r="1.5" fill="white"/>
                      <circle cx="10" cy="9.5" r="1.5" fill="white"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-[#1A1A2E] text-xs font-semibold">Webhook Trigger</p>
                    <p className="text-[#9CA3AF] text-[10px]">On HTTP POST received</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#C4C4CC] mb-2 px-1">Actions</p>
              <div className="space-y-1.5">
              <div
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData("application/sendtelegramnode", "telegram")
                  e.dataTransfer.effectAllowed = "move"
                }}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#EBF7FE] border border-[#2AABEE]/20 cursor-grab active:cursor-grabbing hover:border-[#2AABEE]/40 transition-colors"
              >
                <div className="w-7 h-7 rounded-lg bg-[#2AABEE] flex items-center justify-center flex-shrink-0">
                  <TelegramIcon size={13} />
                </div>
                <div>
                  <p className="text-[#1A1A2E] text-xs font-semibold">Send to Telegram</p>
                  <p className="text-[#9CA3AF] text-[10px]">Send message to chat</p>
                </div>
              </div>

              <div
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData("application/webhookresponsenode", "webhook")
                  e.dataTransfer.effectAllowed = "move"
                }}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#EEF0FB] border border-[#6366F1]/20 cursor-grab active:cursor-grabbing hover:border-[#6366F1]/40 transition-colors"
              >
                <div className="w-7 h-7 rounded-lg bg-[#6366F1] flex items-center justify-center flex-shrink-0">
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M2 6.5h9M7 2.5l4 4-4 4" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div>
                  <p className="text-[#1A1A2E] text-xs font-semibold">Webhook Response</p>
                  <p className="text-[#9CA3AF] text-[10px]">POST result as JSON</p>
                </div>
              </div>
              </div>
            </div>

            {/* Agents */}
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#C4C4CC] mb-2 px-1">
                Agents ({filteredAgents.length})
              </p>
              {filteredAgents.length === 0 ? (
                <p className="text-[#C4C4CC] text-xs px-1">
                  {agents.length === 0 ? "No agents yet — create one first" : "No match"}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {filteredAgents.map(agent => {
                    const { accent, bg } = toolCategory(agent.tools)
                    return (
                      <div
                        key={agent.id}
                        draggable
                        onDragStart={e => {
                          e.dataTransfer.setData("application/agentnode", JSON.stringify(agent))
                          e.dataTransfer.effectAllowed = "move"
                        }}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#F7F7F9] border border-[#E8E8EC] cursor-grab active:cursor-grabbing hover:border-[#C4C4CC] hover:bg-white hover:shadow-card transition-all"
                      >
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold"
                          style={{ background: bg, color: accent }}
                        >
                          {agentInitial(agent.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[#1A1A2E] text-xs font-semibold truncate">{agent.name}</p>
                          <p className="text-[#C4C4CC] text-[10px]">
                            {agent.tools.length} tool{agent.tools.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="px-4 py-3 border-t border-[#F3F3F5]">
            <p className="text-[10px] text-[#C4C4CC]">Drag nodes onto the canvas</p>
          </div>
        </div>

        {/* ── Canvas + Inspector ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* React Flow Canvas (light) */}
          <div className="flex-1 relative">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={e => { onNodesChange(e); setSaved(false) }}
              onEdgesChange={e => { onEdgesChange(e); setSaved(false) }}
              onConnect={onConnect}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onNodeClick={(_, node) => setSelectedNode(node)}
              onPaneClick={() => setSelectedNode(null)}
              nodeTypes={NODE_TYPES}
              fitView
              fitViewOptions={{ padding: 0.3 }}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{
                type: "smoothstep",
                markerEnd: { type: MarkerType.ArrowClosed, color: "#C4C4CC" },
                style: { stroke: "#C4C4CC", strokeWidth: 1.5 },
              }}
            >
              <Background
                variant={BackgroundVariant.Cross}
                gap={24}
                size={1}
                color="#E8E8EC"
                style={{ backgroundColor: "#F7F7F9" }}
              />
              <Controls
                style={{
                  background: "white",
                  border: "1px solid #E8E8EC",
                  borderRadius: 10,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
                }}
                showInteractive={false}
              />
              <MiniMap
                style={{
                  background: "white",
                  border: "1px solid #E8E8EC",
                  borderRadius: 10,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
                }}
                nodeColor={n => {
                  if (n.type === "triggerNode") return "#534AB7"
                  if (n.type === "telegramTriggerNode" || n.type === "sendTelegramNode") return "#2AABEE"
                  const { accent } = toolCategory((n.data.tools as string[]) ?? [])
                  return accent
                }}
                maskColor="rgba(247,247,249,0.7)"
              />

              {nodes.filter(n => n.type === "agentNode").length === 0 && (
                <Panel position="top-center">
                  <div className="bg-white border border-[#E8E8EC] text-[#9CA3AF] text-xs px-4 py-2 rounded-full mt-5 shadow-card">
                    Drag agents from the left panel to build your workflow
                  </div>
                </Panel>
              )}
            </ReactFlow>
          </div>

          {/* ── Right Inspector (light) ── */}
          {selectedNode && (
            <div className="w-[280px] bg-white border-l border-[#E8E8EC] flex flex-col flex-shrink-0 overflow-hidden">
              <div className="px-4 py-3.5 border-b border-[#F3F3F5] flex items-center justify-between">
                <span className="text-xs font-bold text-[#1A1A2E]">Properties</span>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="w-6 h-6 flex items-center justify-center text-[#C4C4CC] hover:text-[#9CA3AF] hover:bg-[#F7F7F9] rounded transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin">

                {selectedNode.type === "triggerNode" && (
                  <div>
                    <div className="w-12 h-12 rounded-2xl bg-[#534AB7] flex items-center justify-center mb-3">
                      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                        <path d="M11 4l7 4v6l-7 4-7-4V8l7-4z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
                        <circle cx="11" cy="11" r="2.5" fill="white"/>
                      </svg>
                    </div>
                    <p className="text-sm font-bold text-[#1A1A2E] mb-1">Manual Trigger</p>
                    <p className="text-xs text-[#9CA3AF] leading-relaxed">
                      Workflow entry point. When you click Publish/Run, it receives your task and passes it to connected agents.
                    </p>
                  </div>
                )}

                {selectedNode.type === "telegramTriggerNode" && (
                  <div className="space-y-4">
                    <div>
                      <div className="w-12 h-12 rounded-2xl bg-[#2AABEE] flex items-center justify-center mb-3">
                        <TelegramIcon size={22} />
                      </div>
                      <p className="text-sm font-bold text-[#1A1A2E] mb-1">Telegram Trigger</p>
                      <p className="text-xs text-[#9CA3AF] leading-relaxed">
                        Starts the workflow when a message is received by your Telegram bot.
                      </p>
                    </div>

                    <div>
                      <label className="block text-[9px] uppercase tracking-widest font-bold text-[#C4C4CC] mb-1.5">
                        Bot Token
                      </label>
                      <input
                        type="password"
                        value={(selectedNode.data.botToken as string) || ""}
                        onChange={e => updateNodeData(selectedNode.id, { botToken: e.target.value })}
                        disabled={!!(selectedNode.data.botTokenCredential as string)}
                        placeholder={selectedNode.data.botTokenCredential ? "← Using credential" : "123456:ABC-DEF..."}
                        className="w-full px-2.5 py-2 text-xs border border-[#E8E8EC] rounded-lg bg-[#F7F7F9] focus:outline-none focus:border-[#2AABEE]/50 focus:ring-2 focus:ring-[#2AABEE]/10 font-mono placeholder-[#C4C4CC] transition-colors disabled:opacity-50"
                      />
                      <CredentialPicker
                        label="Use saved credential"
                        boundKey={(selectedNode.data.botTokenCredential as string) || undefined}
                        credentials={credentials}
                        accentColor="#2AABEE"
                        onSelect={key => updateNodeData(selectedNode.id, { botTokenCredential: key })}
                        onClear={() => updateNodeData(selectedNode.id, { botTokenCredential: "" })}
                      />
                      <p className="mt-1.5 text-[10px] text-[#C4C4CC] leading-relaxed">
                        Get this from <span className="font-semibold text-[#9CA3AF]">@BotFather</span> on Telegram → /newbot
                      </p>
                    </div>

                    <div className="bg-[#EBF7FE] border border-[#2AABEE]/20 rounded-xl px-3 py-2.5 text-[10px] text-[#1A7BAB] leading-relaxed">
                      <p className="font-semibold mb-0.5">Setup steps</p>
                      <ol className="list-decimal list-inside space-y-0.5 opacity-80">
                        <li>Message @BotFather → /newbot</li>
                        <li>Copy the token above</li>
                        <li>Set webhook to your API URL</li>
                      </ol>
                    </div>
                  </div>
                )}

                {selectedNode.type === "sendTelegramNode" && (
                  <div className="space-y-4">
                    <div>
                      <div className="w-12 h-12 rounded-2xl bg-[#2AABEE] flex items-center justify-center mb-3">
                        <TelegramIcon size={22} />
                      </div>
                      <p className="text-sm font-bold text-[#1A1A2E] mb-1">Send to Telegram</p>
                      <p className="text-xs text-[#9CA3AF] leading-relaxed">
                        Sends the agent's output as a message to a Telegram chat.
                      </p>
                    </div>

                    <div>
                      <label className="block text-[9px] uppercase tracking-widest font-bold text-[#C4C4CC] mb-1.5">
                        Chat ID
                      </label>
                      <input
                        type="text"
                        value={(selectedNode.data.chatId as string) || ""}
                        onChange={e => updateNodeData(selectedNode.id, { chatId: e.target.value })}
                        disabled={!!(selectedNode.data.chatIdCredential as string)}
                        placeholder={selectedNode.data.chatIdCredential ? "← Using credential" : "-1001234567890"}
                        className="w-full px-2.5 py-2 text-xs border border-[#E8E8EC] rounded-lg bg-[#F7F7F9] focus:outline-none focus:border-[#2AABEE]/50 focus:ring-2 focus:ring-[#2AABEE]/10 font-mono placeholder-[#C4C4CC] transition-colors disabled:opacity-50"
                      />
                      <CredentialPicker
                        label="Use saved credential"
                        boundKey={(selectedNode.data.chatIdCredential as string) || undefined}
                        credentials={credentials}
                        accentColor="#2AABEE"
                        onSelect={key => updateNodeData(selectedNode.id, { chatIdCredential: key })}
                        onClear={() => updateNodeData(selectedNode.id, { chatIdCredential: "" })}
                      />
                      <p className="mt-1.5 text-[10px] text-[#C4C4CC] leading-relaxed">
                        Group/channel IDs start with <span className="font-mono">-100</span>. Get yours from <span className="font-semibold text-[#9CA3AF]">@userinfobot</span>
                      </p>
                    </div>

                    <div>
                      <label className="block text-[9px] uppercase tracking-widest font-bold text-[#C4C4CC] mb-1.5">
                        Message Template <span className="normal-case">(optional)</span>
                      </label>
                      <textarea
                        value={(selectedNode.data.messageTemplate as string) || ""}
                        onChange={e => updateNodeData(selectedNode.id, { messageTemplate: e.target.value })}
                        placeholder="Leave blank to forward agent output directly"
                        rows={3}
                        className="w-full px-2.5 py-2 text-xs border border-[#E8E8EC] rounded-lg bg-[#F7F7F9] focus:outline-none focus:border-[#2AABEE]/50 focus:ring-2 focus:ring-[#2AABEE]/10 placeholder-[#C4C4CC] resize-none transition-colors"
                      />
                    </div>
                  </div>
                )}

                {selectedNode.type === "webhookTriggerNode" && (
                  <div className="space-y-4">
                    <div>
                      <div className="w-12 h-12 rounded-2xl bg-[#10B981] flex items-center justify-center mb-3">
                        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                          <path d="M4 11h14M4 6h8M4 16h8" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
                          <circle cx="17" cy="6" r="2.5" fill="white"/>
                          <circle cx="17" cy="16" r="2.5" fill="white"/>
                        </svg>
                      </div>
                      <p className="text-sm font-bold text-[#1A1A2E] mb-1">Webhook Trigger</p>
                      <p className="text-xs text-[#9CA3AF] leading-relaxed">
                        Starts the workflow when an HTTP POST is received. Save the workflow to get the inbound URL.
                      </p>
                    </div>
                    {(() => {
                      const url = currentId !== "new"
                        ? `http://localhost:8000/api/webhooks/${currentId}`
                        : null
                      return url ? (
                        <div className="bg-[#F0FDF4] border border-[#10B981]/20 rounded-xl p-3 space-y-2">
                          <p className="text-[9px] uppercase tracking-widest font-bold text-[#10B981]">Inbound URL</p>
                          <p className="text-[10px] font-mono text-[#1A1A2E] break-all">{url}</p>
                          <p className="text-[9px] text-[#6B7280]">POST JSON with <span className="font-mono">task</span> and optional <span className="font-mono">callback_url</span></p>
                          <button
                            onClick={() => navigator.clipboard.writeText(url)}
                            className="text-[10px] text-[#10B981] font-semibold hover:underline"
                          >
                            Copy URL
                          </button>
                        </div>
                      ) : (
                        <div className="bg-[#FFFBEB] border border-[#F59E0B]/20 rounded-xl px-3 py-2.5 text-[10px] text-[#92400E]">
                          Save the workflow first to generate the webhook URL.
                        </div>
                      )
                    })()}
                    <div className="bg-[#F7F7F9] border border-[#E8E8EC] rounded-xl px-3 py-2.5 text-[10px] text-[#6B7280] space-y-1">
                      <p className="font-semibold text-[#1A1A2E]">Example request</p>
                      <pre className="font-mono text-[9px] whitespace-pre-wrap">{`POST /api/webhooks/{id}
Content-Type: application/json

{
  "task": "Check approval rates",
  "callback_url": "https://your.app/cb"
}`}</pre>
                    </div>
                  </div>
                )}

                {selectedNode.type === "webhookResponseNode" && (
                  <div className="space-y-4">
                    <div>
                      <div className="w-12 h-12 rounded-2xl bg-[#6366F1] flex items-center justify-center mb-3">
                        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                          <path d="M4 11h14M11 4l7 7-7 7" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <p className="text-sm font-bold text-[#1A1A2E] mb-1">Webhook Response</p>
                      <p className="text-xs text-[#9CA3AF] leading-relaxed">
                        POSTs the workflow result as JSON to the configured callback URL when this node is reached.
                      </p>
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase tracking-widest font-bold text-[#C4C4CC] mb-1.5">
                        Callback URL
                      </label>
                      <input
                        type="url"
                        value={(selectedNode.data.callbackUrl as string) || ""}
                        onChange={e => updateNodeData(selectedNode.id, { callbackUrl: e.target.value })}
                        disabled={!!(selectedNode.data.callbackUrlCredential as string)}
                        placeholder={selectedNode.data.callbackUrlCredential ? "← Using credential" : "https://your.app/webhook/result"}
                        className="w-full px-2.5 py-2 text-xs border border-[#E8E8EC] rounded-lg bg-[#F7F7F9] focus:outline-none focus:border-[#6366F1]/50 focus:ring-2 focus:ring-[#6366F1]/10 font-mono placeholder-[#C4C4CC] transition-colors disabled:opacity-50"
                      />
                      <CredentialPicker
                        label="Use saved credential"
                        boundKey={(selectedNode.data.callbackUrlCredential as string) || undefined}
                        credentials={credentials}
                        accentColor="#6366F1"
                        onSelect={key => updateNodeData(selectedNode.id, { callbackUrlCredential: key })}
                        onClear={() => updateNodeData(selectedNode.id, { callbackUrlCredential: "" })}
                      />
                      <p className="mt-1.5 text-[10px] text-[#C4C4CC] leading-relaxed">
                        The backend will POST <span className="font-mono text-[#9CA3AF]">{"{ result, workflow_id, status }"}</span> to this URL.
                      </p>
                    </div>
                    <div className="bg-[#EEF0FB] border border-[#6366F1]/20 rounded-xl px-3 py-2.5 text-[10px] text-[#4338CA] leading-relaxed">
                      <p className="font-semibold mb-0.5">Response payload</p>
                      <pre className="font-mono text-[9px] whitespace-pre-wrap">{`{
  "result": "Agent output text",
  "workflow_id": "uuid",
  "status": "completed"
}`}</pre>
                    </div>
                  </div>
                )}

                {selectedNode.type === "agentNode" && (
                  <div className="space-y-4">
                    {/* Agent header */}
                    <div>
                      <div
                        className="w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold mb-3"
                        style={(() => {
                          const { accent, bg } = toolCategory((selectedNode.data.tools as string[]) ?? [])
                          return { background: bg, color: accent }
                        })()}
                      >
                        {agentInitial(selectedNode.data.agentName as string)}
                      </div>
                      <p className="text-sm font-bold text-[#1A1A2E]">{selectedNode.data.agentName as string}</p>
                      <p className="text-xs text-[#9CA3AF] mt-1 leading-relaxed">{selectedNode.data.agentDescription as string}</p>
                    </div>

                    {/* Model */}
                    <div>
                      <p className="text-[9px] uppercase tracking-widest font-bold text-[#C4C4CC] mb-1.5">Model</p>
                      <span className="text-[11px] bg-[#F7F7F9] border border-[#E8E8EC] text-[#6B7280] px-2.5 py-1 rounded-lg font-mono">
                        {selectedNode.data.model as string}
                      </span>
                    </div>

                    {/* Tools */}
                    <div>
                      <p className="text-[9px] uppercase tracking-widest font-bold text-[#C4C4CC] mb-1.5">Tools</p>
                      <div className="flex flex-wrap gap-1.5">
                        {((selectedNode.data.tools as string[]) ?? []).map((t: string) => (
                          <span key={t} className="text-[10px] bg-[#F7F7F9] border border-[#E8E8EC] text-[#6B7280] px-2 py-0.5 rounded-full">
                            {t.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    </div>

                    {inspectedAgent && (
                      <Link
                        href={`/agents/${inspectedAgent.id}`}
                        className="flex items-center gap-1 text-xs text-[#534AB7] hover:text-[#4840A0] font-medium transition-colors"
                      >
                        Open agent page
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 9.5l7-7M5 2.5h4.5V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </Link>
                    )}
                  </div>
                )}
              </div>

              {["triggerNode", "agentNode", "telegramTriggerNode", "sendTelegramNode", "webhookTriggerNode", "webhookResponseNode"].includes(selectedNode.type ?? "") && (
                <div className="px-4 py-3 border-t border-[#F3F3F5]">
                  <button
                    onClick={() => removeNode(selectedNode.id)}
                    className="w-full text-xs text-[#EF4444] hover:text-[#DC2626] border border-[#FCA5A5]/40 hover:border-[#FCA5A5] py-2 rounded-xl transition-colors bg-[#FEF2F2]"
                  >
                    Remove from workflow
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Log Panel (light) ── */}
      {showOutput && (
        <div className="h-[260px] bg-white border-t border-[#E8E8EC] flex flex-col flex-shrink-0">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-[#F3F3F5] flex-shrink-0">
            <div className="flex items-center gap-2">
              {running ? (
                <span className="w-2 h-2 rounded-full bg-[#534AB7] animate-pulse" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-[#10B981]" />
              )}
              <span className="text-xs font-bold text-[#6B7280]">
                {running ? "Running…" : "Result"}
              </span>
            </div>
            <div className="flex-1" />
            <button
              onClick={() => setShowOutput(false)}
              className="w-5 h-5 flex items-center justify-center text-[#C4C4CC] hover:text-[#9CA3AF] transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 scrollbar-thin">
            {/* Per-agent outputs */}
            {outputs.filter(o => o.type === "text").map(entry => (
              <div key={entry.id}>
                {entry.agent_name && (
                  <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide mb-1">{entry.agent_name}</p>
                )}
                <p className="text-sm text-[#1A1A2E] leading-relaxed whitespace-pre-wrap">{entry.message}</p>
              </div>
            ))}
            {/* Error entries */}
            {outputs.filter(o => o.type === "error").map(entry => (
              <p key={entry.id} className="text-xs text-[#EF4444]">{entry.message}</p>
            ))}
            {/* Final answer if no per-agent text yet */}
            {!running && finalAnswer && outputs.filter(o => o.type === "text").length === 0 && (
              <p className="text-sm text-[#1A1A2E] leading-relaxed whitespace-pre-wrap">{finalAnswer}</p>
            )}
            {running && outputs.filter(o => o.type === "text").length === 0 && (
              <div className="flex items-center gap-2 text-sm text-[#9CA3AF]">
                <span className="w-4 h-4 border-2 border-[#534AB7]/20 border-t-[#534AB7] rounded-full animate-spin" />
                Working on it…
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Run Modal (light) ── */}
      {showRunModal && (
        <div
          className="fixed inset-0 bg-[#1A1A2E]/20 backdrop-blur-[2px] flex items-center justify-center z-50"
          onClick={() => setShowRunModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-card-md border border-[#E8E8EC] w-[480px] p-6"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-[#1A1A2E] mb-1">Run Workflow</h2>
            <p className="text-sm text-[#9CA3AF] mb-5">
              Enter the task for the trigger node. It will propagate through all connected agents.
            </p>
            <textarea
              value={taskInput}
              onChange={e => setTaskInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRunSubmit() }}
              placeholder="e.g. Check approval rates for all connectors and report any below 85%"
              className="w-full h-28 px-3 py-2.5 border border-[#E8E8EC] rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#534AB7]/20 focus:border-[#534AB7] transition-colors placeholder-[#C4C4CC]"
              autoFocus
            />
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs text-[#C4C4CC]">⌘↵ to run</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowRunModal(false)}
                  className="px-4 py-2 text-sm text-[#6B7280] border border-[#E8E8EC] rounded-xl hover:bg-[#F7F7F9] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRunSubmit}
                  disabled={!taskInput.trim()}
                  className="px-5 py-2 text-sm font-bold bg-[#534AB7] text-white rounded-xl hover:bg-[#4840A0] disabled:opacity-40 transition-colors flex items-center gap-1.5"
                >
                  <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
                    <path d="M1 1.5l8 4.5-8 4.5V1.5z" fill="white"/>
                  </svg>
                  Run
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </WorkflowContext.Provider>
  )
}

// ─── Page wrapper ─────────────────────────────────────────────────────────────

export default function WorkflowPage() {
  const { id } = useParams<{ id: string }>()
  return (
    <div className="h-full overflow-hidden">
      <ReactFlowProvider>
        <WorkflowBuilder workflowId={id} />
      </ReactFlowProvider>
    </div>
  )
}
