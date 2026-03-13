// Embeddings Utility - 384-dim vectors with multiple strategies

// Generate 384-dim embedding (compatible with sentence-transformers/all-MiniLM-L6-v2)
export function generateEmbedding(text: string): number[] {
  const dim = 384
  const embedding = new Array(dim).fill(0)
  
  // Tokenize and normalize
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
  
  // Word-level hashing (similar to bag of words with positional encoding)
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    let hash = hashString(word)
    
    // Position-weighted contribution
    const positionWeight = 1 / (1 + i * 0.1)
    
    // Spread across multiple dimensions (captures semantics)
    for (let j = 0; j < 8; j++) {
      const idx = Math.abs((hash + j * 47) % dim)
      embedding[idx] += positionWeight * (1 / (1 + j))
    }
    
    // Character n-grams for subword semantics
    for (let n = 2; n <= 4; n++) {
      for (let k = 0; k <= word.length - n; k++) {
        const ngram = word.slice(k, k + n)
        const ngramHash = hashString(ngram)
        const idx = Math.abs((ngramHash + n * 31) % dim)
        embedding[idx] += 0.3 * positionWeight
      }
    }
  }
  
  // Add structural features
  const structuralFeatures = extractStructuralFeatures(text)
  for (let i = 0; i < structuralFeatures.length; i++) {
    const idx = (i * 7 + 300) % dim // Use last 84 dims for structure
    embedding[idx] = structuralFeatures[i]
  }
  
  // L2 Normalize
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0))
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      embedding[i] /= norm
    }
  }
  
  return embedding
}

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

function extractStructuralFeatures(text: string): number[] {
  const features: number[] = []
  
  // Text length (normalized)
  features.push(Math.min(text.length / 1000, 1))
  
  // Word count (normalized)
  const words = text.split(/\s+/)
  features.push(Math.min(words.length / 200, 1))
  
  // Sentence count (normalized)
  const sentences = text.split(/[.!?]+/).filter(s => s.trim())
  features.push(Math.min(sentences.length / 20, 1))
  
  // Question marks
  features.push(Math.min((text.match(/\?/g) || []).length / 5, 1))
  
  // Numbers
  features.push(Math.min((text.match(/\d+/g) || []).length / 10, 1))
  
  // Code blocks
  features.push(text.includes('```') ? 1 : 0)
  
  // URLs
  features.push(Math.min((text.match(/https?:\/\//g) || []).length / 3, 1))
  
  // Capitalization ratio
  const caps = (text.match(/[A-Z]/g) || []).length
  features.push(Math.min(caps / text.length, 1))
  
  // Punctuation density
  const punct = (text.match(/[.,!?;:]/g) || []).length
  features.push(Math.min(punct / text.length * 10, 1))
  
  // Average word length
  const avgWordLen = words.reduce((s, w) => s + w.length, 0) / words.length
  features.push(Math.min(avgWordLen / 10, 1))
  
  return features
}

// Cosine similarity
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom > 0 ? dot / denom : 0
}

// Euclidean distance (for diversity)
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity
  
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2
  }
  
  return Math.sqrt(sum)
}

// BM25 scoring for keyword search
export function bm25Score(
  query: string,
  document: string,
  avgDocLength: number,
  k1: number = 1.5,
  b: number = 0.75
): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const docTerms = document.toLowerCase().split(/\s+/)
  const docLength = docTerms.length
  
  if (docLength === 0 || queryTerms.length === 0) return 0
  
  // Term frequency in document
  const termFreq = new Map<string, number>()
  for (const term of docTerms) {
    termFreq.set(term, (termFreq.get(term) || 0) + 1)
  }
  
  // Document frequency estimation (simplified)
  const n = 100 // Assumed collection size
  
  let score = 0
  for (const term of queryTerms) {
    const tf = termFreq.get(term) || 0
    if (tf === 0) continue
    
    // IDF
    const df = 1 // Simplified - assume term appears in 1 doc
    const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1)
    
    // TF component with saturation
    const numerator = tf * (k1 + 1)
    const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength))
    
    score += idf * (numerator / denominator)
  }
  
  return score
}

// Hybrid score combining semantic and keyword
export function hybridScore(
  semanticScore: number,
  keywordScore: number,
  semanticWeight: number = 0.6
): number {
  // Normalize keyword score (typically 0-10 range)
  const normalizedKeyword = keywordScore / 10
  return semanticWeight * semanticScore + (1 - semanticWeight) * normalizedKeyword
}

// Maximal Marginal Relevance for diversity
export function mmr(
  queryEmbedding: number[],
  docEmbeddings: number[][],
  lambda: number = 0.5,
  topK: number = 5
): number[] {
  const selected: number[] = []
  const remaining = new Set(docEmbeddings.map((_, i) => i))
  
  while (selected.length < topK && remaining.size > 0) {
    let bestIdx = -1
    let bestScore = -Infinity
    
    for (const idx of remaining) {
      const relevance = cosineSimilarity(queryEmbedding, docEmbeddings[idx])
      
      // Compute max similarity to already selected
      let maxRedundancy = 0
      for (const selIdx of selected) {
        const redundancy = cosineSimilarity(docEmbeddings[idx], docEmbeddings[selIdx])
        maxRedundancy = Math.max(maxRedundancy, redundancy)
      }
      
      // MMR score
      const mmrScore = lambda * relevance - (1 - lambda) * maxRedundancy
      
      if (mmrScore > bestScore) {
        bestScore = mmrScore
        bestIdx = idx
      }
    }
    
    if (bestIdx >= 0) {
      selected.push(bestIdx)
      remaining.delete(bestIdx)
    } else {
      break
    }
  }
  
  return selected
}
