import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Generate embedding
function generateEmbedding(text: string): string {
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
  return JSON.stringify(embedding)
}

// GET - List documents
export async function GET() {
  try {
    const documents = await db.document.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } }
    })
    return NextResponse.json({ documents })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ documents: [] })
  }
}

// POST - Upload document
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || ''
    
    let content = ''
    let filename = 'text-input'
    let fileType = 'txt'
    let fileSize = 0

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      const text = formData.get('content') as string | null
      
      if (file) {
        filename = file.name
        fileType = file.name.split('.').pop() || 'txt'
        fileSize = file.size
        content = await file.text()
      } else if (text) {
        content = text
        fileSize = Buffer.byteLength(text, 'utf-8')
      }
    } else if (contentType.includes('application/json')) {
      const body = await request.json()
      if (body.content) {
        content = body.content
        fileSize = Buffer.byteLength(content, 'utf-8')
        if (body.filename) filename = body.filename
      }
    }

    if (!content?.trim()) {
      return NextResponse.json({ error: 'Dokument prazan' }, { status: 400 })
    }

    // Chunking
    const chunkSize = 500
    const chunks: { content: string; index: number }[] = []
    const paragraphs = content.split(/\n\n+/)
    let current = ''
    let idx = 0
    
    for (const para of paragraphs) {
      if (current.length + para.length > chunkSize && current.length > 0) {
        chunks.push({ content: current.trim(), index: idx++ })
        current = current.slice(-50) + '\n\n' + para
      } else {
        current += (current ? '\n\n' : '') + para
      }
    }
    if (current.trim()) chunks.push({ content: current.trim(), index: idx })

    // Create document with chunks
    const document = await db.document.create({
      data: {
        filename,
        content,
        fileType,
        fileSize,
        chunkCount: chunks.length,
        chunks: {
          create: chunks.map(c => ({
            content: c.content,
            chunkIndex: c.index,
            embedding: generateEmbedding(c.content)
          }))
        }
      }
    })

    return NextResponse.json({ document })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Greška pri uploadu' }, { status: 500 })
  }
}
