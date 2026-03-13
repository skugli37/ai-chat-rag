'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { 
  Send, Upload, Trash2, Settings, FileText, MessageSquare, 
  Plus, Loader2, Sparkles, Database, ChevronLeft, ChevronRight,
  Check
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

interface Conversation {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
}

interface Document {
  id: string
  filename: string
  fileType: string
  fileSize: number
  chunkCount: number
  createdAt: string
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [documents, setDocuments] = useState<Document[]>([])
  const [selectedPrompt, setSelectedPrompt] = useState<string>('')
  const [useRag, setUseRag] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeTab, setActiveTab] = useState<'chat' | 'docs' | 'settings'>('chat')
  const [uploading, setUploading] = useState(false)
  const [textInput, setTextInput] = useState('')
  const [showTextInput, setShowTextInput] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch initial data
  useEffect(() => {
    fetch('/api/documents').then(r => r.json()).then(data => setDocuments(data.documents || []))
    fetch('/api/system-prompts').then(r => r.json()).then(data => {
      const defaultPrompt = data.prompts?.find((p: { isDefault: boolean }) => p.isDefault)
      if (defaultPrompt) setSelectedPrompt(defaultPrompt.content)
    })
    fetch('/api/conversations/list').then(r => r.json()).then(data => setConversations(data.conversations || [])).catch(() => {})
  }, [])

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      createdAt: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          conversationId,
          systemPrompt: selectedPrompt,
          useRag
        })
      })

      const data = await res.json()
      
      if (data.response) {
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.response,
          createdAt: new Date().toISOString()
        }])
        setConversationId(data.conversationId)
      }
    } catch (error) {
      console.error('Chat error:', error)
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Greška pri komunikaciji sa serverom.',
        createdAt: new Date().toISOString()
      }])
    }

    setLoading(false)
  }, [input, loading, conversationId, selectedPrompt, useRag])

  const newConversation = useCallback(() => {
    setMessages([])
    setConversationId(null)
  }, [])

  const deleteDocument = async (id: string) => {
    try {
      await fetch(`/api/documents/${id}`, { method: 'DELETE' })
      setDocuments(prev => prev.filter(d => d.id !== id))
    } catch (error) {
      console.error('Delete error:', error)
    }
  }

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

  const handleTextUpload = async () => {
    if (!textInput.trim()) return

    setUploading(true)
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: textInput })
      })
      const data = await res.json()
      if (data.document) {
        setDocuments(prev => [data.document, ...prev])
      }
      setTextInput('')
      setShowTextInput(false)
    } catch (error) {
      console.error('Upload error:', error)
    }

    setUploading(false)
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  return (
    <div className="h-screen flex bg-gray-900 text-white">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-64' : 'w-0'} bg-gray-800 flex flex-col transition-all duration-300 overflow-hidden`}>
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            <h1 className="font-bold text-lg">AI Chat RAG</h1>
          </div>
          <p className="text-xs text-gray-400 mt-1">Powered by z-ai-web-dev-sdk</p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          {[
            { id: 'chat', icon: MessageSquare },
            { id: 'docs', icon: Database },
            { id: 'settings', icon: Settings }
          ].map(({ id, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as typeof activeTab)}
              className={`flex-1 p-2 ${activeTab === id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700/50'}`}
            >
              <Icon className="w-4 h-4 mx-auto" />
            </button>
          ))}
        </div>

        <ScrollArea className="flex-1">
          {activeTab === 'chat' && (
            <div className="p-2">
              <Button onClick={newConversation} variant="outline" className="w-full mb-2" size="sm">
                <Plus className="w-4 h-4 mr-2" /> Nova konverzacija
              </Button>
              
              <div className="text-xs text-gray-400 text-center py-4">
                {conversationId ? 'Aktivna konverzacija' : 'Nova konverzacija'}
              </div>
            </div>
          )}

          {activeTab === 'docs' && (
            <div className="p-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.json,.csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                className="w-full mb-2"
                size="sm"
                disabled={uploading}
              >
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                Upload fajl
              </Button>
              
              <Button
                onClick={() => setShowTextInput(!showTextInput)}
                variant="outline"
                className="w-full mb-2"
                size="sm"
              >
                <FileText className="w-4 h-4 mr-2" />
                Unesi tekst
              </Button>

              {showTextInput && (
                <div className="mb-2 p-2 bg-gray-700 rounded">
                  <Textarea
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder="Unesi tekst za bazu znanja..."
                    className="mb-2 min-h-[100px]"
                  />
                  <Button onClick={handleTextUpload} size="sm" className="w-full" disabled={uploading}>
                    {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    Sačuvaj
                  </Button>
                </div>
              )}

              <div className="space-y-1">
                {documents.map(doc => (
                  <div key={doc.id} className="group flex items-center gap-2 p-2 bg-gray-700 rounded">
                    <FileText className="w-4 h-4 text-blue-400" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{doc.filename}</div>
                      <div className="text-xs text-gray-400">
                        {formatBytes(doc.fileSize)} • {doc.chunkCount} chunks
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 h-6 w-6"
                      onClick={() => deleteDocument(doc.id)}
                    >
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
                  className="mt-1 min-h-[120px] text-sm"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-sm">Koristi RAG</Label>
                <Switch checked={useRag} onCheckedChange={setUseRag} />
              </div>
              <p className="text-xs text-gray-400">
                Pretražuje uploadovane dokumente za relevantan kontekst
              </p>

              <Separator className="bg-gray-700" />

              <div>
                <Label className="text-xs text-gray-400">Dokumenata u bazi</Label>
                <div className="text-lg font-bold">{documents.length}</div>
              </div>

              <div>
                <Label className="text-xs text-gray-400">Ukupno chunks</Label>
                <div className="text-lg font-bold">
                  {documents.reduce((acc, d) => acc + d.chunkCount, 0)}
                </div>
              </div>
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Toggle Sidebar */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-gray-800 p-1 rounded-r hover:bg-gray-700"
        style={{ left: sidebarOpen ? '256px' : '0' }}
      >
        {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {/* Main Chat */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-800 bg-gray-900/50 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">
                {conversationId ? 'Konverzacija' : 'Nova konverzacija'}
              </h2>
              <p className="text-xs text-gray-400">
                {useRag && documents.length > 0 ? `RAG aktivan (${documents.length} dokumenata)` : 'RAG neaktivan'}
              </p>
            </div>
            <Badge variant="default">
              REST API
            </Badge>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4">
          <div className="max-w-4xl mx-auto space-y-4">
            {messages.length === 0 && !loading && (
              <div className="text-center py-12">
                <Sparkles className="w-12 h-12 text-purple-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">AI Chat sa RAG</h3>
                <p className="text-gray-400 max-w-md mx-auto">
                  Postavi pitanje ili uploaduj dokumente za bazu znanja. 
                  AI će koristiti RAG za relevantne odgovore.
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-4 ${
                    msg.role === 'user'
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-800 text-gray-100'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg p-4 bg-gray-800">
                  <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="p-4 border-t border-gray-800 bg-gray-900/50 backdrop-blur">
          <div className="max-w-4xl mx-auto flex gap-2">
            <Textarea
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
              disabled={loading}
            />
            <Button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="h-11"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-xs text-gray-500 text-center mt-2">
            AI koristi z-ai-web-dev-sdk. RAG: {useRag ? 'UKLJUČEN' : 'ISKLJUČEN'}
          </p>
        </div>
      </div>
    </div>
  )
}
