import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET agent run details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    const agentRun = await db.agentRun.findUnique({
      where: { id },
      include: {
        agentSteps: {
          orderBy: { createdAt: 'asc' }
        }
      }
    })
    
    if (!agentRun) {
      return NextResponse.json({ error: 'Agent run not found' }, { status: 404 })
    }
    
    return NextResponse.json({ agentRun })
  } catch (error) {
    console.error('Error fetching agent run:', error)
    return NextResponse.json({ error: 'Greška pri dohvatanju' }, { status: 500 })
  }
}
