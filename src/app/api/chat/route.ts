import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import ZAI from 'z-ai-web-dev-sdk'

// Simple similarity search
function simpleSimilarity(query: string, text: string): number {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const textWords = text.toLowerCase().split(/\s+/)
  
  let score = 0
  for (const qWord of queryWords) {
    const count = textWords.filter(t => t.includes(qWord) || qWord.includes(t)).length
    score += count / textWords.length
  }
  
  return queryWords.length > 0 ? score / queryWords.length : 0
}

async function getRelevantContext(query: string, topK: number = 3): Promise<string> {
  const chunks = await db.documentChunk.findMany({
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

export async function POST(request: NextRequest) {
  try {
    const { message, conversationId, systemPrompt, useRag } = await request.json()

    if (!message) {
      return NextResponse.json({ error: 'Poruka je obavezna' }, { status: 400 })
    }

    // Get or create conversation
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

    // Get conversation history
    const history = await db.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'asc' },
      take: 20
    })

    // Build messages for LLM
    const messages: Array<{ role: string; content: string }> = []
    
    let system = systemPrompt || 'Ti si korisni AI asistent. Odgovaraj precizno, koncizno i na jeziku korisnika.'
    
    if (useRag) {
      const context = await getRelevantContext(message)
      if (context) {
        system += `\n\nKontekst iz baze znanja:\n${context}`
      }
    }
    
    messages.push({ role: 'system', content: system })
    
    for (const msg of history.slice(0, -1)) {
      messages.push({ role: msg.role, content: msg.content })
    }
    
    messages.push({ role: 'user', content: message })

    // Initialize ZAI and get response
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages,
      temperature: 0.7,
      max_tokens: 2000
    })

    const response = completion.choices[0]?.message?.content || 'Nema odgovora'

    // Save assistant message
    await db.message.create({
      data: {
        conversationId: conv.id,
        role: 'assistant',
        content: response,
        tokens: response.split(' ').length
      }
    })

    // Update conversation
    await db.conversation.update({
      where: { id: conv.id },
      data: { updatedAt: new Date() }
    })

    return NextResponse.json({ 
      response,
      conversationId: conv.id 
    })
  } catch (error) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: 'Greška pri obradi poruke' }, { status: 500 })
  }
}
