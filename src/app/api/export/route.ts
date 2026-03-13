import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST - Export conversation
export async function POST(request: NextRequest) {
  try {
    const { conversationId, format } = await request.json()
    
    if (!conversationId) {
      return NextResponse.json({ error: 'ID konverzacije je obavezan' }, { status: 400 })
    }

    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    })

    if (!conversation) {
      return NextResponse.json({ error: 'Konverzacija nije pronađena' }, { status: 404 })
    }

    let content = ''
    let filename = `conversation-${conversationId.slice(0, 8)}`
    let mimeType = 'text/plain'

    switch (format) {
      case 'json':
        content = JSON.stringify({
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt,
          messages: conversation.messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt
          }))
        }, null, 2)
        filename += '.json'
        mimeType = 'application/json'
        break

      default: // markdown
        content = `# ${conversation.title || 'Konverzacija'}\n\n`
        content += `*Kreirana: ${new Date(conversation.createdAt).toLocaleString('sr-RS')}*\n\n`
        content += '---\n\n'
        
        for (const msg of conversation.messages) {
          const role = msg.role === 'user' ? '👤 **Korisnik**' : 
                       msg.role === 'assistant' ? '🤖 **Asistent**' : '⚙️ **Sistem**'
          content += `${role}\n\n${msg.content}\n\n---\n\n`
        }
        
        filename += '.md'
        mimeType = 'text/markdown'
    }

    return new NextResponse(content, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Greška pri izvozu' }, { status: 500 })
  }
}
