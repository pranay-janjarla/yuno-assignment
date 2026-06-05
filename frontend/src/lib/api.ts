export const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

// ─── Session token (passwordless login) ──────────────────────────────────────
const TOKEN_KEY = "yuno_session"

export function getToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token: string): void {
  if (typeof window !== "undefined") localStorage.setItem(TOKEN_KEY, token)
}
export function clearToken(): void {
  if (typeof window !== "undefined") localStorage.removeItem(TOKEN_KEY)
}

/** fetch wrapper that attaches the bearer token and signals the gate on 401. */
async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init.headers || {})
  if (token) headers.set("Authorization", `Bearer ${token}`)
  const res = await fetch(input, { ...init, headers })
  if (res.status === 401 && typeof window !== "undefined") {
    clearToken()
    window.dispatchEvent(new Event("yuno-unauthorized"))
  }
  return res
}

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
    const res = await authFetch(`${BASE}/api/agents/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async createAgent(config: AgentConfig & { description: string }): Promise<Agent> {
    const res = await authFetch(`${BASE}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async listAgents(): Promise<Agent[]> {
    const res = await authFetch(`${BASE}/api/agents`)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async getAgent(id: string): Promise<Agent> {
    const res = await authFetch(`${BASE}/api/agents/${id}`)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async patchAgent(id: string, updates: { tools?: string[]; system_prompt?: string; model?: string }): Promise<Agent> {
    const res = await authFetch(`${BASE}/api/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async deleteAgent(id: string): Promise<void> {
    await authFetch(`${BASE}/api/agents/${id}`, { method: "DELETE" })
  },

  async *streamTaskFetch(agentId: string, task: string): AsyncGenerator<{ type: string; message: string; tool?: string; inputs?: object; result?: string }> {
    const res = await authFetch(`${BASE}/api/agents/${agentId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task }),
    })
    if (!res.ok) throw new Error(await res.text())
    yield* _parseSseStream(res)
  },

  // ── Workflows ─────────────────────────────────────────────────────────────

  async createWorkflow(data: { name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] }): Promise<Workflow> {
    const res = await authFetch(`${BASE}/api/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async listWorkflows(): Promise<Workflow[]> {
    const res = await authFetch(`${BASE}/api/workflows`)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async getWorkflow(id: string): Promise<Workflow> {
    const res = await authFetch(`${BASE}/api/workflows/${id}`)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async saveWorkflow(id: string, data: { name?: string; nodes?: WorkflowNode[]; edges?: WorkflowEdge[] }): Promise<Workflow> {
    const res = await authFetch(`${BASE}/api/workflows/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async deleteWorkflow(id: string): Promise<void> {
    await authFetch(`${BASE}/api/workflows/${id}`, { method: "DELETE" })
  },

  // ── Credentials ───────────────────────────────────────────────────────────

  async getCredentials(): Promise<Credential[]> {
    const res = await authFetch(`${BASE}/api/credentials`)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async updateCredentials(updates: { key: string; value: string }[]): Promise<void> {
    const res = await authFetch(`${BASE}/api/credentials`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    })
    if (!res.ok) throw new Error(await res.text())
  },

  async createCustomCredential(data: { label: string; key?: string; value: string; group?: string; secret?: boolean }): Promise<Credential> {
    const res = await authFetch(`${BASE}/api/credentials/custom`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async deleteCustomCredential(key: string): Promise<void> {
    const res = await authFetch(`${BASE}/api/credentials/custom/${encodeURIComponent(key)}`, { method: "DELETE" })
    if (!res.ok) throw new Error(await res.text())
  },

  async *streamWorkflow(id: string, task: string): AsyncGenerator<WorkflowEvent> {
    const res = await authFetch(`${BASE}/api/workflows/${id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task }),
    })
    if (!res.ok) throw new Error(await res.text())
    yield* _parseSseStream(res)
  },
}

// ─── Auth API (passwordless: biometric passkey + authenticator TOTP) ──────────
export interface AuthStatus {
  configured: boolean
  totp_enabled: boolean
  has_passkey: boolean
}

async function _post(path: string, body?: unknown): Promise<any> {
  const res = await authFetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`)
  return res.json()
}

export const auth = {
  async status(): Promise<AuthStatus> {
    const res = await fetch(`${BASE}/auth/status`)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async me(): Promise<boolean> {
    const token = getToken()
    if (!token) return false
    const res = await authFetch(`${BASE}/auth/me`)
    return res.ok
  },

  // Setup (first-run bootstrap)
  setupTotpBegin: (): Promise<{ secret: string; otpauth_uri: string; qr: string }> =>
    _post("/auth/setup/totp/begin"),
  setupTotpVerify: (code: string): Promise<{ token: string }> =>
    _post("/auth/setup/totp/verify", { code }),
  setupPasskeyBegin: (): Promise<{ state: string; options: string }> =>
    _post("/auth/setup/passkey/begin"),
  setupPasskeyComplete: (state: string, credential: unknown): Promise<{ token: string }> =>
    _post("/auth/setup/passkey/complete", { state, credential }),

  // Login
  loginPasskeyBegin: (): Promise<{ state: string; options: string }> =>
    _post("/auth/login/passkey/begin"),
  loginPasskeyComplete: (state: string, credential: unknown): Promise<{ token: string }> =>
    _post("/auth/login/passkey/complete", { state, credential }),
  loginTotp: (code: string): Promise<{ token: string }> =>
    _post("/auth/login/totp", { code }),

  // Manage (logged-in)
  logout: () => _post("/auth/logout").catch(() => {}),
  listPasskeys: async (): Promise<{ id: string; nickname: string; created_at: string }[]> => {
    const res = await authFetch(`${BASE}/auth/passkeys`)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },
  addPasskeyBegin: (): Promise<{ state: string; options: string }> =>
    _post("/auth/passkey/begin"),
  addPasskeyComplete: (state: string, credential: unknown): Promise<{ ok: boolean }> =>
    _post("/auth/passkey/complete", { state, credential }),
  deletePasskey: async (id: string): Promise<void> => {
    const res = await authFetch(`${BASE}/auth/passkeys/${id}`, { method: "DELETE" })
    if (!res.ok) throw new Error(await res.text())
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
