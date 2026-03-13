'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { 
  Send, Upload, Trash2, Settings, FileText, MessageSquare, 
  Plus, Loader2, Sparkles, Database, ChevronLeft, ChevronRight,
  Check, Brain, Cpu, Network, Zap, Eye, RotateCcw
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'

// Types
interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  confidence?: number
  agentName?: string
}

interface Document {
  id: string
  filename: string
  fileType: string
  fileSize: number
  chunkCount: number
}

interface Citation {
  documentId: string
  filename: string
  content: string
  score: number
}

interface AgentStep {
  agentName: string
  action: string
  success: boolean
  confidence?: number
  duration?: number
}

interface Reflection {
  accuracy: number
  completeness: number
  relevance: number
  clarity: number
  issues: string[]
  suggestions: string[]
  refinedContent?: string
}

export default function Home() {
  // State
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [selectedPrompt, setSelectedPrompt] = useState('')
  const [useRag, setUseRag] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeTab, setActiveTab] = useState<'chat' | 'docs' | 'settings'>('chat')
  const [uploading, setUploading] = useState(false)
  
  // Multi-agent state
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([])
  const [currentAgent, setCurrentAgent] = useState<string | null>(null)
  const [citations, setCitations] = useState<Citation[]>([])
  const [reflection, setReflection] = useState<Reflection | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [showReasoning, setShowReasoning] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Fetch initial data
  useEffect(() => {
    fetchDocuments().catch(() => {})
    fetchSystemPrompt().catch(() => {})
  }, [])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamContent])

  // Focus textarea
  useEffect(() => {
    if (!loading && !streaming) {
      textareaRef.current?.focus()
    }
  }, [loading, streaming])

  const fetchDocuments = async () => {
    const res = await fetch('/api/documents')
    const data = await res.json()
    setDocuments(data.documents || [])
  }

  const fetchSystemPrompt = async () => {
    const res = await fetch('/api/system-prompts')
    const data = await res.json()
    const defaultPrompt = data.prompts?.find((p: { isDefault: boolean }) => p.isDefault)
    if (defaultPrompt) setSelectedPrompt(defaultPrompt.content)
  }

  // Send message with multi-agent streaming
  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading || streaming) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      createdAt: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setCitations([])
    setReflection(null)
    setConfidence(null)
    setAgentSteps([])
    setStreamContent('')
    setStreaming(true)

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          conversationId,
          systemPrompt: selectedPrompt,
          useRag
        })
      })

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) throw new Error('No reader')

      let fullContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('event: conversation')) {
            const dataLine = lines[lines.indexOf(line) + 1]
            if (dataLine?.startsWith('data:')) {
              const data = JSON.parse(dataLine.slice(5))
              setConversationId(data.conversationId)
            }
          } else if (line.startsWith('event: query_analysis')) {
            const dataLine = lines[lines.indexOf(line) + 1]
            if (dataLine?.startsWith('data:')) {
              setCurrentAgent('query')
              setAgentSteps(prev => [...prev, { 
                agentName: 'query', 
                action: 'analyze', 
                success: true 
              }])
            }
          } else if (line.startsWith('event: retrieval')) {
            const dataLine = lines[lines.indexOf(line) + 1]
            if (dataLine?.startsWith('data:')) {
              const data = JSON.parse(dataLine.slice(5))
              setCurrentAgent('retrieval')
              setAgentSteps(prev => [...prev, { 
                agentName: 'retrieval', 
                action: 'search', 
                success: true 
              }])
              if (data.citations) {
                setCitations(data.citations.map((c: { filename: string; score: number }) => ({
                  filename: c.filename,
                  score: c.score,
                  content: '',
                  documentId: ''
                })))
              }
            }
          } else if (line.startsWith('event: reasoning')) {
            const dataLine = lines[lines.indexOf(line) + 1]
            if (dataLine?.startsWith('data:')) {
              setCurrentAgent('reasoning')
              setAgentSteps(prev => [...prev, { 
                agentName: 'reasoning', 
                action: 'think', 
                success: true 
              }])
            }
          } else if (line.startsWith('event: token')) {
            const dataLine = lines[lines.indexOf(line) + 1]
            if (dataLine?.startsWith('data:')) {
              const data = JSON.parse(dataLine.slice(5))
              if (data.content) {
                fullContent += data.content
                setStreamContent(fullContent)
                setCurrentAgent('response')
              }
            }
          } else if (line.startsWith('event: done')) {
            const dataLine = lines[lines.indexOf(line) + 1]
            if (dataLine?.startsWith('data:')) {
              const data = JSON.parse(dataLine.slice(5))
              setMessages(prev => [...prev, {
                id: data.messageId || Date.now().toString(),
                role: 'assistant',
                content: fullContent,
                createdAt: new Date().toISOString(),
                agentName: 'multi_agent'
              }])
              if (data.citations) setCitations(data.citations)
              setStreamContent('')
            }
          }
        }
      }
    } catch (error) {
      console.error('Stream error:', error)
    }

    setStreaming(false)
    setCurrentAgent(null)
  }, [input, loading, streaming, conversationId, selectedPrompt, useRag])

  const newConversation = () => {
    setMessages([])
    setConversationId(null)
    setCitations([])
    setReflection(null)
    setAgentSteps([])
  }

  // Document upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/documents', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.document) {
        setDocuments(prev => [data.document, ...prev])
      }
    } catch (error) {
      console.error('Upload error:', error)
    }

    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const deleteDocument = async (id: string) => {
    await fetch(`/api/documents/${id}`, { method: 'DELETE' })
    setDocuments(prev => prev.filter(d => d.id !== id))
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const getAgentIcon = (name: string) => {
    switch (name) {
      case 'query': return <Brain className="w-3 h-3" />
      case 'retrieval': return <Database className="w-3 h-3" />
      case 'reasoning': return <Network className="w-3 h-3" />
      case 'response': return <Sparkles className="w-3 h-3" />
      default: return <Cpu className="w-3 h-3" />
    }
  }

  const getAgentColor = (name: string) => {
    switch (name) {
      case 'query': return 'bg-blue-500'
      case 'retrieval': return 'bg-green-500'
      case 'reasoning': return 'bg-purple-500'
      case 'response': return 'bg-orange-500'
      default: return 'bg-gray-500'
    }
  }

  return (
    <div className="h-screen flex bg-gray-900 text-white">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-72' : 'w-0'} bg-gray-800 flex flex-col transition-all duration-300 overflow-hidden`}>
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-purple-400" />
            <h1 className="font-bold text-lg">Multi-Agent RAG</h1>
          </div>
          <p className="text-xs text-gray-400 mt-1">Neural Pipeline v2.0</p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          {[
            { id: 'chat', icon: MessageSquare, label: 'Chat' },
            { id: 'docs', icon: Database, label: 'Docs' },
            { id: 'settings', icon: Settings, label: 'Settings' }
          ].map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as typeof activeTab)}
              className={`flex-1 p-2 text-xs ${activeTab === id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700/50'}`}
            >
              <Icon className="w-4 h-4 mx-auto mb-1" />
              {label}
            </button>
          ))}
        </div>

        <ScrollArea className="flex-1">
          {activeTab === 'chat' && (
            <div className="p-3 space-y-3">
              <Button onClick={newConversation} variant="outline" className="w-full" size="sm">
                <Plus className="w-4 h-4 mr-2" /> Nova konverzacija
              </Button>
              
              {/* Agent Status */}
              {agentSteps.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs text-gray-400">Agent Pipeline</Label>
                  <div className="space-y-1">
                    {agentSteps.map((step, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 bg-gray-700 rounded text-xs">
                        <div className={`p-1 rounded ${getAgentColor(step.agentName)}`}>
                          {getAgentIcon(step.agentName)}
                        </div>
                        <span className="flex-1 capitalize">{step.agentName}</span>
                        {step.success ? (
                          <Check className="w-3 h-3 text-green-400" />
                        ) : (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'docs' && (
            <div className="p-3 space-y-3">
              <input ref={fileInputRef} type="file" accept=".txt,.md,.json,.csv" onChange={handleFileUpload} className="hidden" />
              
              <Button onClick={() => fileInputRef.current?.click()} variant="outline" className="w-full" size="sm" disabled={uploading}>
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                Upload fajl
              </Button>

              <Separator className="bg-gray-700" />

              <div className="space-y-1">
                {documents.map(doc => (
                  <div key={doc.id} className="group flex items-center gap-2 p-2 bg-gray-700 rounded text-sm">
                    <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{doc.filename}</div>
                      <div className="text-xs text-gray-400">
                        {formatBytes(doc.fileSize)} • {doc.chunkCount} chunks
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 h-6 w-6" onClick={() => deleteDocument(doc.id)}>
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </Button>
                  </div>
                ))}
                {documents.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-4">Nema dokumenata</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="p-3 space-y-4">
              <div>
                <Label className="text-xs text-gray-400">System Prompt</Label>
                <Textarea
                  value={selectedPrompt}
                  onChange={(e) => setSelectedPrompt(e.target.value)}
                  className="mt-1 min-h-[100px] text-sm"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-sm">Koristi RAG</Label>
                <Switch checked={useRag} onCheckedChange={setUseRag} />
              </div>

              <Separator className="bg-gray-700" />

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-gray-700 rounded p-2">
                  <div className="text-lg font-bold">{documents.length}</div>
                  <div className="text-xs text-gray-400">Dokumenata</div>
                </div>
                <div className="bg-gray-700 rounded p-2">
                  <div className="text-lg font-bold">{documents.reduce((a, d) => a + d.chunkCount, 0)}</div>
                  <div className="text-xs text-gray-400">Chunks</div>
                </div>
              </div>

              <Separator className="bg-gray-700" />

              <div className="text-xs text-gray-500 space-y-1">
                <p className="font-semibold text-gray-400">Agenti:</p>
                <p>• Query Agent - Analiza & dekompozicija</p>
                <p>• Retrieval Agent - Hybrid search</p>
                <p>• Reasoning Agent - Chain-of-thought</p>
                <p>• Response Agent - Sinteza</p>
                <p>• Reflection Agent - Self-evaluation</p>
              </div>
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Toggle Sidebar */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-gray-800 p-1 rounded-r hover:bg-gray-700"
        style={{ left: sidebarOpen ? '288px' : '0' }}
      >
        {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {/* Main Chat */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-800 bg-gray-900/50 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                <Network className="w-4 h-4 text-purple-400" />
                Multi-Agent Neural Pipeline
              </h2>
              <p className="text-xs text-gray-400">
                {useRag && documents.length > 0 ? `RAG aktivan • ${documents.length} dokumenata` : 'RAG neaktivan'}
                {currentAgent && ` • ${currentAgent} agent`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {confidence !== null && (
                <Badge variant="outline" className="text-xs">
                  <Zap className="w-3 h-3 mr-1" />
                  {Math.round(confidence * 100)}%
                </Badge>
              )}
              <Badge variant="default" className="text-xs">
                <Cpu className="w-3 h-3 mr-1" />
                5 agenata
              </Badge>
            </div>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4">
          <div className="max-w-4xl mx-auto space-y-4">
            {messages.length === 0 && !loading && !streaming && (
              <div className="text-center py-12">
                <Network className="w-16 h-16 text-purple-400 mx-auto mb-4" />
                <h3 className="text-2xl font-semibold mb-2">Multi-Agent Neural RAG</h3>
                <p className="text-gray-400 max-w-lg mx-auto mb-4">
                  5 agenata radi zajedno: Query, Retrieval, Reasoning, Response i Reflection.
                </p>
                <div className="grid grid-cols-5 gap-2 max-w-md mx-auto text-xs">
                  {['Query', 'Retrieval', 'Reasoning', 'Response', 'Reflection'].map((agent, i) => (
                    <div key={i} className="bg-gray-800 rounded p-2 text-center">
                      <div className="text-purple-400 font-semibold">{agent}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] ${msg.role === 'user' ? 'order-2' : ''}`}>
                  {msg.agentName && msg.role === 'assistant' && (
                    <div className="flex items-center gap-1 mb-1 text-xs text-gray-400">
                      {getAgentIcon(msg.agentName)}
                      <span className="capitalize">{msg.agentName}</span>
                      {msg.confidence && (
                        <span className="ml-2">{Math.round(msg.confidence * 100)}% confidence</span>
                      )}
                    </div>
                  )}
                  <div className={`rounded-lg p-4 ${
                    msg.role === 'user'
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-800 text-gray-100'
                  }`}>
                    {msg.role === 'assistant' ? (
                      <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Streaming content */}
            {streaming && streamContent && (
              <div className="flex justify-start">
                <div className="max-w-[85%]">
                  <div className="flex items-center gap-1 mb-1 text-xs text-gray-400">
                    <Sparkles className="w-3 h-3" />
                    response
                  </div>
                  <div className="rounded-lg p-4 bg-gray-800 text-gray-100">
                    <div className="prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown>{streamContent}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Loading with agent status */}
            {(loading || (streaming && !streamContent)) && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg p-4 bg-gray-800">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                    <div className="text-sm">
                      {currentAgent ? (
                        <span className="capitalize">{currentAgent} agent radi...</span>
                      ) : (
                        <span>Inicijalizacija pipeline-a...</span>
                      )}
                    </div>
                  </div>
                  {agentSteps.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {agentSteps.map((step, i) => (
                        <div 
                          key={i} 
                          className={`w-2 h-2 rounded-full ${step.success ? 'bg-green-500' : 'bg-gray-500'}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Citations */}
            {citations.length > 0 && !streaming && (
              <div className="bg-gray-800/50 rounded-lg p-3 text-sm">
                <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
                  <Database className="w-3 h-3" /> Izvori ({citations.length})
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {citations.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <Badge variant="outline" className="shrink-0 text-[10px]">{i + 1}</Badge>
                      <div className="flex-1">
                        <div className="text-purple-400">{c.filename}</div>
                        <div className="text-gray-400 truncate">{c.content}</div>
                      </div>
                      <div className="text-gray-500">{(c.score * 100).toFixed(0)}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reflection */}
            {reflection && !streaming && (
              <div className="bg-gray-800/50 rounded-lg p-3 text-sm">
                <div className="text-xs text-gray-400 mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Eye className="w-3 h-3" /> Self-Reflection
                  </span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-5 text-[10px]"
                    onClick={() => setShowReasoning(!showReasoning)}
                  >
                    {showReasoning ? 'Sakrij' : 'Prikaži'}
                  </Button>
                </div>
                {showReasoning && (
                  <>
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      {[
                        { label: 'Accuracy', value: reflection.accuracy },
                        { label: 'Complete', value: reflection.completeness },
                        { label: 'Relevant', value: reflection.relevance },
                        { label: 'Clarity', value: reflection.clarity }
                      ].map(({ label, value }) => (
                        <div key={label} className="text-center">
                          <div className="text-xs text-gray-400">{label}</div>
                          <div className="text-lg font-bold">{Math.round(value * 100)}%</div>
                          <Progress value={value * 100} className="h-1 mt-1" />
                        </div>
                      ))}
                    </div>
                    {reflection.issues.length > 0 && (
                      <div className="text-xs text-red-400">
                        Issues: {reflection.issues.join(', ')}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="p-4 border-t border-gray-800 bg-gray-900/50 backdrop-blur">
          <div className="max-w-4xl mx-auto flex gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder="Napiši poruku... (Shift+Enter za novi red)"
              className="min-h-[44px] max-h-[200px] resize-none"
              disabled={loading || streaming}
            />
            <Button onClick={sendMessage} disabled={loading || streaming || !input.trim()} className="h-11 px-4">
              {loading || streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <div className="flex items-center justify-center gap-4 mt-2 text-xs text-gray-500">
            <span>RAG: {useRag ? '✓' : '✗'}</span>
            <span>Docs: {documents.length}</span>
            <span>Agents: Query → Retrieval → Reasoning → Response → Reflection</span>
          </div>
        </div>
      </div>
    </div>
  )
}
