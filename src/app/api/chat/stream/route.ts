import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Embedding
function generateEmbedding(text: string): number[] {
  const dim = 384
  const embedding = new Array(dim).fill(0)
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  
  for (const word of words) {
    let h = 0
    for (let i = 0; i < word.length; i++) {
      h = ((h << 5) - h) + word.charCodeAt(i)
      h = h & h
    }
    for (let i = 0; i < 5; i++) {
      const idx = Math.abs((h + i * 77) % dim)
      embedding[idx] += 1 / (1 + i)
    }
  }
  
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0))
  if (norm > 0) for (let i = 0; i < dim; i++) embedding[i] /= norm
  return embedding
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

async function searchChunks(query: string, topK: number = 3) {
  try {
    const chunks = await db.documentChunk.findMany({
      include: { document: true },
      take: 50
    })
    if (chunks.length === 0) return []
    
    const qEmb = generateEmbedding(query)
    const scored = chunks.map(c => {
      let emb = generateEmbedding(c.content)
      if (c.embedding) try { emb = JSON.parse(c.embedding) } catch {}
      return {
        content: c.content,
        filename: c.document.filename,
        documentId: c.documentId,
        score: cosine(qEmb, emb)
      }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  } catch {
    return []
  }
}

export async function POST(request: NextRequest) {
  const { message, conversationId, systemPrompt, useRag } = await request.json()
  if (!message) return new Response(JSON.stringify({ error: 'Poruka je obavezna' }), { status: 400 })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // Get/create conversation
        let conv = conversationId 
          ? await db.conversation.findUnique({ where: { id: conversationId } })
          : null
        
        if (!conv) {
          conv = await db.conversation.create({ data: { title: message.slice(0, 50) } })
          send('conversation', { conversationId: conv.id })
        }

        // Save user message
        await db.message.create({
          data: { conversationId: conv.id, role: 'user', content: message }
        })

        // Get history
        const history = await db.message.findMany({
          where: { conversationId: conv.id },
          orderBy: { createdAt: 'asc' },
          take: 20
        })

        // Build messages
        const msgs: Array<{ role: string; content: string }> = []
        let system = systemPrompt || 'Ti si korisni AI asistent. Odgovaraj na jeziku korisnika.'
        
        // RAG
        let citations: object[] = []
        if (useRag) {
          const results = await searchChunks(message, 3)
          if (results.length > 0) {
            system += `\n\nKontekst:\n${results.map(r => `[${r.filename}]:\n${r.content}`).join('\n\n---\n\n')}`
            citations = results
            send('citations', { citations })
          }
        }
        
        msgs.push({ role: 'system', content: system })
        for (const m of history.slice(0, -1)) msgs.push({ role: m.role, content: m.content })
        msgs.push({ role: 'user', content: message })

        // Stream LLM
        const zai = await ZAI.create()
        let fullContent = ''

        try {
          const completion = await zai.chat.completions.create({
            messages: msgs,
            stream: true,
            temperature: 0.7,
            max_tokens: 2000
          })

          for await (const chunk of completion) {
            const content = chunk.choices?.[0]?.delta?.content
            if (content) {
              fullContent += content
              send('token', { content })
            }
          }
        } catch {
          // Fallback: non-streaming
          const completion = await zai.chat.completions.create({
            messages: msgs,
            temperature: 0.7,
            max_tokens: 2000
          })
          fullContent = completion.choices[0]?.message?.content || ''
          send('token', { content: fullContent })
        }

        // Save response
        await db.message.create({
          data: {
            conversationId: conv.id,
            role: 'assistant',
            content: fullContent,
            tokens: fullContent.split(' ').length
          }
        })

        send('done', { messageId: Date.now().toString() })
        controller.close()

      } catch (error) {
        console.error('Stream error:', error)
        send('error', { message: 'Greška' })
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  })
}
