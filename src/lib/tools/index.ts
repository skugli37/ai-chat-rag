// Tool System - Available tools for agents

import { db } from '@/lib/db'

export interface Tool {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, { type: string; description: string }>
    required: string[]
  }
  execute: (params: Record<string, unknown>) => Promise<unknown>
}

// ============ CALCULATOR TOOL ============

export const calculatorTool: Tool = {
  name: 'calculator',
  description: 'Perform mathematical calculations. Supports basic arithmetic, trigonometry, logarithms, and more.',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Mathematical expression to evaluate (e.g., "2+2", "sin(3.14)", "log(10)")'
      }
    },
    required: ['expression']
  },
  execute: async (params) => {
    const expression = String(params.expression || '')
    
    try {
      // Safe evaluation with limited scope
      const sanitized = expression
        .replace(/[^0-9+\-*/().^%\s\w]/g, '')
        .replace(/sin/g, 'Math.sin')
        .replace(/cos/g, 'Math.cos')
        .replace(/tan/g, 'Math.tan')
        .replace(/log/g, 'Math.log10')
        .replace(/ln/g, 'Math.log')
        .replace(/sqrt/g, 'Math.sqrt')
        .replace(/abs/g, 'Math.abs')
        .replace(/pow/g, 'Math.pow')
        .replace(/PI/g, 'Math.PI')
        .replace(/E/g, 'Math.E')
      
      // Use Function constructor for safe eval
      const result = new Function(`return ${sanitized}`)()
      
      return {
        success: true,
        expression,
        result: typeof result === 'number' ? result : NaN,
        type: typeof result
      }
    } catch (error) {
      return {
        success: false,
        expression,
        error: error instanceof Error ? error.message : 'Calculation failed',
        result: null
      }
    }
  }
}

// ============ TEXT ANALYSIS TOOL ============

export const textAnalysisTool: Tool = {
  name: 'text_analysis',
  description: 'Analyze text for statistics like word count, character count, sentiment indicators.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to analyze'
      },
      analysis_type: {
        type: 'string',
        description: 'Type of analysis: stats, keywords, sentiment',
        enum: ['stats', 'keywords', 'sentiment']
      }
    },
    required: ['text', 'analysis_type']
  },
  execute: async (params) => {
    const text = String(params.text || '')
    const analysisType = String(params.analysis_type || 'stats')
    
    switch (analysisType) {
      case 'stats': {
        const words = text.split(/\s+/).filter(w => w.length > 0)
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0)
        const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0)
        
        return {
          success: true,
          stats: {
            characters: text.length,
            charactersNoSpaces: text.replace(/\s/g, '').length,
            words: words.length,
            sentences: sentences.length,
            paragraphs: paragraphs.length,
            avgWordLength: words.length > 0 
              ? words.reduce((s, w) => s + w.length, 0) / words.length 
              : 0,
            avgSentenceLength: sentences.length > 0 
              ? words.length / sentences.length 
              : 0,
            readingTime: Math.ceil(words.length / 200), // minutes
            speakingTime: Math.ceil(words.length / 150) // minutes
          }
        }
      }
      
      case 'keywords': {
        const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/)
        const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 
          'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 
          'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 
          'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
          'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between',
          'under', 'again', 'further', 'then', 'once', 'and', 'but', 'or', 'nor',
          'so', 'yet', 'both', 'either', 'neither', 'not', 'only', 'own', 'same',
          'than', 'too', 'very', 'just', 'also', 'this', 'that', 'these', 'those'])
        
        const frequency: Record<string, number> = {}
        for (const word of words) {
          if (word.length > 2 && !stopWords.has(word)) {
            frequency[word] = (frequency[word] || 0) + 1
          }
        }
        
        const keywords = Object.entries(frequency)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([word, count]) => ({ word, count }))
        
        return { success: true, keywords }
      }
      
      case 'sentiment': {
        const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 
          'fantastic', 'awesome', 'brilliant', 'superb', 'outstanding', 'perfect',
          'love', 'happy', 'joy', 'pleased', 'delighted', 'satisfied', 'positive']
        const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'poor', 
          'disappointing', 'frustrating', 'annoying', 'hate', 'sad', 'angry',
          'upset', 'negative', 'worst', 'fail', 'failed', 'failure']
        
        const words = text.toLowerCase().split(/\s+/)
        let positive = 0, negative = 0
        
        for (const word of words) {
          if (positiveWords.some(pw => word.includes(pw))) positive++
          if (negativeWords.some(nw => word.includes(nw))) negative++
        }
        
        const total = positive + negative
        const score = total > 0 ? (positive - negative) / total : 0
        
        return {
          success: true,
          sentiment: {
            score, // -1 to 1
            positive,
            negative,
            classification: score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral'
          }
        }
      }
      
      default:
        return { success: false, error: 'Unknown analysis type' }
    }
  }
}

// ============ JSON TOOL ============

export const jsonTool: Tool = {
  name: 'json_tool',
  description: 'Parse, validate, or format JSON data.',
  parameters: {
    type: 'object',
    properties: {
      json_string: {
        type: 'string',
        description: 'JSON string to process'
      },
      operation: {
        type: 'string',
        description: 'Operation: parse, validate, format, extract',
        enum: ['parse', 'validate', 'format', 'extract']
      },
      path: {
        type: 'string',
        description: 'JSON path for extract operation (e.g., "data.items[0].name")'
      }
    },
    required: ['json_string', 'operation']
  },
  execute: async (params) => {
    const jsonString = String(params.json_string || '')
    const operation = String(params.operation || 'validate')
    const path = String(params.path || '')
    
    try {
      switch (operation) {
        case 'parse':
          return { success: true, data: JSON.parse(jsonString) }
        
        case 'validate':
          JSON.parse(jsonString)
          return { success: true, valid: true }
        
        case 'format':
          return { 
            success: true, 
            formatted: JSON.stringify(JSON.parse(jsonString), null, 2) 
          }
        
        case 'extract': {
          const data = JSON.parse(jsonString)
          const keys = path.split('.').flatMap(k => {
            const match = k.match(/([^\[\]]+)|\[(\d+)\]/g)
            return match || []
          })
          
          let result = data
          for (const key of keys) {
            if (key.startsWith('[') && key.endsWith(']')) {
              const index = parseInt(key.slice(1, -1))
              result = result[index]
            } else {
              result = result[key]
            }
          }
          
          return { success: true, extracted: result }
        }
        
        default:
          return { success: false, error: 'Unknown operation' }
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'JSON processing failed' 
      }
    }
  }
}

// ============ REGEX TOOL ============

export const regexTool: Tool = {
  name: 'regex',
  description: 'Execute regular expression operations on text.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to process'
      },
      pattern: {
        type: 'string',
        description: 'Regular expression pattern'
      },
      operation: {
        type: 'string',
        description: 'Operation: match, replace, split, test',
        enum: ['match', 'replace', 'split', 'test']
      },
      replacement: {
        type: 'string',
        description: 'Replacement string for replace operation'
      },
      flags: {
        type: 'string',
        description: 'Regex flags (e.g., "gi" for global, case-insensitive)'
      }
    },
    required: ['text', 'pattern', 'operation']
  },
  execute: async (params) => {
    const text = String(params.text || '')
    const pattern = String(params.pattern || '')
    const operation = String(params.operation || 'match')
    const replacement = String(params.replacement || '')
    const flags = String(params.flags || 'g')
    
    try {
      const regex = new RegExp(pattern, flags)
      
      switch (operation) {
        case 'match':
          return { 
            success: true, 
            matches: text.match(regex) || [] 
          }
        
        case 'replace':
          return { 
            success: true, 
            result: text.replace(regex, replacement) 
          }
        
        case 'split':
          return { 
            success: true, 
            parts: text.split(regex) 
          }
        
        case 'test':
          return { 
            success: true, 
            matches: regex.test(text) 
          }
        
        default:
          return { success: false, error: 'Unknown operation' }
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Regex execution failed' 
      }
    }
  }
}

// ============ UNIT CONVERTER TOOL ============

export const unitConverterTool: Tool = {
  name: 'unit_converter',
  description: 'Convert between different units of measurement.',
  parameters: {
    type: 'object',
    properties: {
      value: {
        type: 'number',
        description: 'Value to convert'
      },
      from: {
        type: 'string',
        description: 'Source unit (e.g., km, mi, kg, lb, C, F)'
      },
      to: {
        type: 'string',
        description: 'Target unit (e.g., km, mi, kg, lb, C, F)'
      }
    },
    required: ['value', 'from', 'to']
  },
  execute: async (params) => {
    const value = Number(params.value)
    const from = String(params.from || '').toLowerCase()
    const to = String(params.to || '').toLowerCase()
    
    const conversions: Record<string, Record<string, (v: number) => number>> = {
      // Length
      'km': { 'mi': v => v * 0.621371, 'm': v => v * 1000, 'ft': v => v * 3280.84 },
      'mi': { 'km': v => v * 1.60934, 'm': v => v * 1609.34, 'ft': v => v * 5280 },
      'm': { 'km': v => v / 1000, 'mi': v => v / 1609.34, 'ft': v => v * 3.28084 },
      'ft': { 'm': v => v / 3.28084, 'km': v => v / 3280.84, 'mi': v => v / 5280 },
      // Weight
      'kg': { 'lb': v => v * 2.20462, 'g': v => v * 1000, 'oz': v => v * 35.274 },
      'lb': { 'kg': v => v / 2.20462, 'g': v => v * 453.592, 'oz': v => v * 16 },
      // Temperature
      'c': { 'f': v => v * 9/5 + 32, 'k': v => v + 273.15 },
      'f': { 'c': v => (v - 32) * 5/9, 'k': v => (v - 32) * 5/9 + 273.15 },
      'k': { 'c': v => v - 273.15, 'f': v => (v - 273.15) * 9/5 + 32 },
      // Data
      'gb': { 'mb': v => v * 1024, 'kb': v => v * 1024 * 1024, 'tb': v => v / 1024 },
      'mb': { 'gb': v => v / 1024, 'kb': v => v * 1024, 'tb': v => v / (1024 * 1024) }
    }
    
    const converter = conversions[from]?.[to]
    
    if (!converter) {
      // Check for same unit
      if (from === to) {
        return { success: true, value, from, to, result: value }
      }
      
      return { 
        success: false, 
        error: `Cannot convert from ${from} to ${to}. Available: ${Object.keys(conversions).join(', ')}` 
      }
    }
    
    const result = converter(value)
    
    return {
      success: true,
      original: { value, unit: from },
      converted: { value: result, unit: to }
    }
  }
}

// ============ TOOL REGISTRY ============

export const toolRegistry: Map<string, Tool> = new Map([
  ['calculator', calculatorTool],
  ['text_analysis', textAnalysisTool],
  ['json_tool', jsonTool],
  ['regex', regexTool],
  ['unit_converter', unitConverterTool]
])

export function getTool(name: string): Tool | undefined {
  return toolRegistry.get(name)
}

export function listTools(): { name: string; description: string }[] {
  return Array.from(toolRegistry.values()).map(t => ({
    name: t.name,
    description: t.description
  }))
}

export async function executeTool(
  name: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const tool = toolRegistry.get(name)
  if (!tool) {
    return { success: false, error: `Tool '${name}' not found` }
  }
  return tool.execute(params)
}

// Tool selection based on query analysis
export function selectTools(query: string): string[] {
  const selected: string[] = []
  const lower = query.toLowerCase()
  
  // Math/calculation
  if (/[\d+\-*/^()=]|calculate|compute|what is \d|how much|percentage|average|sum|multiply|divide|add|subtract/.test(lower)) {
    selected.push('calculator')
  }
  
  // Text analysis
  if (/word count|character count|analyze text|sentiment|keywords|frequency|statistics/.test(lower)) {
    selected.push('text_analysis')
  }
  
  // JSON
  if (/json|parse json|validate json|format json/.test(lower)) {
    selected.push('json_tool')
  }
  
  // Regex
  if (/regex|pattern match|regular expression|find pattern|replace pattern/.test(lower)) {
    selected.push('regex')
  }
  
  // Unit conversion
  if (/convert|km to mi|miles to km|kg to lb|pounds to kg|celsius to fahrenheit|fahrenheit to celsius/.test(lower)) {
    selected.push('unit_converter')
  }
  
  return selected
}
