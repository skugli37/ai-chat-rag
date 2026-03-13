// Main Agent Pipeline - Coordinates all agents

import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { AgentContext, QueryAnalysis, RetrievalResult, ReasoningChain, ResponseSynthesis, SelfReflection } from './types'
import { generateEmbedding, cosineSimilarity } from './embeddings'
import { QueryAgent, OrchestratorAgent } from './orchestrator'
import { RetrievalAgent, ReasoningAgent, ResponseAgent, ReflectionAgent } from './retrieval'
import { 
  addToWorkingMemory, 
  getRelevantFromWorkingMemory,
  storeEpisodicMemory,
  retrieveAllMemory,
  updateKnowledgeGraph 
} from './memory'
import { executeTool, selectTools } from '../tools'

// ============ MAIN AGENT PIPELINE ============

export class AgentPipeline {
  private queryAgent: QueryAgent
  private orchestrator: OrchestratorAgent
  private retrievalAgent: RetrievalAgent
  private reasoningAgent: ReasoningAgent
  private responseAgent: ResponseAgent
  private reflectionAgent: ReflectionAgent
  private zai: Awaited<ReturnType<typeof ZAI.create>> | null = null
  
  private agentRunId: string | null = null
  private startTime: number = 0
  
  constructor() {
    this.queryAgent = new QueryAgent()
    this.orchestrator = new OrchestratorAgent()
    this.retrievalAgent = new RetrievalAgent()
    this.reasoningAgent = new ReasoningAgent()
    this.responseAgent = new ResponseAgent()
    this.reflectionAgent = new ReflectionAgent()
  }
  
  async initialize(): Promise<void> {
    this.zai = await ZAI.create()
    await this.queryAgent.initialize()
    await this.orchestrator.initialize()
    await this.reasoningAgent.initialize()
    await this.responseAgent.initialize()
    await this.reflectionAgent.initialize()
  }
  
  // Main execution method
  async execute(context: AgentContext): Promise<{
    response: string
    confidence: number
    citations: { documentId: string; filename: string; content: string; score: number }[]
    reasoning: { conclusion: string; confidence: number }
    reflection: SelfReflection | null
    tokens: number
    duration: number
    agentRunId: string
  }> {
    this.startTime = Date.now()
    let totalTokens = 0
    
    // Create agent run record
    const agentRun = await db.agentRun.create({
      data: {
        conversationId: context.conversationId,
        status: 'running'
      }
    })
    this.agentRunId = agentRun.id
    
    // STEP 1: Query Analysis
    const queryAnalysis = await this.analyzeQuery(context.userQuery)
    totalTokens += 200
    
    await this.recordStep('query', 'analyze', context.userQuery, queryAnalysis, 200)
    
    // Add to working memory
    addToWorkingMemory(context.conversationId, `User: ${context.userQuery}`)
    
    // STEP 2: Tool Execution (if needed)
    const toolsNeeded = selectTools(context.userQuery)
    const toolResults: Record<string, unknown> = {}
    
    for (const tool of toolsNeeded) {
      try {
        const result = await executeTool(tool, { expression: context.userQuery, text: context.userQuery })
        toolResults[tool] = result
        await this.recordStep('query', `tool:${tool}`, { tool }, result, 50)
      } catch (error) {
        console.error(`Tool ${tool} failed:`, error)
      }
    }
    
    // STEP 3: Retrieval (if RAG enabled)
    let retrievalResult: RetrievalResult = { chunks: [], strategy: 'none', totalFound: 0, reranked: false, scores: [] }
    
    if (context.useRag) {
      retrievalResult = await this.retrievalAgent.retrieve(context.userQuery, {
        strategy: 'hybrid',
        topK: 5,
        rerank: true,
        mmrLambda: 0.7
      })
      totalTokens += retrievalResult.chunks.reduce((sum, c) => sum + c.content.split(' ').length, 0)
      
      await this.recordStep('retrieval', 'search', context.userQuery, {
        chunksFound: retrievalResult.totalFound,
        topScores: retrievalResult.scores.slice(0, 3)
      }, 100)
    }
    
    // STEP 4: Memory Retrieval
    const memoryContext = await retrieveAllMemory(
      context.conversationId,
      context.userQuery,
      { workingMemory: true, episodicMemory: true, knowledgeGraph: true, topK: 3 }
    )
    
    // Combine all context
    const allContext = [
      ...retrievalResult.chunks.map(c => c.content),
      ...memoryContext.working,
      ...memoryContext.episodic.map(e => e.content)
    ]
    
    // STEP 5: Reasoning
    const reasoning = await this.reasoningAgent.chainOfThought(
      context.userQuery,
      allContext.slice(0, 5)
    )
    totalTokens += 300
    
    await this.recordStep('reasoning', 'chain_of_thought', context.userQuery, {
      steps: reasoning.thoughts.length,
      conclusion: reasoning.conclusion.slice(0, 100)
    }, 300)
    
    // STEP 6: Response Synthesis
    const response = await this.responseAgent.synthesize(
      context.userQuery,
      reasoning,
      retrievalResult.chunks.map(c => ({
        content: c.content,
        filename: c.filename,
        score: c.score
      })),
      allContext
    )
    totalTokens += 400
    
    await this.recordStep('response', 'synthesize', reasoning.conclusion, {
      confidence: response.confidence,
      citations: response.citedSources.length
    }, 400)
    
    // STEP 7: Self-Reflection (for quality)
    let reflection: SelfReflection | null = null
    
    if (response.confidence < 0.8) {
      const evaluation = await this.reflectionAgent.evaluate(
        context.userQuery,
        response.content,
        allContext
      )
      
      reflection = {
        accuracy: evaluation.accuracy,
        completeness: evaluation.completeness,
        relevance: evaluation.relevance,
        clarity: evaluation.clarity,
        issues: evaluation.issues,
        suggestions: evaluation.suggestions,
        refinedContent: evaluation.shouldRefine 
          ? await this.reflectionAgent.refine(response.content, evaluation)
          : undefined
      }
      
      await this.recordStep('reflection', 'evaluate', response.content.slice(0, 100), reflection, 200)
      totalTokens += 200
    }
    
    const duration = Date.now() - this.startTime
    
    // Update agent run
    await db.agentRun.update({
      where: { id: this.agentRunId },
      data: {
        queryAnalysis: JSON.stringify(queryAnalysis),
        retrievalResults: JSON.stringify(retrievalResult.chunks.slice(0, 3)),
        reasoningChain: JSON.stringify(reasoning),
        finalResponse: JSON.stringify(response),
        totalTokens,
        totalTime: duration,
        selfScore: response.confidence,
        status: 'completed'
      }
    })
    
    // Store in episodic memory
    await storeEpisodicMemory(
      context.conversationId,
      `Q: ${context.userQuery}\nA: ${response.content}`,
      response.confidence
    )
    
    // Update knowledge graph
    await updateKnowledgeGraph(context.conversationId, context.userQuery + ' ' + response.content)
    
    // Add to working memory
    addToWorkingMemory(context.conversationId, `Assistant: ${response.content}`, response.confidence)
    
    return {
      response: response.content,
      confidence: response.confidence,
      citations: retrievalResult.chunks.map(c => ({
        documentId: c.documentId,
        filename: c.filename,
        content: c.content.slice(0, 200),
        score: c.score
      })),
      reasoning: {
        conclusion: reasoning.conclusion,
        confidence: reasoning.confidence
      },
      reflection,
      tokens: totalTokens,
      duration,
      agentRunId: this.agentRunId
    }
  }
  
  // Streaming execution with SSE
  async *executeStream(context: AgentContext): AsyncGenerator<{
    type: 'query' | 'retrieval' | 'reasoning' | 'response' | 'reflection' | 'done'
    data: unknown
  }> {
    this.startTime = Date.now()
    let totalTokens = 0
    
    // Create agent run
    const agentRun = await db.agentRun.create({
      data: {
        conversationId: context.conversationId,
        status: 'running'
      }
    })
    this.agentRunId = agentRun.id
    
    // Yield: Query Analysis
    const queryAnalysis = await this.analyzeQuery(context.userQuery)
    yield { type: 'query', data: queryAnalysis }
    totalTokens += 200
    
    // Yield: Retrieval
    let retrievalResult: RetrievalResult = { chunks: [], strategy: 'none', totalFound: 0, reranked: false, scores: [] }
    
    if (context.useRag) {
      retrievalResult = await this.retrievalAgent.retrieve(context.userQuery, {
        strategy: 'hybrid',
        topK: 5,
        rerank: true
      })
      
      yield { 
        type: 'retrieval', 
        data: {
          chunksFound: retrievalResult.totalFound,
          citations: retrievalResult.chunks.map(c => ({
            filename: c.filename,
            score: c.score
          }))
        }
      }
    }
    
    // Yield: Reasoning
    const allContext = retrievalResult.chunks.map(c => c.content)
    const reasoning = await this.reasoningAgent.chainOfThought(context.userQuery, allContext)
    
    yield {
      type: 'reasoning',
      data: {
        steps: reasoning.thoughts.map(t => ({
          step: t.step,
          reasoning: t.reasoning.slice(0, 100),
          confidence: t.confidence
        })),
        conclusion: reasoning.conclusion
      }
    }
    
    // Yield: Response (streaming from LLM)
    const contextText = allContext.join('\n\n')
    const systemPrompt = context.systemPrompt || 'Ti si korisni AI asistent.'
    
    let fullResponse = ''
    
    try {
      const completion = await this.zai!.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt + `\n\nKontekst:\n${contextText.slice(0, 2000)}` },
          { role: 'user', content: context.userQuery }
        ],
        stream: true,
        temperature: 0.7,
        max_tokens: 1500
      })
      
      for await (const chunk of completion) {
        const content = chunk.choices?.[0]?.delta?.content || ''
        if (content) {
          fullResponse += content
          yield { type: 'response', data: { content, done: false } }
        }
      }
    } catch {
      // Fallback: non-streaming
      const completion = await this.zai!.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: context.userQuery }
        ],
        temperature: 0.7,
        max_tokens: 1500
      })
      
      fullResponse = completion.choices[0]?.message?.content || ''
      yield { type: 'response', data: { content: fullResponse, done: false } }
    }
    
    yield { type: 'response', data: { content: '', done: true } }
    
    // Yield: Done
    const duration = Date.now() - this.startTime
    
    await db.agentRun.update({
      where: { id: this.agentRunId },
      data: {
        queryAnalysis: JSON.stringify(queryAnalysis),
        retrievalResults: JSON.stringify(retrievalResult.chunks.slice(0, 3)),
        finalResponse: fullResponse,
        totalTokens,
        totalTime: duration,
        status: 'completed'
      }
    })
    
    yield { 
      type: 'done', 
      data: { 
        agentRunId: this.agentRunId,
        tokens: totalTokens,
        duration,
        citations: retrievalResult.chunks.map(c => ({
          documentId: c.documentId,
          filename: c.filename,
          content: c.content.slice(0, 150),
          score: c.score
        }))
      } 
    }
  }
  
  private async analyzeQuery(query: string): Promise<QueryAnalysis> {
    return this.queryAgent.analyze(query)
  }
  
  private async recordStep(
    agentName: string,
    action: string,
    input: unknown,
    output: unknown,
    tokens: number
  ): Promise<void> {
    await db.agentStep.create({
      data: {
        agentRunId: this.agentRunId!,
        agentName: agentName as any,
        action,
        input: JSON.stringify(input).slice(0, 1000),
        output: JSON.stringify(output).slice(0, 2000),
        tokens,
        duration: Date.now() - this.startTime,
        success: true
      }
    })
  }
}

// Singleton instance
let pipelineInstance: AgentPipeline | null = null

export async function getPipeline(): Promise<AgentPipeline> {
  if (!pipelineInstance) {
    pipelineInstance = new AgentPipeline()
    await pipelineInstance.initialize()
  }
  return pipelineInstance
}
