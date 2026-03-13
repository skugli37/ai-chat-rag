// Memory Systems - Working, Episodic, and Semantic Memory

import { db } from '@/lib/db'
import { generateEmbedding, cosineSimilarity } from './embeddings'

// ============ WORKING MEMORY ============
// Short-term context with decay

interface WorkingMemoryItem {
  id: string
  content: string
  embedding: number[]
  importance: number
  accessCount: number
  lastAccessed: Date
  createdAt: Date
}

const workingMemory = new Map<string, WorkingMemoryItem>()
const MAX_WORKING_MEMORY = 50
const DECAY_RATE = 0.1

export function addToWorkingMemory(
  conversationId: string,
  content: string,
  importance: number = 0.5
): void {
  const id = `${conversationId}-${Date.now()}`
  const embedding = generateEmbedding(content)
  
  workingMemory.set(id, {
    id,
    content,
    embedding,
    importance,
    accessCount: 1,
    lastAccessed: new Date(),
    createdAt: new Date()
  })
  
  // Cleanup old items
  if (workingMemory.size > MAX_WORKING_MEMORY) {
    cleanupWorkingMemory()
  }
}

export function getRelevantFromWorkingMemory(
  query: string,
  topK: number = 5
): string[] {
  const queryEmbedding = generateEmbedding(query)
  
  const scored = Array.from(workingMemory.values()).map(item => {
    // Apply decay
    const age = (Date.now() - item.createdAt.getTime()) / 1000 / 60 // minutes
    const decay = Math.exp(-DECAY_RATE * age)
    const accessBoost = Math.log(1 + item.accessCount)
    
    const similarity = cosineSimilarity(queryEmbedding, item.embedding)
    const score = similarity * decay * accessBoost * item.importance
    
    return { item, score }
  })
  
  scored.sort((a, b) => b.score - a.score)
  
  // Update access count for retrieved items
  for (const { item } of scored.slice(0, topK)) {
    item.accessCount++
    item.lastAccessed = new Date()
  }
  
  return scored.slice(0, topK).map(s => s.item.content)
}

function cleanupWorkingMemory(): void {
  const now = Date.now()
  const items = Array.from(workingMemory.entries())
  
  // Remove oldest and least accessed
  items.sort((a, b) => {
    const scoreA = a[1].importance * Math.log(1 + a[1].accessCount) / (1 + (now - a[1].createdAt.getTime()) / 1000 / 60)
    const scoreB = b[1].importance * Math.log(1 + b[1].accessCount) / (1 + (now - b[1].createdAt.getTime()) / 1000 / 60)
    return scoreB - scoreA
  })
  
  // Keep top items
  const toKeep = new Set(items.slice(0, MAX_WORKING_MEMORY * 0.8).map(i => i[0]))
  for (const [key] of workingMemory) {
    if (!toKeep.has(key)) {
      workingMemory.delete(key)
    }
  }
}

// ============ EPISODIC MEMORY ============
// Long-term conversation memory stored in database

export async function storeEpisodicMemory(
  conversationId: string,
  content: string,
  importance: number = 0.5
): Promise<void> {
  const embedding = generateEmbedding(content)
  
  await db.memory.create({
    data: {
      conversationId,
      type: 'episodic',
      content,
      importance,
      embedding: JSON.stringify(embedding),
      summary: content.slice(0, 200) + (content.length > 200 ? '...' : '')
    }
  })
}

export async function retrieveEpisodicMemory(
  conversationId: string,
  query: string,
  topK: number = 5
): Promise<{ content: string; importance: number }[]> {
  const queryEmbedding = generateEmbedding(query)
  
  const memories = await db.memory.findMany({
    where: {
      conversationId,
      type: 'episodic'
    },
    take: 100
  })
  
  const scored = memories.map(m => {
    let embedding: number[] = []
    if (m.embedding) {
      try {
        embedding = JSON.parse(m.embedding)
      } catch {}
    }
    
    const similarity = embedding.length > 0 
      ? cosineSimilarity(queryEmbedding, embedding)
      : 0
    
    return {
      content: m.content,
      importance: m.importance,
      score: similarity * m.importance
    }
  })
  
  scored.sort((a, b) => b.score - a.score)
  
  // Update access for retrieved
  // (In production, you'd update lastAccessed and accessCount)
  
  return scored.slice(0, topK)
}

// ============ SEMANTIC MEMORY / KNOWLEDGE GRAPH ============
// Entity and relation storage

interface Entity {
  name: string
  type: string
  description?: string
}

interface Relation {
  from: string
  to: string
  type: string
  confidence: number
}

// Extract entities using patterns and NER-like heuristics
export function extractEntities(text: string): Entity[] {
  const entities: Entity[] = []
  
  // Named entities (capitalized words)
  const namedEntityPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g
  const namedMatches = text.match(namedEntityPattern) || []
  
  for (const match of namedMatches) {
    if (match.length > 2 && !['The', 'This', 'That', 'These', 'Those', 'What', 'When', 'Where', 'Which', 'How'].includes(match)) {
      entities.push({
        name: match,
        type: 'named_entity',
        description: `Mentioned in context`
      })
    }
  }
  
  // Technical terms (camelCase, snake_case, programming keywords)
  const techPattern = /\b[a-z]+[A-Z][a-zA-Z]*\b|\b[a-z]+_[a-z_]*\b|\b[A-Z]{2,}\b/g
  const techMatches = text.match(techPattern) || []
  for (const match of techMatches) {
    entities.push({
      name: match,
      type: 'technical_term'
    })
  }
  
  // Numbers and measurements
  const numberPattern = /\b\d+(?:\.\d+)?(?:\s*(?:kg|mb|gb|tb|ms|s|km|m|ft|in|px|%))?\b/gi
  const numberMatches = text.match(numberPattern) || []
  for (const match of numberMatches) {
    entities.push({
      name: match,
      type: 'measurement'
    })
  }
  
  // URLs
  const urlPattern = /https?:\/\/[^\s]+/g
  const urlMatches = text.match(urlPattern) || []
  for (const match of urlMatches) {
    entities.push({
      name: match,
      type: 'url'
    })
  }
  
  // Deduplicate
  const seen = new Set<string>()
  return entities.filter(e => {
    const key = `${e.name}:${e.type}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Extract relations between entities
export function extractRelations(
  text: string,
  entities: Entity[]
): Relation[] {
  const relations: Relation[] = []
  
  // Common relation patterns
  const relationPatterns = [
    { pattern: /(\w+)\s+is\s+(?:a|an|the)\s+(\w+)/i, type: 'is_a' },
    { pattern: /(\w+)\s+has\s+(\w+)/i, type: 'has' },
    { pattern: /(\w+)\s+uses?\s+(\w+)/i, type: 'uses' },
    { pattern: /(\w+)\s+contains?\s+(\w+)/i, type: 'contains' },
    { pattern: /(\w+)\s+creates?\s+(\w+)/i, type: 'creates' },
    { pattern: /(\w+)\s+connects?\s+(?:to\s+)?(\w+)/i, type: 'connects_to' },
    { pattern: /(\w+)\s+(?:are|is)\s+(?:in|on|at)\s+(\w+)/i, type: 'located_in' }
  ]
  
  for (const { pattern, type } of relationPatterns) {
    const matches = text.matchAll(pattern)
    for (const match of matches) {
      const from = match[1]
      const to = match[2]
      
      // Check if these are known entities
      const fromEntity = entities.find(e => 
        e.name.toLowerCase() === from.toLowerCase()
      )
      const toEntity = entities.find(e => 
        e.name.toLowerCase() === to.toLowerCase()
      )
      
      if (fromEntity || toEntity) {
        relations.push({
          from: from,
          to: to,
          type,
          confidence: fromEntity && toEntity ? 0.9 : 0.6
        })
      }
    }
  }
  
  return relations
}

// Store entities and relations in knowledge graph
export async function updateKnowledgeGraph(
  conversationId: string,
  text: string
): Promise<void> {
  const entities = extractEntities(text)
  const relations = extractRelations(text, entities)
  
  // Store entities
  for (const entity of entities) {
    try {
      await db.entity.upsert({
        where: {
          name_type: { name: entity.name, type: entity.type }
        },
        create: {
          name: entity.name,
          type: entity.type,
          description: entity.description,
          embedding: JSON.stringify(generateEmbedding(entity.name + ' ' + (entity.description || '')))
        },
        update: {}
      })
    } catch {
      // Entity might already exist
    }
  }
  
  // Store relations
  for (const rel of relations) {
    try {
      // Find entity IDs
      const fromEntity = await db.entity.findFirst({
        where: { name: rel.from }
      })
      const toEntity = await db.entity.findFirst({
        where: { name: rel.to }
      })
      
      if (fromEntity && toEntity) {
        await db.relation.create({
          data: {
            fromEntityId: fromEntity.id,
            toEntityId: toEntity.id,
            type: rel.type,
            confidence: rel.confidence,
            evidence: text.slice(0, 500)
          }
        })
      }
    } catch {
      // Relation might already exist
    }
  }
}

// Query knowledge graph for context
export async function queryKnowledgeGraph(
  query: string,
  topK: number = 5
): Promise<{ entity: string; type: string; related: string[] }[]> {
  const queryEmbedding = generateEmbedding(query)
  
  const entities = await db.entity.findMany({
    take: 100,
    include: {
      outgoingRelations: { include: { toEntity: true } },
      incomingRelations: { include: { fromEntity: true } }
    }
  })
  
  const scored = entities.map(e => {
    let embedding: number[] = []
    if (e.embedding) {
      try {
        embedding = JSON.parse(e.embedding)
      } catch {}
    }
    
    const similarity = embedding.length > 0
      ? cosineSimilarity(queryEmbedding, embedding)
      : 0
    
    return { entity: e, similarity }
  })
  
  scored.sort((a, b) => b.similarity - a.similarity)
  
  return scored.slice(0, topK).map(s => ({
    entity: s.entity.name,
    type: s.entity.type,
    related: [
      ...s.entity.outgoingRelations.map(r => r.toEntity.name),
      ...s.entity.incomingRelations.map(r => r.fromEntity.name)
    ]
  }))
}

// ============ CONSOLIDATED MEMORY RETRIEVAL ============

export async function retrieveAllMemory(
  conversationId: string,
  query: string,
  options: {
    workingMemory?: boolean
    episodicMemory?: boolean
    knowledgeGraph?: boolean
    topK?: number
  } = {}
): Promise<{
  working: string[]
  episodic: { content: string; importance: number }[]
  knowledge: { entity: string; type: string; related: string[] }[]
}> {
  const {
    workingMemory: useWorking = true,
    episodicMemory: useEpisodic = true,
    knowledgeGraph: useKG = true,
    topK = 5
  } = options
  
  return {
    working: useWorking ? getRelevantFromWorkingMemory(query, topK) : [],
    episodic: useEpisodic ? await retrieveEpisodicMemory(conversationId, query, topK) : [],
    knowledge: useKG ? await queryKnowledgeGraph(query, topK) : []
  }
}
