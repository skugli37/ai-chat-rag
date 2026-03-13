import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const conversations = await db.conversation.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 50
    })
    
    return NextResponse.json({ conversations })
  } catch (error) {
    console.error('Error fetching conversations:', error)
    return NextResponse.json({ conversations: [] })
  }
}
