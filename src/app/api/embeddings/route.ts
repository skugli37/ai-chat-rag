import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

// Generate embeddings using z-ai-web-dev-sdk
export async function POST(request: NextRequest) {
  try {
    const { texts } = await request.json()
    
    if (!texts || !Array.isArray(texts)) {
      return NextResponse.json({ error: 'Polje texts je obavezno' }, { status: 400 })
    }

    const zai = await ZAI.create()
    
    const embeddings: number[][] = []
    
    for (const text of texts) {
      try {
        const response = await zai.embeddings.create({
          input: text,
        })
        
        if (response.data && response.data[0]?.embedding) {
          embeddings.push(response.data[0].embedding)
        } else {
          embeddings.push(generateSimpleEmbedding(text))
        }
      } catch {
        embeddings.push(generateSimpleEmbedding(text))
      }
    }

    return NextResponse.json({ embeddings })
  } catch (error) {
    console.error('Embedding error:', error)
    return NextResponse.json({ error: 'Greška pri generisanju embeddinga' }, { status: 500 })
  }
}

// Fallback: TF-based embedding (384 dimensions)
function generateSimpleEmbedding(text: string): number[] {
  const dimension = 384
  const embedding = new Array(dimension).fill(0)
  
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  
  for (const word of words) {
    let hash = 0
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i)
      hash = hash & hash
    }
    
    for (let i = 0; i < 5; i++) {
      const idx = Math.abs((hash + i * 77) % dimension)
      embedding[idx] += 1 / (1 + i)
    }
  }
  
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0))
  if (norm > 0) {
    for (let i = 0; i < dimension; i++) {
      embedding[i] /= norm
    }
  }
  
  return embedding
}
