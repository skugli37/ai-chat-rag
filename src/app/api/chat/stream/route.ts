import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getPipeline } from '@/lib/agents/pipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Multi-Agent Streaming API with real-time agent updates
export async function POST(request: NextRequest) {
  const { 
    message, 
    conversationId, 
    systemPrompt, 
    useRag = true 
  } = await request.json()

  if (!message) {
    return new Response(JSON.stringify({ error: 'Poruka je obavezna' }), { status: 400 })
  }

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
          conv = await db.conversation.create({
            data: { title: message.slice(0, 50) }
          })
          send('conversation', { conversationId: conv.id })
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

        // Get pipeline and stream
        const pipeline = await getPipeline()
        let fullContent = ''
        let citations: object[] = []

        for await (const chunk of pipeline.executeStream({
          conversationId: conv.id,
          messageHistory: history.map(m => ({
            id: m.id,
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
            createdAt: m.createdAt
          })),
          userQuery: message,
          systemPrompt,
          useRag,
          maxTokens: 2000
        })) {
          if (chunk.type === 'query') {
            send('query_analysis', chunk.data)
          } else if (chunk.type === 'retrieval') {
            send('retrieval', chunk.data)
            if ((chunk.data as { citations?: object[] }).citations) {
              citations = (chunk.data as { citations?: object[] }).citations || []
            }
          } else if (chunk.type === 'reasoning') {
            send('reasoning', chunk.data)
          } else if (chunk.type === 'response') {
            const data = chunk.data as { content: string; done: boolean }
            if (data.content) {
              fullContent += data.content
              send('token', { content: data.content })
            }
          } else if (chunk.type === 'done') {
            // Save assistant message
            const assistantMessage = await db.message.create({
              data: {
                conversationId: conv.id,
                role: 'assistant',
                content: fullContent,
                tokens: (chunk.data as { tokens?: number }).tokens || fullContent.split(' ').length,
                agentName: 'multi_agent_pipeline'
              }
            })

            // Save citations
            if (citations.length > 0) {
              for (const c of citations) {
                const citation = c as { documentId?: string; filename?: string; content?: string; score?: number }
                if (citation.documentId) {
                  await db.citation.create({
                    data: {
                      messageId: assistantMessage.id,
                      documentId: citation.documentId,
                      chunkIndex: 0,
                      content: citation.content || '',
                      score: citation.score || 0
                    }
                  })
                }
              }
            }

            send('done', { 
              messageId: assistantMessage.id,
              citations,
              ...chunk.data 
            })
          }
        }

        // Update conversation
        await db.conversation.update({
          where: { id: conv.id },
          data: { updatedAt: new Date() }
        })

        controller.close()

      } catch (error) {
        console.error('Stream error:', error)
        send('error', { 
          message: error instanceof Error ? error.message : 'Greška pri obradi' 
        })
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
