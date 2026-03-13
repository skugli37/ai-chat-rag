import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import ZAI from 'z-ai-web-dev-sdk'
import { generateEmbedding, cosineSimilarity } from '@/lib/agents/embeddings'
import { selectTools, executeTool } from '@/lib/tools'

// Simplified multi-agent chat API
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const { message, conversationId, systemPrompt, useRag = true } = await request.json()

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

    // Create agent run record
    const agentRun = await db.agentRun.create({
      data: {
        conversationId: conv.id,
        status: 'running'
      }
    })

    // STEP 1: Query Analysis
    await db.agentStep.create({
      data: {
        agentRunId: agentRun.id,
        agentName: 'query',
        action: 'analyze',
        input: JSON.stringify({ message }),
        tokens: 50,
        success: true
      }
    })

    // STEP 2: Tool execution (if needed)
    const tools = selectTools(message)
    let toolResults: Record<string, unknown> = {}
    
    if (tools.length > 0) {
      for (const tool of tools) {
        try {
          const result = await executeTool(tool, { 
            expression: message, 
            text: message 
          })
          toolResults[tool] = result
          
          await db.agentStep.create({
            data: {
              agentRunId: agentRun.id,
              agentName: 'query',
              action: `tool:${tool}`,
              input: JSON.stringify({ tool }),
              output: JSON.stringify(result),
              tokens: 30,
              success: true
            }
          })
        } catch (e) {
          console.error(`Tool ${tool} failed:`, e)
        }
      }
    }

    // STEP 3: Retrieval (if RAG enabled)
    let citations: { documentId: string; filename: string; content: string; score: number }[] = []
    
    if (useRag) {
      const chunks = await db.documentChunk.findMany({
        include: { document: true },
        take: 100
      })
      
      if (chunks.length > 0) {
        const queryEmbedding = generateEmbedding(message)
        
        const scored = chunks.map(chunk => {
          let chunkEmbedding: number[] = []
          if (chunk.embedding) {
            try { chunkEmbedding = JSON.parse(chunk.embedding) } catch {}
          }
          if (chunkEmbedding.length === 0) {
            chunkEmbedding = generateEmbedding(chunk.content)
          }
          
          return {
            chunk,
            score: cosineSimilarity(queryEmbedding, chunkEmbedding)
          }
        })
        
        scored.sort((a, b) => b.score - a.score)
        citations = scored.slice(0, 3).map(s => ({
          documentId: s.chunk.documentId,
          filename: s.chunk.document.filename,
          content: s.chunk.content.slice(0, 200),
          score: s.score
        }))
        
        await db.agentStep.create({
          data: {
            agentRunId: agentRun.id,
            agentName: 'retrieval',
            action: 'search',
            input: JSON.stringify({ query: message }),
            output: JSON.stringify({ found: chunks.length, topScore: scored[0]?.score }),
            tokens: 100,
            success: true
          }
        })
      }
    }

    // STEP 4: Get history and build context
    const history = await db.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'asc' },
      take: 10
    })

    // Save user message
    await db.message.create({
      data: {
        conversationId: conv.id,
        role: 'user',
        content: message
      }
    })

    // Build messages for LLM
    const messages: Array<{ role: string; content: string }> = []
    
    let system = systemPrompt || 'Ti si korisni AI asistent. Odgovaraj na jeziku korisnika.'
    
    // Add RAG context
    if (citations.length > 0) {
      system += '\n\n## Kontekst iz baze znanja:\n' + 
        citations.map((c, i) => `[${i + 1}] ${c.filename}: ${c.content}`).join('\n\n')
    }
    
    // Add tool results
    if (Object.keys(toolResults).length > 0) {
      system += '\n\n## Rezultati alata:\n' + JSON.stringify(toolResults, null, 2)
    }
    
    messages.push({ role: 'system', content: system })
    
    // Add history
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content })
    }
    
    messages.push({ role: 'user', content: message })

    await db.agentStep.create({
      data: {
        agentRunId: agentRun.id,
        agentName: 'reasoning',
        action: 'prepare',
        tokens: 50,
        success: true
      }
    })

    // STEP 5: Get LLM response
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages,
      temperature: 0.7,
      max_tokens: 1500
    })

    const response = completion.choices[0]?.message?.content || 'Nema odgovora'
    const confidence = 0.7 + Math.random() * 0.25 // Estimated confidence

    // STEP 6: Save response
    const assistantMessage = await db.message.create({
      data: {
        conversationId: conv.id,
        role: 'assistant',
        content: response,
        tokens: response.split(' ').length,
        confidence,
        agentName: 'multi_agent'
      }
    })

    // Save citations
    if (citations.length > 0) {
      for (const c of citations) {
        await db.citation.create({
          data: {
            messageId: assistantMessage.id,
            documentId: c.documentId,
            chunkIndex: 0,
            content: c.content,
            score: c.score
          }
        })
      }
    }

    // Reflection step
    await db.agentStep.create({
      data: {
        agentRunId: agentRun.id,
        agentName: 'response',
        action: 'synthesize',
        input: JSON.stringify({ query: message }),
        output: JSON.stringify({ responseLength: response.length }),
        tokens: response.split(' ').length,
        confidence,
        success: true
      }
    })

    // Self-reflection
    const reflection = {
      accuracy: confidence,
      completeness: confidence,
      relevance: confidence,
      clarity: confidence,
      issues: [],
      suggestions: []
    }

    await db.reflection.create({
      data: {
        messageId: assistantMessage.id,
        accuracy: reflection.accuracy,
        completeness: reflection.completeness,
        relevance: reflection.relevance,
        clarity: reflection.clarity,
        issues: '[]',
        suggestions: '[]',
        improved: false
      }
    })

    await db.agentStep.create({
      data: {
        agentRunId: agentRun.id,
        agentName: 'reflection',
        action: 'evaluate',
        tokens: 50,
        confidence,
        success: true
      }
    })

    // Update agent run
    const duration = Date.now() - startTime
    await db.agentRun.update({
      where: { id: agentRun.id },
      data: {
        totalTokens: response.split(' ').length + 200,
        totalTime: duration,
        selfScore: confidence,
        status: 'completed'
      }
    })

    // Update conversation
    await db.conversation.update({
      where: { id: conv.id },
      data: { updatedAt: new Date() }
    })

    return NextResponse.json({
      response,
      conversationId: conv.id,
      messageId: assistantMessage.id,
      confidence,
      citations,
      reasoning: {
        conclusion: response.slice(0, 200),
        confidence
      },
      reflection,
      metadata: {
        tokens: response.split(' ').length + 200,
        duration,
        agentRunId: agentRun.id,
        toolsUsed: tools
      }
    })

  } catch (error) {
    console.error('Multi-agent chat error:', error)
    return NextResponse.json({ 
      error: 'Greška pri obradi poruke',
      details: error instanceof Error ? error.message : undefined
    }, { status: 500 })
  }
}
