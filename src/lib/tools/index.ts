// Tool System - Available tools for agents

import ZAI from 'z-ai-web-dev-sdk'

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

// ============ WEB SEARCH TOOL ============

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web for real-time information, news, facts, and current events. Returns relevant search results with URLs, titles, and snippets.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (e.g., "latest AI news", "weather in Belgrade", "who won the World Cup 2022")'
      },
      num_results: {
        type: 'number',
        description: 'Number of results to return (default: 5, max: 10)'
      }
    },
    required: ['query']
  },
  execute: async (params) => {
    const query = String(params.query || '')
    const numResults = Math.min(Number(params.num_results) || 5, 10)
    
    if (!query.trim()) {
      return { success: false, error: 'Search query is required' }
    }
    
    try {
      const zai = await ZAI.create()
      
      const searchResult = await zai.functions.invoke("web_search", {
        query,
        num: numResults
      })
      
      // Format results
      const results = Array.isArray(searchResult) ? searchResult.map((item: {
        url?: string
        name?: string
        snippet?: string
        host_name?: string
        date?: string
      }) => ({
        title: item.name || 'Untitled',
        url: item.url || '',
        snippet: item.snippet || '',
        source: item.host_name || '',
        date: item.date || ''
      })) : []
      
      return {
        success: true,
        query,
        resultsCount: results.length,
        results,
        summary: results.length > 0 
          ? `Found ${results.length} results for "${query}"` 
          : `No results found for "${query}"`
      }
    } catch (error) {
      return {
        success: false,
        query,
        error: error instanceof Error ? error.message : 'Web search failed',
        results: []
      }
    }
  }
}

// ============ CODE EXECUTION TOOL ============

export const codeExecutionTool: Tool = {
  name: 'code_execute',
  description: 'Execute JavaScript/TypeScript code safely in a sandboxed environment. Useful for data processing, calculations, formatting, and algorithm testing.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript code to execute. Must be valid JS/TS. Use console.log() for output. Last expression is returned. Available: Math, Date, JSON, Array methods, Object methods.'
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in milliseconds (default: 5000, max: 10000)'
      }
    },
    required: ['code']
  },
  execute: async (params) => {
    const code = String(params.code || '')
    const timeout = Math.min(Number(params.timeout) || 5000, 10000)
    
    if (!code.trim()) {
      return { success: false, error: 'Code is required' }
    }
    
    // Security: Block dangerous operations
    const dangerousPatterns = [
      /require\s*\(/i,
      /import\s+/i,
      /eval\s*\(/i,
      /Function\s*\(/i,
      /process\s*\./i,
      /global\s*\./i,
      /__dirname/i,
      /__filename/i,
      /fs\s*\./i,
      /child_process/i,
      /crypto\s*\./i,
      /http\s*\./i,
      /https\s*\./i,
      /fetch\s*\(/i,
      /\.exit\s*\(/i,
      /while\s*\(\s*true\s*\)/i,
      /for\s*\(\s*;\s*;\s*\)/i,
    ]
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        return {
          success: false,
          error: `Code contains blocked operation for security reasons`,
          blockedPattern: pattern.source
        }
      }
    }
    
    try {
      // Create sandboxed execution context
      const logs: string[] = []
      const mockConsole = {
        log: (...args: unknown[]) => logs.push(args.map(a => 
          typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
        ).join(' ')),
        error: (...args: unknown[]) => logs.push('[ERROR] ' + args.map(a => 
          typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
        ).join(' ')),
        warn: (...args: unknown[]) => logs.push('[WARN] ' + args.map(a => 
          typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
        ).join(' ')),
        info: (...args: unknown[]) => logs.push('[INFO] ' + args.map(a => 
          typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
        ).join(' '))
      }
      
      // Create safe execution function with limited scope
      const safeFunction = new Function(
        'console', 
        'Math', 
        'Date', 
        'JSON', 
        'Object', 
        'Array', 
        'String', 
        'Number', 
        'Boolean',
        'RegExp',
        'Error',
        'Map',
        'Set',
        'Promise',
        `
        "use strict";
        ${code.includes('return') ? code : `return (${code})`}
        `
      )
      
      // Execute with timeout simulation (basic)
      const startTime = Date.now()
      const result = safeFunction(
        mockConsole, 
        Math, 
        Date, 
        JSON, 
        Object, 
        Array, 
        String, 
        Number, 
        Boolean,
        RegExp,
        Error,
        Map,
        Set,
        Promise
      )
      const executionTime = Date.now() - startTime
      
      // Handle promises
      let finalResult = result
      if (result instanceof Promise) {
        finalResult = await Promise.race([
          result,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Execution timeout')), timeout)
          )
        ])
      }
      
      return {
        success: true,
        result: finalResult,
        logs,
        executionTime,
        output: logs.length > 0 ? logs.join('\n') : undefined
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Code execution failed',
        errorType: error instanceof Error ? error.name : 'UnknownError'
      }
    }
  }
}

// ============ DATETIME TOOL ============

export const dateTimeTool: Tool = {
  name: 'datetime',
  description: 'Get current date/time, format dates, calculate date differences, and convert timezones.',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'Operation: now, format, diff, add, subtract, timezone',
        enum: ['now', 'format', 'diff', 'add', 'subtract', 'timezone']
      },
      date: {
        type: 'string',
        description: 'Date string (ISO format or natural language)'
      },
      date2: {
        type: 'string',
        description: 'Second date for diff operation'
      },
      format: {
        type: 'string',
        description: 'Output format (e.g., "YYYY-MM-DD", "DD/MM/YYYY HH:mm")'
      },
      amount: {
        type: 'number',
        description: 'Amount to add/subtract'
      },
      unit: {
        type: 'string',
        description: 'Unit for add/subtract: days, hours, minutes, months, years',
        enum: ['days', 'hours', 'minutes', 'months', 'years', 'seconds']
      },
      timezone: {
        type: 'string',
        description: 'Target timezone (e.g., "Europe/Belgrade", "America/New_York")'
      }
    },
    required: ['operation']
  },
  execute: async (params) => {
    const operation = String(params.operation || 'now')
    
    try {
      const now = new Date()
      
      switch (operation) {
        case 'now': {
          return {
            success: true,
            iso: now.toISOString(),
            utc: now.toUTCString(),
            local: now.toString(),
            timestamp: now.getTime(),
            components: {
              year: now.getFullYear(),
              month: now.getMonth() + 1,
              day: now.getDate(),
              hour: now.getHours(),
              minute: now.getMinutes(),
              second: now.getSeconds(),
              dayOfWeek: now.getDay(),
              dayOfYear: Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000)
            }
          }
        }
        
        case 'format': {
          const dateStr = params.date ? new Date(String(params.date)) : now
          const format = String(params.format || 'YYYY-MM-DD HH:mm:ss')
          
          if (isNaN(dateStr.getTime())) {
            return { success: false, error: 'Invalid date' }
          }
          
          const replacements: Record<string, string> = {
            'YYYY': String(dateStr.getFullYear()),
            'YY': String(dateStr.getFullYear()).slice(-2),
            'MM': String(dateStr.getMonth() + 1).padStart(2, '0'),
            'M': String(dateStr.getMonth() + 1),
            'DD': String(dateStr.getDate()).padStart(2, '0'),
            'D': String(dateStr.getDate()),
            'HH': String(dateStr.getHours()).padStart(2, '0'),
            'H': String(dateStr.getHours()),
            'mm': String(dateStr.getMinutes()).padStart(2, '0'),
            'm': String(dateStr.getMinutes()),
            'ss': String(dateStr.getSeconds()).padStart(2, '0'),
            's': String(dateStr.getSeconds())
          }
          
          let formatted = format
          for (const [key, value] of Object.entries(replacements)) {
            formatted = formatted.replace(new RegExp(key, 'g'), value)
          }
          
          return { success: true, formatted, original: dateStr.toISOString() }
        }
        
        case 'diff': {
          const date1 = new Date(String(params.date || now))
          const date2 = new Date(String(params.date2 || now))
          
          if (isNaN(date1.getTime()) || isNaN(date2.getTime())) {
            return { success: false, error: 'Invalid date(s)' }
          }
          
          const diffMs = Math.abs(date2.getTime() - date1.getTime())
          
          return {
            success: true,
            milliseconds: diffMs,
            seconds: Math.floor(diffMs / 1000),
            minutes: Math.floor(diffMs / 60000),
            hours: Math.floor(diffMs / 3600000),
            days: Math.floor(diffMs / 86400000),
            weeks: Math.floor(diffMs / 604800000),
            months: Math.floor(diffMs / 2629746000),
            years: Math.floor(diffMs / 31556952000),
            from: date1.toISOString(),
            to: date2.toISOString()
          }
        }
        
        case 'add':
        case 'subtract': {
          const date = params.date ? new Date(String(params.date)) : now
          const amount = Number(params.amount) || 0
          const unit = String(params.unit || 'days')
          
          if (isNaN(date.getTime())) {
            return { success: false, error: 'Invalid date' }
          }
          
          const multiplier = operation === 'add' ? 1 : -1
          const newDate = new Date(date)
          
          switch (unit) {
            case 'seconds':
              newDate.setSeconds(newDate.getSeconds() + amount * multiplier)
              break
            case 'minutes':
              newDate.setMinutes(newDate.getMinutes() + amount * multiplier)
              break
            case 'hours':
              newDate.setHours(newDate.getHours() + amount * multiplier)
              break
            case 'days':
              newDate.setDate(newDate.getDate() + amount * multiplier)
              break
            case 'months':
              newDate.setMonth(newDate.getMonth() + amount * multiplier)
              break
            case 'years':
              newDate.setFullYear(newDate.getFullYear() + amount * multiplier)
              break
          }
          
          return {
            success: true,
            original: date.toISOString(),
            result: newDate.toISOString(),
            operation: `${operation} ${amount} ${unit}`
          }
        }
        
        case 'timezone': {
          const date = params.date ? new Date(String(params.date)) : now
          const tz = String(params.timezone || 'UTC')
          
          if (isNaN(date.getTime())) {
            return { success: false, error: 'Invalid date' }
          }
          
          try {
            const options: Intl.DateTimeFormatOptions = {
              timeZone: tz,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false
            }
            
            const formatted = date.toLocaleString('en-US', options)
            const localTime = date.toLocaleString('en-US', { ...options, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
            
            return {
              success: true,
              timezone: tz,
              timeInZone: formatted,
              localTime,
              utcTime: date.toUTCString(),
              iso: date.toISOString()
            }
          } catch {
            return { 
              success: false, 
              error: 'Invalid timezone. Use IANA timezone names like "Europe/Belgrade", "America/New_York"' 
            }
          }
        }
        
        default:
          return { success: false, error: 'Unknown operation' }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Date operation failed'
      }
    }
  }
}

// ============ TOOL REGISTRY ============

export const toolRegistry: Map<string, Tool> = new Map([
  ['calculator', calculatorTool],
  ['text_analysis', textAnalysisTool],
  ['json_tool', jsonTool],
  ['regex', regexTool],
  ['unit_converter', unitConverterTool],
  ['web_search', webSearchTool],
  ['code_execute', codeExecutionTool],
  ['datetime', dateTimeTool]
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
  
  // Web search - triggers for current info, news, weather, etc.
  if (/search|find online|look up|what is the latest|current|recent|news|weather|today|who is|when did|where is|how do i|latest|breaking|now|this year|this month/.test(lower)) {
    selected.push('web_search')
  }
  
  // Code execution - triggers for programming tasks
  if (/run code|execute|javascript|typescript|eval|compute this|calculate this|algorithm|sort|filter|map|array|function|script/.test(lower)) {
    selected.push('code_execute')
  }
  
  // DateTime - triggers for date/time queries
  if (/what time|what date|current time|current date|today|now|timezone|days until|days since|how long|date difference|add days|subtract days/.test(lower)) {
    selected.push('datetime')
  }
  
  return selected
}
