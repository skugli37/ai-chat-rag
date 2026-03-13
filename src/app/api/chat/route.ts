import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import ZAI from 'z-ai-web-dev-sdk'

// Simple embedding (384-dim)
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
  if (norm > 0) {
    for (let i = 0; i < dim; i++) embedding[i] /= norm
  }
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

// Hybrid search with fallback
async function searchChunks(query: string, topK: number = 3) {
  try {
    const chunks = await db.documentChunk.findMany({
      include: { document: true },
      take: 100
    })
    
    if (chunks.length === 0) return []
    
    const qEmb = generateEmbedding(query)
    
    const scored = chunks.map(c => {
      let emb = generateEmbedding(c.content)
      if (c.embedding) {
        try { emb = JSON.parse(c.embedding) } catch {}
      }
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
  try {
    const { message, conversationId, systemPrompt, useRag } = await request.json()

    if (!message) {
      return NextResponse.json({ error: 'Poruka je obavezna' }, { status: 400 })
    }

    // Get/create conversation
    let conv = conversationId 
      ? await db.conversation.findUnique({ where: { id: conversationId } })
      : null
    
    if (!conv) {
      conv = await db.conversation.create({
        data: { title: message.slice(0, 50) }
      })
    }

    // Save user message
    await db.message.create({
      data: {
        conversationId: conv.id,
        role: 'user',
        content: message
      }
    })

    // Get history
    const history = await db.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'asc' },
      take: 20
    })

    // Build messages
    const messages: Array<{ role: string; content: string }> = []
    
    let system = systemPrompt || 'Ti si korisni AI asistent. Odgovaraj precizno, koncizno i na jeziku korisnika. Koristi markdown formatiranje.'
    
    // RAG
    let citations: object[] = []
    if (useRag) {
      const results = await searchChunks(message, 3)
      if (results.length > 0) {
        const ctx = results.map(r => `[${r.filename}]:\n${r.content}`).join('\n\n---\n\n')
        system += `\n\n## Kontekst:\n${ctx}`
        citations = results
      }
    }
    
    messages.push({ role: 'system', content: system })
    
    for (const msg of history.slice(0, -1)) {
      messages.push({ role: msg.role, content: msg.content })
    }
    
    messages.push({ role: 'user', content: message })

    // LLM
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages,
      temperature: 0.7,
      max_tokens: 2000
    })

    const response = completion.choices[0]?.message?.content || 'Nema odgovora'

    // Save response
    await db.message.create({
      data: {
        conversationId: conv.id,
        role: 'assistant',
        content: response,
        tokens: response.split(' ').length
      }
    })

    return NextResponse.json({ 
      response,
      conversationId: conv.id,
      citations: citations.length > 0 ? citations : undefined
    })
  } catch (error) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: 'Greška pri obradi poruke' }, { status: 500 })
  }
}
