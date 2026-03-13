import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get single document
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const document = await db.document.findUnique({
      where: { id },
      include: {
        chunks: {
          orderBy: { chunkIndex: 'asc' }
        }
      }
    })
    
    if (!document) {
      return NextResponse.json({ error: 'Dokument nije pronađen' }, { status: 404 })
    }
    
    return NextResponse.json({ document })
  } catch (error) {
    console.error('Error fetching document:', error)
    return NextResponse.json({ error: 'Greška pri dohvatanju dokumenta' }, { status: 500 })
  }
}

// DELETE - Delete document
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await db.document.delete({
      where: { id }
    })
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting document:', error)
    return NextResponse.json({ error: 'Greška pri brisanju dokumenta' }, { status: 500 })
  }
}
