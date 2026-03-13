// Orchestrator Agent - Coordinates all agents and manages workflow

import { db } from '@/lib/db'
import ZAI from 'z-ai-web-dev-sdk'
import { 
  AgentName, AgentStatus, AgentStep, OrchestrationPlan, 
  AgentContext, AgentResponse 
} from './types'
import { selectTools } from '../tools'
import { 
  addToWorkingMemory, 
  getRelevantFromWorkingMemory,
  storeEpisodicMemory,
  retrieveAllMemory,
  updateKnowledgeGraph
} from './memory'

// ============ ORCHESTRATOR AGENT ============

export class OrchestratorAgent {
  private zai: Awaited<ReturnType<typeof ZAI.create>> | null = null
  private agentRunId: string | null = null
  private startTime: number = 0
  
  async initialize(): Promise<void> {
    this.zai = await ZAI.create()
  }
  
  // Plan the orchestration based on query complexity
  async plan(context: AgentContext): Promise<OrchestrationPlan> {
    const complexity = await this.analyzeComplexity(context.userQuery)
    const tools = selectTools(context.userQuery)
    
    let strategy: OrchestrationPlan['strategy']
    let steps: OrchestrationPlan['steps']
    
    if (complexity < 0.3) {
      // Simple query - quick path
      strategy = 'quick'
      steps = [
        { agent: 'query', action: 'analyze', dependencies: [], parallel: false },
        { agent: 'response', action: 'synthesize', dependencies: ['query'], parallel: false }
      ]
    } else if (complexity > 0.7) {
      // Complex query - comprehensive analysis
      strategy = 'comprehensive'
      steps = [
        { agent: 'query', action: 'analyze', dependencies: [], parallel: false },
        { agent: 'query', action: 'decompose', dependencies: ['query'], parallel: false },
        { agent: 'retrieval', action: 'search', dependencies: ['query'], parallel: true },
        { agent: 'reasoning', action: 'chain_of_thought', dependencies: ['retrieval'], parallel: false },
        { agent: 'reasoning', action: 'verify', dependencies: ['reasoning'], parallel: false },
        { agent: 'response', action: 'synthesize', dependencies: ['reasoning'], parallel: false },
        { agent: 'reflection', action: 'evaluate', dependencies: ['response'], parallel: false }
      ]
    } else {
      // Standard query
      strategy = 'standard'
      steps = [
        { agent: 'query', action: 'analyze', dependencies: [], parallel: false },
        { agent: 'retrieval', action: 'search', dependencies: ['query'], parallel: false },
        { agent: 'reasoning', action: 'reason', dependencies: ['retrieval'], parallel: false },
        { agent: 'response', action: 'synthesize', dependencies: ['reasoning'], parallel: false }
      ]
    }
    
    // Add tools if needed
    for (const tool of tools) {
      steps.splice(1, 0, {
        agent: 'query',
        action: `tool:${tool}`,
        dependencies: [],
        parallel: true
      })
    }
    
    return {
      steps,
      currentStep: 0,
      totalSteps: steps.length,
      estimatedTokens: steps.length * 500,
      strategy
    }
  }
  
  private async analyzeComplexity(query: string): Promise<number> {
    // Heuristic complexity analysis
    let score = 0
    
    // Length
    if (query.length > 100) score += 0.2
    if (query.length > 200) score += 0.1
    
    // Questions
    const questionCount = (query.match(/\?/g) || []).length
    score += Math.min(questionCount * 0.15, 0.3)
    
    // Logical operators
    if (/and|or|but|however|although|because|therefore|thus|if|then/i.test(query)) {
      score += 0.15
    }
    
    // Multiple concepts
    const conceptIndicators = ['compare', 'contrast', 'analyze', 'evaluate', 'explain', 'describe']
    for (const indicator of conceptIndicators) {
      if (query.toLowerCase().includes(indicator)) {
        score += 0.1
      }
    }
    
    // Technical terms
    if (/\b(api|algorithm|function|method|class|database|query|code|implement)\b/i.test(query)) {
      score += 0.1
    }
    
    return Math.min(score, 1)
  }
  
  // Create agent run record
  async createRun(conversationId: string, plan: OrchestrationPlan): Promise<string> {
    this.startTime = Date.now()
    
    const run = await db.agentRun.create({
      data: {
        conversationId,
        orchestratorPlan: JSON.stringify(plan),
        status: 'running'
      }
    })
    
    this.agentRunId = run.id
    return run.id
  }
  
  // Execute orchestration plan
  async execute(
    context: AgentContext,
    plan: OrchestrationPlan,
    agents: Map<AgentName, unknown>
  ): Promise<string> {
    const results: Map<string, unknown> = new Map()
    let currentTokens = 0
    
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]
      
      // Check dependencies
      for (const dep of step.dependencies) {
        if (!results.has(dep)) {
          console.warn(`Dependency ${dep} not satisfied for step ${step}`)
        }
      }
      
      // Record step start
      const stepStart = Date.now()
      
      try {
        // Get agent and execute
        const agent = agents.get(step.agent)
        if (!agent) throw new Error(`Agent ${step.agent} not found`)
        
        // Execute step (simplified - actual execution would call agent methods)
        const result = await this.executeStep(step, context, results, agent)
        
        // Record result
        const stepEnd = Date.now()
        results.set(`${step.agent}:${step.action}`, result)
        
        // Record in database
        await db.agentStep.create({
          data: {
            agentRunId: this.agentRunId!,
            agentName: step.agent,
            action: step.action,
            input: JSON.stringify(context),
            output: JSON.stringify(result),
            tokens: result.tokens || 0,
            duration: stepEnd - stepStart,
            confidence: result.confidence,
            success: true
          }
        })
        
        currentTokens += result.tokens || 0
        
        // Update working memory
        if (result.data) {
          addToWorkingMemory(context.conversationId, JSON.stringify(result.data))
        }
        
      } catch (error) {
        // Record failure
        await db.agentStep.create({
          data: {
            agentRunId: this.agentRunId!,
            agentName: step.agent,
            action: step.action,
            input: JSON.stringify(context),
            tokens: 0,
            duration: Date.now() - stepStart,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        })
        
        // Continue with fallback
        console.error(`Step ${step.agent}:${step.action} failed:`, error)
      }
    }
    
    // Update run record
    await db.agentRun.update({
      where: { id: this.agentRunId! },
      data: {
        totalTokens: currentTokens,
        totalTime: Date.now() - this.startTime,
        status: 'completed'
      }
    })
    
    // Get final response
    const finalResult = results.get('response:synthesize') as { data?: { content: string } } | undefined
    return finalResult?.data?.content || 'I apologize, but I was unable to generate a response.'
  }
  
  private async executeStep(
    step: OrchestrationPlan['steps'][0],
    context: AgentContext,
    results: Map<string, unknown>,
    agent: unknown
  ): Promise<AgentResponse<unknown>> {
    const start = Date.now()
    
    // This would call the actual agent method
    // For now, return a placeholder
    return {
      success: true,
      data: { step: step.action, completed: true },
      tokens: 100,
      duration: Date.now() - start,
      confidence: 0.8
    }
  }
  
  // Self-reflection: evaluate overall run quality
  async evaluate(): Promise<{
    score: number
    issues: string[]
    suggestions: string[]
    needsRefinement: boolean
  }> {
    if (!this.agentRunId) {
      return { score: 0, issues: [], suggestions: [], needsRefinement: false }
    }
    
    const steps = await db.agentStep.findMany({
      where: { agentRunId: this.agentRunId }
    })
    
    const issues: string[] = []
    const suggestions: string[] = []
    let totalConfidence = 0
    
    for (const step of steps) {
      if (!step.success) {
        issues.push(`Step ${step.agentName}:${step.action} failed`)
        suggestions.push(`Retry ${step.agentName} agent with different parameters`)
      }
      
      if (step.confidence !== null && step.confidence < 0.5) {
        issues.push(`Low confidence in ${step.agentName}: ${step.confidence}`)
        suggestions.push(`Consider additional retrieval or reasoning`)
      }
      
      totalConfidence += step.confidence || 0.5
    }
    
    const avgConfidence = steps.length > 0 ? totalConfidence / steps.length : 0.5
    const needsRefinement = avgConfidence < 0.6 || issues.length > 1
    
    // Update run
    await db.agentRun.update({
      where: { id: this.agentRunId },
      data: {
        selfScore: avgConfidence,
        needsRefinement,
        refinementCount: needsRefinement ? 1 : 0
      }
    })
    
    return {
      score: avgConfidence,
      issues,
      suggestions,
      needsRefinement
    }
  }
}

// ============ QUERY AGENT ============

export class QueryAgent {
  private zai: Awaited<ReturnType<typeof ZAI.create>> | null = null
  
  async initialize(): Promise<void> {
    this.zai = await ZAI.create()
  }
  
  // Analyze query intent and extract entities
  async analyze(query: string): Promise<{
    intent: string
    entities: { text: string; type: string; confidence: number }[]
    rewritten: string[]
    expanded: string[]
    complexity: number
  }> {
    const prompt = `Analyze this user query and provide:
1. Intent classification (question, command, request, statement)
2. Key entities (names, places, concepts, technical terms)
3. Query rewriting for better retrieval (2-3 alternative phrasings)
4. Query expansion with related terms

Query: "${query}"

Respond in JSON format:
{
  "intent": "question|command|request|statement",
  "entities": [{"text": "...", "type": "...", "confidence": 0.0-1.0}],
  "rewritten": ["...", "..."],
  "expanded": ["...", "..."]
}`

    const completion = await this.zai!.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500
    })

    const response = completion.choices[0]?.message?.content || '{}'
    
    try {
      const parsed = JSON.parse(response)
      return {
        intent: parsed.intent || 'question',
        entities: parsed.entities || [],
        rewritten: parsed.rewritten || [query],
        expanded: parsed.expanded || [],
        complexity: this.calculateComplexity(query, parsed.entities?.length || 0)
      }
    } catch {
      return {
        intent: 'question',
        entities: [],
        rewritten: [query],
        expanded: [],
        complexity: 0.5
      }
    }
  }
  
  // Decompose complex query into sub-queries
  async decompose(query: string): Promise<string[]> {
    const prompt = `Break down this complex question into simpler sub-questions that can be answered independently:

Question: "${query}"

Return a JSON array of sub-questions. If the question is already simple, return it as a single-element array.
Example: ["sub-question 1", "sub-question 2", ...]`

    const completion = await this.zai!.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 300
    })

    const response = completion.choices[0]?.message?.content || '[]'
    
    try {
      const parsed = JSON.parse(response)
      return Array.isArray(parsed) ? parsed : [query]
    } catch {
      return [query]
    }
  }
  
  private calculateComplexity(query: string, entityCount: number): number {
    let score = 0
    
    // Word count factor
    const words = query.split(/\s+/).length
    score += Math.min(words / 50, 0.3)
    
    // Entity count
    score += Math.min(entityCount / 5, 0.2)
    
    // Question marks
    score += Math.min((query.match(/\?/g) || []).length * 0.1, 0.2)
    
    // Logical connectors
    if (/\b(and|or|but|however|although|because)\b/i.test(query)) {
      score += 0.15
    }
    
    // Multiple clauses
    if (/,/.test(query) || /\band\b|\bor\b/i.test(query)) {
      score += 0.15
    }
    
    return Math.min(score, 1)
  }
}
