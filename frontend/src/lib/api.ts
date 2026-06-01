const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

export interface AgentConfig {
  name: string
  enhanced_description: string
  system_prompt: string
  model: string
  tools: string[]
  reasoning: string
}

export interface Agent extends AgentConfig {
  id: string
  description: string
  created_at: string
}

export interface WorkflowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  deletable?: boolean
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  type?: string
  markerEnd?: unknown
}

export interface Workflow {
  id: string
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  created_at: string
  updated_at?: string
}

export interface Credential {
  key: string
  label: string
  group: string
  secret: boolean
  required: boolean
  is_set: boolean
  masked_value: string
  user_defined?: boolean
}

export interface WorkflowEvent {
  type: string
  message: string
  node_id?: string
  agent_name?: string
  tool?: string
  inputs?: object
  result?: string
}

export const api = {
  // ── Agents ────────────────────────────────────────────────────────────────

  async generateConfig(description: string): Promise<AgentConfig> {
    const res = await fetch(`${BASE}/api/agents/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async createAgent(config: AgentConfig & { description: string }): Promise<Agent> {
    const res = await fetch(`${BASE}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async listAgents(): Promise<Agent[]> {
    const res = await fetch(`${BASE}/api/agents`)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async getAgent(id: string): Promise<Agent> {
    const res = await fetch(`${BASE}/api/agents/${id}`)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async patchAgent(id: string, updates: { tools?: string[]; system_prompt?: string; model?: string }): Promise<Agent> {
    const res = await fetch(`${BASE}/api/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async deleteAgent(id: string): Promise<void> {
    await fetch(`${BASE}/api/agents/${id}`, { method: "DELETE" })
  },

  async *streamTaskFetch(agentId: string, task: string): AsyncGenerator<{ type: string; message: string; tool?: string; inputs?: object; result?: string }> {
    const res = await fetch(`${BASE}/api/agents/${agentId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task }),
    })
    if (!res.ok) throw new Error(await res.text())
    yield* _parseSseStream(res)
  },

  // ── Workflows ─────────────────────────────────────────────────────────────

  async createWorkflow(data: { name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] }): Promise<Workflow> {
    const res = await fetch(`${BASE}/api/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async listWorkflows(): Promise<Workflow[]> {
    const res = await fetch(`${BASE}/api/workflows`)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async getWorkflow(id: string): Promise<Workflow> {
    const res = await fetch(`${BASE}/api/workflows/${id}`)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async saveWorkflow(id: string, data: { name?: string; nodes?: WorkflowNode[]; edges?: WorkflowEdge[] }): Promise<Workflow> {
    const res = await fetch(`${BASE}/api/workflows/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async deleteWorkflow(id: string): Promise<void> {
    await fetch(`${BASE}/api/workflows/${id}`, { method: "DELETE" })
  },

  // ── Credentials ───────────────────────────────────────────────────────────

  async getCredentials(): Promise<Credential[]> {
    const res = await fetch(`${BASE}/api/credentials`)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async updateCredentials(updates: { key: string; value: string }[]): Promise<void> {
    const res = await fetch(`${BASE}/api/credentials`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    })
    if (!res.ok) throw new Error(await res.text())
  },

  async createCustomCredential(data: { label: string; key?: string; value: string; group?: string; secret?: boolean }): Promise<Credential> {
    const res = await fetch(`${BASE}/api/credentials/custom`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async deleteCustomCredential(key: string): Promise<void> {
    const res = await fetch(`${BASE}/api/credentials/custom/${encodeURIComponent(key)}`, { method: "DELETE" })
    if (!res.ok) throw new Error(await res.text())
  },

  async *streamWorkflow(id: string, task: string): AsyncGenerator<WorkflowEvent> {
    const res = await fetch(`${BASE}/api/workflows/${id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task }),
    })
    if (!res.ok) throw new Error(await res.text())
    yield* _parseSseStream(res)
  },
}

async function* _parseSseStream(res: Response): AsyncGenerator<any> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try { yield JSON.parse(line.slice(6)) } catch {}
      }
    }
  }
}
