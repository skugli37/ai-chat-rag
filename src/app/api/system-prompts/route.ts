import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - List all system prompts
export async function GET() {
  try {
    const prompts = await db.systemPrompt.findMany({
      orderBy: { createdAt: 'desc' }
    })
    
    // Create default prompt if none exist
    if (prompts.length === 0) {
      const defaultPrompt = await db.systemPrompt.create({
        data: {
          name: 'Podrazumevani',
          content: 'Ti si korisni AI asistent. Odgovaraj precizno, koncizno i na jeziku korisnika. Koristi markdown formatiranje kada je appropriate.',
          isDefault: true
        }
      })
      return NextResponse.json({ prompts: [defaultPrompt] })
    }
    
    return NextResponse.json({ prompts })
  } catch (error) {
    console.error('Error fetching system prompts:', error)
    return NextResponse.json({ error: 'Greška pri dohvatanju system promptova' }, { status: 500 })
  }
}

// POST - Create new system prompt
export async function POST(request: NextRequest) {
  try {
    const { name, content, isDefault } = await request.json()
    
    if (!name || !content) {
      return NextResponse.json({ error: 'Ime i sadržaj su potrebni' }, { status: 400 })
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await db.systemPrompt.updateMany({
        where: { isDefault: true },
        data: { isDefault: false }
      })
    }

    const prompt = await db.systemPrompt.create({
      data: {
        name,
        content,
        isDefault: isDefault || false
      }
    })

    return NextResponse.json({ prompt })
  } catch (error) {
    console.error('Error creating system prompt:', error)
    return NextResponse.json({ error: 'Greška pri kreiranju system prompta' }, { status: 500 })
  }
}
