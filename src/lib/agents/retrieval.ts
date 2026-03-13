// Retrieval Agent - Multi-strategy document retrieval with reranking

import { db } from '@/lib/db'
import ZAI from 'z-ai-web-dev-sdk'
import { 
  generateEmbedding, 
  cosineSimilarity, 
  bm25Score, 
  hybridScore,
  mmr 
} from './embeddings'
import { RetrievedChunk, RetrievalResult } from './types'

// ============ RETRIEVAL AGENT ============

export class RetrievalAgent {
  
  // Main retrieval method with multiple strategies
  async retrieve(
    query: string,
    options: {
      strategy?: 'semantic' | 'keyword' | 'hybrid'
      topK?: number
      rerank?: boolean
      mmrLambda?: number
      conversationId?: string
    } = {}
  ): Promise<RetrievalResult> {
    const {
      strategy = 'hybrid',
      topK = 10,
      rerank = true,
      mmrLambda = 0.7,
      conversationId
    } = options
    
    // Get all chunks with documents
    const chunks = await db.documentChunk.findMany({
      include: { document: true },
      take: 500 // Limit for performance
    })
    
    if (chunks.length === 0) {
      return {
        chunks: [],
        strategy,
        totalFound: 0,
        reranked: false,
        scores: []
      }
    }
    
    // Calculate avg doc length for BM25
    const avgDocLength = chunks.reduce((sum, c) => 
      sum + c.content.split(/\s+/).length, 0) / chunks.length
    
    // Score chunks based on strategy
    const queryEmbedding = generateEmbedding(query)
    
    const scored = chunks.map(chunk => {
      // Get chunk embedding
      let chunkEmbedding: number[] = []
      if (chunk.embedding) {
        try {
          chunkEmbedding = JSON.parse(chunk.embedding)
        } catch {
          chunkEmbedding = generateEmbedding(chunk.content)
        }
      } else {
        chunkEmbedding = generateEmbedding(chunk.content)
      }
      
      // Semantic score
      const semanticScore = cosineSimilarity(queryEmbedding, chunkEmbedding)
      
      // Keyword score (BM25)
      const keywordScore = bm25Score(query, chunk.content, avgDocLength)
      
      // Combined score
      let score: number
      switch (strategy) {
        case 'semantic':
          score = semanticScore
          break
        case 'keyword':
          score = keywordScore / 10
          break
        case 'hybrid':
        default:
          score = hybridScore(semanticScore, keywordScore)
      }
      
      return {
        id: chunk.id,
        content: chunk.content,
        documentId: chunk.documentId,
        filename: chunk.document.filename,
        score,
        semanticScore,
        keywordScore,
        embedding: chunkEmbedding
      }
    })
    
    // Sort by score
    scored.sort((a, b) => b.score - a.score)
    
    // Apply MMR for diversity if requested
    let selected: typeof scored
    if (mmrLambda < 1) {
      const embeddings = scored.map(c => c.embedding)
      const indices = mmr(queryEmbedding, embeddings, mmrLambda, topK * 2)
      selected = indices.map(i => scored[i])
    } else {
      selected = scored.slice(0, topK * 2)
    }
    
    // Rerank if requested
    let final = selected.slice(0, topK)
    let wasReranked = false
    
    if (rerank && final.length > 0) {
      final = await this.rerank(query, final)
      wasReranked = true
    }
    
    return {
      chunks: final.map(c => ({
        id: c.id,
        content: c.content,
        documentId: c.documentId,
        filename: c.filename,
        score: c.score,
        semanticScore: c.semanticScore,
        keywordScore: c.keywordScore
      })),
      strategy,
      totalFound: scored.length,
      reranked: wasReranked,
      scores: final.map(c => c.score)
    }
  }
  
  // Cross-encoder style reranking using LLM
  private async rerank(
    query: string,
    chunks: (RetrievedChunk & { embedding: number[] })[]
  ): Promise<typeof chunks> {
    // For each chunk, calculate a reranking score
    // In production, this would use a cross-encoder model
    // Here we use a combination of factors
    
    const reranked = chunks.map(chunk => {
      let rerankScore = chunk.score
      
      // Boost for exact phrase match
      const queryLower = query.toLowerCase()
      const contentLower = chunk.content.toLowerCase()
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 3)
      
      let exactMatchBoost = 0
      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          exactMatchBoost += 0.05
        }
      }
      
      // Boost for proximity of query terms
      const positions: number[] = []
      for (const word of queryWords) {
        const idx = contentLower.indexOf(word)
        if (idx >= 0) positions.push(idx)
      }
      
      let proximityBoost = 0
      if (positions.length > 1) {
        const maxDist = Math.max(...positions) - Math.min(...positions)
        proximityBoost = Math.max(0, 0.1 - maxDist / 1000)
      }
      
      // Final rerank score
      rerankScore = rerankScore * 0.7 + (exactMatchBoost + proximityBoost) * 0.3
      
      return {
        ...chunk,
        score: rerankScore
      }
    })
    
    // Re-sort after reranking
    reranked.sort((a, b) => b.score - a.score)
    
    return reranked
  }
  
  // Retrieve by document ID
  async retrieveByDocument(
    documentId: string,
    query: string,
    topK: number = 5
  ): Promise<RetrievedChunk[]> {
    const chunks = await db.documentChunk.findMany({
      where: { documentId },
      include: { document: true }
    })
    
    if (chunks.length === 0) return []
    
    const queryEmbedding = generateEmbedding(query)
    
    const scored = chunks.map(chunk => {
      let embedding: number[] = []
      if (chunk.embedding) {
        try {
          embedding = JSON.parse(chunk.embedding)
        } catch {
          embedding = generateEmbedding(chunk.content)
        }
      }
      
      return {
        id: chunk.id,
        content: chunk.content,
        documentId: chunk.documentId,
        filename: chunk.document.filename,
        score: cosineSimilarity(queryEmbedding, embedding),
        semanticScore: cosineSimilarity(queryEmbedding, embedding),
        keywordScore: 0
      }
    })
    
    scored.sort((a, b) => b.score - a.score)
    
    return scored.slice(0, topK)
  }
  
  // Get chunk context (surrounding chunks)
  async getChunkContext(
    chunkId: string,
    contextSize: number = 1
  ): Promise<{ before: string; current: string; after: string }> {
    const chunk = await db.documentChunk.findUnique({
      where: { id: chunkId }
    })
    
    if (!chunk) {
      return { before: '', current: '', after: '' }
    }
    
    const beforeChunks = await db.documentChunk.findMany({
      where: {
        documentId: chunk.documentId,
        chunkIndex: { gte: chunk.chunkIndex - contextSize, lt: chunk.chunkIndex }
      },
      orderBy: { chunkIndex: 'asc' }
    })
    
    const afterChunks = await db.documentChunk.findMany({
      where: {
        documentId: chunk.documentId,
        chunkIndex: { gt: chunk.chunkIndex, lte: chunk.chunkIndex + contextSize }
      },
      orderBy: { chunkIndex: 'asc' }
    })
    
    return {
      before: beforeChunks.map(c => c.content).join('\n\n'),
      current: chunk.content,
      after: afterChunks.map(c => c.content).join('\n\n')
    }
  }
}

// ============ REASONING AGENT ============

export class ReasoningAgent {
  private zai: Awaited<ReturnType<typeof ZAI.create>> | null = null
  
  async initialize(): Promise<void> {
    this.zai = await ZAI.create()
  }
  
  // Chain-of-thought reasoning
  async chainOfThought(
    query: string,
    context: string[],
    maxSteps: number = 5
  ): Promise<{
    thoughts: { step: number; reasoning: string; evidence: string[]; confidence: number }[]
    conclusion: string
    confidence: number
  }> {
    const contextText = context.join('\n\n---\n\n')
    
    const prompt = `You are a reasoning agent. Given a query and context, think through the answer step by step.

Query: ${query}

Context:
${contextText}

Think through this step by step. For each step:
1. State your reasoning
2. Cite specific evidence from the context (if any)
3. Indicate your confidence in this step (0-1)

Format your response as JSON:
{
  "thoughts": [
    {
      "step": 1,
      "reasoning": "First, I need to understand...",
      "evidence": ["specific quote from context"],
      "confidence": 0.8
    },
    ...
  ],
  "conclusion": "Based on my reasoning, the answer is...",
  "confidence": 0.85
}`

    const completion = await this.zai!.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1500
    })

    const response = completion.choices[0]?.message?.content || '{}'
    
    try {
      const parsed = JSON.parse(response)
      return {
        thoughts: parsed.thoughts || [],
        conclusion: parsed.conclusion || '',
        confidence: parsed.confidence || 0.5
      }
    } catch {
      // Fallback: simple reasoning
      return {
        thoughts: [{
          step: 1,
          reasoning: 'Analyzing the query and available context',
          evidence: context.slice(0, 2),
          confidence: 0.6
        }],
        conclusion: response,
        confidence: 0.6
      }
    }
  }
  
  // Verify reasoning by checking for contradictions
  async verify(
    conclusion: string,
    context: string[]
  ): Promise<{
    valid: boolean
    issues: string[]
    corrections: string[]
    confidence: number
  }> {
    const contextText = context.join('\n\n')
    
    const prompt = `Verify this conclusion against the provided context. Check for:
1. Factual accuracy
2. Logical consistency
3. Missing information
4. Contradictions

Conclusion: ${conclusion}

Context:
${contextText}

Respond in JSON:
{
  "valid": true/false,
  "issues": ["issue 1", "issue 2"],
  "corrections": ["correction 1", "correction 2"],
  "confidence": 0.0-1.0
}`

    const completion = await this.zai!.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 500
    })

    const response = completion.choices[0]?.message?.content || '{}'
    
    try {
      return JSON.parse(response)
    } catch {
      return {
        valid: true,
        issues: [],
        corrections: [],
        confidence: 0.5
      }
    }
  }
  
  // Self-reflection on reasoning quality
  async reflect(
    thoughts: { reasoning: string; confidence: number }[],
    conclusion: string
  ): Promise<{
    accuracy: number
    completeness: number
    clarity: number
    suggestions: string[]
  }> {
    const thoughtsText = thoughts.map((t, i) => 
      `Step ${i + 1}: ${t.reasoning} (confidence: ${t.confidence})`
    ).join('\n')
    
    const prompt = `Reflect on this reasoning chain and conclusion. Evaluate:

Reasoning Chain:
${thoughtsText}

Conclusion: ${conclusion}

Provide scores (0-1) and improvement suggestions in JSON:
{
  "accuracy": 0.0-1.0,
  "completeness": 0.0-1.0,
  "clarity": 0.0-1.0,
  "suggestions": ["suggestion 1", "suggestion 2"]
}`

    const completion = await this.zai!.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 400
    })

    const response = completion.choices[0]?.message?.content || '{}'
    
    try {
      return JSON.parse(response)
    } catch {
      return {
        accuracy: 0.5,
        completeness: 0.5,
        clarity: 0.5,
        suggestions: []
      }
    }
  }
}

// ============ RESPONSE AGENT ============

export class ResponseAgent {
  private zai: Awaited<ReturnType<typeof ZAI.create>> | null = null
  
  async initialize(): Promise<void> {
    this.zai = await ZAI.create()
  }
  
  // Synthesize final response from reasoning
  async synthesize(
    query: string,
    reasoning: { conclusion: string; confidence: number },
    citations: { content: string; filename: string; score: number }[],
    context: string[],
    options: { format?: 'markdown' | 'plain'; maxLength?: number } = {}
  ): Promise<{
    content: string
    confidence: number
    citedSources: string[]
    needsRefinement: boolean
  }> {
    const { format = 'markdown', maxLength = 2000 } = options
    
    const citationsText = citations.map((c, i) => 
      `[${i + 1}] ${c.filename}: "${c.content.slice(0, 100)}..." (relevance: ${(c.score * 100).toFixed(0)}%)`
    ).join('\n')
    
    const prompt = `Based on the reasoning and evidence, provide a comprehensive answer to the query.

Query: ${query}

Reasoning Conclusion: ${reasoning.conclusion}
Reasoning Confidence: ${reasoning.confidence}

Evidence Citations:
${citationsText}

Additional Context:
${context.slice(0, 3).join('\n\n').slice(0, 1500)}

Requirements:
1. Provide a direct, complete answer
2. Use citations [1], [2], etc. when referencing evidence
3. Be accurate and honest about uncertainty
4. Format in ${format}
5. Stay under ${maxLength} characters

Response:`

    const completion = await this.zai!.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 1000
    })

    const response = completion.choices[0]?.message?.content || ''
    
    return {
      content: response,
      confidence: reasoning.confidence,
      citedSources: citations.map(c => c.filename),
      needsRefinement: reasoning.confidence < 0.6
    }
  }
  
  // Generate citations with proper formatting
  formatCitations(
    citations: { documentId: string; filename: string; content: string; score: number }[]
  ): { number: number; filename: string; excerpt: string; relevance: string }[] {
    return citations.map((c, i) => ({
      number: i + 1,
      filename: c.filename,
      excerpt: c.content.slice(0, 150) + (c.content.length > 150 ? '...' : ''),
      relevance: `${(c.score * 100).toFixed(0)}%`
    }))
  }
}

// ============ REFLECTION AGENT ============

export class ReflectionAgent {
  private zai: Awaited<ReturnType<typeof ZAI.create>> | null = null
  
  async initialize(): Promise<void> {
    this.zai = await ZAI.create()
  }
  
  // Evaluate response quality
  async evaluate(
    query: string,
    response: string,
    context: string[]
  ): Promise<{
    accuracy: number
    completeness: number
    relevance: number
    clarity: number
    overall: number
    issues: string[]
    suggestions: string[]
    shouldRefine: boolean
  }> {
    const prompt = `Evaluate this AI response quality.

Original Query: ${query}

AI Response: ${response}

Context Used:
${context.slice(0, 500)}...

Score each dimension (0-1) and identify issues:
{
  "accuracy": 0.0-1.0,
  "completeness": 0.0-1.0,
  "relevance": 0.0-1.0,
  "clarity": 0.0-1.0,
  "issues": ["issue 1", "issue 2"],
  "suggestions": ["improvement 1", "improvement 2"]
}`

    const completion = await this.zai!.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 500
    })

    const result = completion.choices[0]?.message?.content || '{}'
    
    try {
      const parsed = JSON.parse(result)
      const overall = (parsed.accuracy + parsed.completeness + parsed.relevance + parsed.clarity) / 4
      
      return {
        ...parsed,
        overall,
        shouldRefine: overall < 0.6
      }
    } catch {
      return {
        accuracy: 0.5,
        completeness: 0.5,
        relevance: 0.5,
        clarity: 0.5,
        overall: 0.5,
        issues: [],
        suggestions: [],
        shouldRefine: false
      }
    }
  }
  
  // Refine response based on evaluation
  async refine(
    originalResponse: string,
    evaluation: { issues: string[]; suggestions: string[] }
  ): Promise<string> {
    const prompt = `Improve this response based on the identified issues.

Original Response: ${originalResponse}

Issues: ${evaluation.issues.join(', ')}
Suggestions: ${evaluation.suggestions.join(', ')}

Provide an improved response that addresses these issues:`

    const completion = await this.zai!.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 1000
    })

    return completion.choices[0]?.message?.content || originalResponse
  }
}
