import { createServer } from 'http'
import { Server } from 'socket.io'
import { PrismaClient } from '../../node_modules/@prisma/client'
import ZAI from 'z-ai-web-dev-sdk'

const prisma = new PrismaClient()

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Simple text chunking for RAG
function chunkText(text: string, chunkSize: number = 500, overlap: number = 50): string[] {
  const chunks: string[] = []
  let start = 0
  
  while (start < text.length) {
    const end = start + chunkSize
    chunks.push(text.slice(start, end))
    start += chunkSize - overlap
  }
  
  return chunks.filter(c => c.trim().length > 0)
}

// Simple similarity search using TF-IDF-like scoring
function simpleSimilarity(query: string, text: string): number {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const textWords = text.toLowerCase().split(/\s+/)
  
  let score = 0
  for (const qWord of queryWords) {
    const count = textWords.filter(t => t.includes(qWord) || qWord.includes(t)).length
    score += count / textWords.length
  }
  
  return score / queryWords.length
}

// RAG: Get relevant context from documents
async function getRelevantContext(query: string, topK: number = 3): Promise<string> {
  const chunks = await prisma.documentChunk.findMany({
    include: { document: true }
  })
  
  if (chunks.length === 0) return ''
  
  const scored = chunks.map(chunk => ({
    chunk,
    score: simpleSimilarity(query, chunk.content)
  }))
  
  scored.sort((a, b) => b.score - a.score)
  
  const topChunks = scored.slice(0, topK)
  
  if (topChunks.length === 0 || topChunks[0].score === 0) return ''
  
  return topChunks.map(s => `[${s.chunk.document.filename}]:\n${s.chunk.content}`).join('\n\n---\n\n')
}

// Main chat handler
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`)

  socket.on('chat', async (data: { 
    conversationId?: string
    message: string
    systemPrompt?: string
    useRag?: boolean
  }) => {
    const { conversationId, message, systemPrompt, useRag } = data
    
    try {
      // Get or create conversation
      let conv = conversationId 
        ? await prisma.conversation.findUnique({ where: { id: conversationId } })
        : null
      
      if (!conv) {
        conv = await prisma.conversation.create({
          data: { title: message.slice(0, 50) }
        })
      }

      // Save user message
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          role: 'user',
          content: message
        }
      })

      // Get conversation history
      const history = await prisma.message.findMany({
        where: { conversationId: conv.id },
        orderBy: { createdAt: 'asc' },
        take: 20 // Last 20 messages for context
      })

      // Build messages for LLM
      const messages: Array<{ role: string; content: string }> = []
      
      // System prompt
      let system = systemPrompt || 'Ti si korisni AI asistent. Odgovaraj na jeziku korisnika.'
      
      // Add RAG context if enabled
      if (useRag) {
        const context = await getRelevantContext(message)
        if (context) {
          system += `\n\nKontekst iz baze znanja:\n${context}`
        }
      }
      
      messages.push({ role: 'system', content: system })
      
      // Add history
      for (const msg of history.slice(0, -1)) {
        messages.push({ role: msg.role, content: msg.content })
      }
      
      // Add current message
      messages.push({ role: 'user', content: message })

      // Send conversation ID
      socket.emit('conversation', { conversationId: conv.id })

      // Initialize ZAI
      const zai = await ZAI.create()

      // Non-streaming request (more reliable)
      const completion = await zai.chat.completions.create({
        messages,
        temperature: 0.7,
        max_tokens: 2000
      })

      const fullResponse = completion.choices[0]?.message?.content || 'Nema odgovora'
      
      // Send full response
      socket.emit('stream', { content: fullResponse, done: false })
      socket.emit('stream', { content: '', done: true })

      // Save assistant message
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          role: 'assistant',
          content: fullResponse,
          tokens: fullResponse.split(' ').length
        }
      })

      // Update conversation
      await prisma.conversation.update({
        where: { id: conv.id },
        data: { updatedAt: new Date() }
      })

      socket.emit('stream', { content: '', done: true })

    } catch (error) {
      console.error('Chat error:', error)
      socket.emit('error', { message: 'Greška pri obradi poruke' })
    }
  })

  // Get conversation history
  socket.on('get-history', async (data: { conversationId: string }) => {
    try {
      const messages = await prisma.message.findMany({
        where: { conversationId: data.conversationId },
        orderBy: { createdAt: 'asc' }
      })
      socket.emit('history', { messages })
    } catch (error) {
      socket.emit('error', { message: 'Greška pri dohvatanju istorije' })
    }
  })

  // Get all conversations
  socket.on('get-conversations', async () => {
    try {
      const conversations = await prisma.conversation.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 50
      })
      socket.emit('conversations', { conversations })
    } catch (error) {
      socket.emit('error', { message: 'Greška pri dohvatanju konveracija' })
    }
  })

  // Delete conversation
  socket.on('delete-conversation', async (data: { conversationId: string }) => {
    try {
      await prisma.conversation.delete({ where: { id: data.conversationId } })
      socket.emit('conversation-deleted', { conversationId: data.conversationId })
    } catch (error) {
      socket.emit('error', { message: 'Greška pri brisanju konverzacije' })
    }
  })

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`)
  })

  socket.on('error', (error) => {
    console.error(`Socket error (${socket.id}):`, error)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`AI Chat WebSocket server running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  console.log('Shutting down...')
  httpServer.close(() => {
    prisma.$disconnect()
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('Shutting down...')
  httpServer.close(() => {
    prisma.$disconnect()
    process.exit(0)
  })
})
