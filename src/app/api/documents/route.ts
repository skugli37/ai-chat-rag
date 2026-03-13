import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - List all documents
export async function GET() {
  try {
    const documents = await db.document.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { chunks: true }
        }
      }
    })
    
    return NextResponse.json({ documents })
  } catch (error) {
    console.error('Error fetching documents:', error)
    return NextResponse.json({ error: 'Greška pri dohvatanju dokumenata' }, { status: 500 })
  }
}

// POST - Upload new document
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || ''
    
    let documentContent = ''
    let filename = 'text-input'
    let fileType = 'txt'
    let fileSize = 0

    if (contentType.includes('multipart/form-data')) {
      // Handle FormData
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      const content = formData.get('content') as string | null
      
      if (file) {
        filename = file.name
        fileType = file.name.split('.').pop() || 'txt'
        fileSize = file.size
        documentContent = await file.text()
      } else if (content) {
        documentContent = content
        fileSize = Buffer.byteLength(content, 'utf-8')
      } else {
        return NextResponse.json({ error: 'Fajl ili sadržaj je potreban' }, { status: 400 })
      }
    } else if (contentType.includes('application/json')) {
      // Handle JSON
      const body = await request.json()
      if (body.content) {
        documentContent = body.content
        fileSize = Buffer.byteLength(documentContent, 'utf-8')
        if (body.filename) filename = body.filename
      } else {
        return NextResponse.json({ error: 'Polje content je potrebno' }, { status: 400 })
      }
    } else {
      return NextResponse.json({ error: 'Nepodržan content-type' }, { status: 400 })
    }

    if (!documentContent.trim()) {
      return NextResponse.json({ error: 'Dokument je prazan' }, { status: 400 })
    }

    // Chunk the content
    const chunkSize = 500
    const overlap = 50
    const chunks: string[] = []
    let start = 0
    
    while (start < documentContent.length) {
      const end = start + chunkSize
      chunks.push(documentContent.slice(start, end))
      start += chunkSize - overlap
    }

    // Create document with chunks
    const document = await db.document.create({
      data: {
        filename,
        content: documentContent,
        fileType,
        fileSize,
        chunkCount: chunks.length,
        chunks: {
          create: chunks.map((chunkContent, index) => ({
            content: chunkContent,
            chunkIndex: index
          }))
        }
      },
      include: {
        chunks: true
      }
    })

    return NextResponse.json({ document })
  } catch (error) {
    console.error('Error uploading document:', error)
    return NextResponse.json({ error: 'Greška pri uploadu dokumenta' }, { status: 500 })
  }
}
