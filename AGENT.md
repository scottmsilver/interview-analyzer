# AI Agent Documentation - Interview Analyzer

## Overview

The Interview Analyzer uses Claude 3.5 Sonnet through the Anthropic Agent SDK to provide comprehensive analysis of PM interview transcripts. The agent operates in a streaming fashion, providing real-time feedback as it processes the transcript.

## Agent Architecture

### Core Components

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Frontend  │────▶│  Express API │────▶│ Claude Agent│
│   (React)   │◀────│   (Backend)  │◀────│  (SDK)      │
└─────────────┘     └──────────────┘     └─────────────┘
       ▲                    │                     │
       │                    ▼                     ▼
       │            ┌──────────────┐     ┌─────────────┐
       └────────────│   Firebase   │     │ Anthropic   │
                    │   Storage     │     │    API      │
                    └──────────────┘     └─────────────┘
```

### Communication Flow

1. **User → System**: Upload transcript
2. **System → Agent**: Initialize with interview type context
3. **Agent → System**: Request tools/analysis
4. **System → Agent**: Execute requested operations
5. **Agent → User**: Stream analysis results

## Agent Configuration

### Model Selection
```javascript
model: "claude-3-5-sonnet-20241022"  // Latest Sonnet model for best performance
```

### Temperature Settings
- **Analysis**: 0.3 (focused, consistent feedback)
- **Suggestions**: 0.5 (balanced creativity)

### Max Tokens
- Default: 8192 tokens
- Can be extended for longer transcripts

## Agent Prompts

### System Prompt Structure
```
You are an expert PM interview coach analyzing {interviewType} interviews.

Context:
- Interview type: {Google APM | Meta PM | Amazon PM | Generic}
- Focus areas: [type-specific criteria]
- Output format: Structured markdown

Your task:
1. Analyze the transcript thoroughly
2. Identify strengths and areas for improvement
3. Provide specific, actionable feedback
4. Include examples from the transcript
```

### Interview Type Templates

#### Google APM
- Focus on analytical thinking
- Product sense and creativity
- User empathy
- Technical understanding

#### Meta PM
- Metrics and goal-setting
- Product execution
- Strategic thinking
- Leadership principles

#### Amazon PM
- Customer obsession
- Working backwards
- Data-driven decisions
- Ownership mindset

#### Generic PM
- Problem-solving approach
- Communication clarity
- Product thinking
- Business acumen

## Message Protocol

### System-Agent Dialogue Pattern

The agent follows a structured conversation pattern:

```
User Request
  → System: Processing request
    ↳ Tool: WebSearch("PM best practices")
    ✓ Result: Found 5 sources
  → Agent: Analyzing transcript
    ↳ Tool: Evaluation framework
    ✓ Result: Structured feedback
  ← Agent: Final analysis
```

### Message Types

| Type | Purpose | Visual Indicator |
|------|---------|------------------|
| `system:init` | Initialize agent | → System: |
| `assistant` | Agent thinking/response | → Agent: |
| `tool_use` | Execute tool | ↳ Executing: |
| `tool_result` | Tool completion | ✓ Result: |
| `stream_delta` | Partial response | ← Agent: |
| `error` | Error handling | ⚠ Error: |

## Tool Integration

### Available Tools

1. **WebSearch**
   - Search for current best practices
   - Find industry examples
   - Research company-specific patterns

2. **TextAnalysis**
   - Sentiment analysis
   - Key phrase extraction
   - Structure evaluation

3. **FeedbackGenerator**
   - Create structured feedback
   - Generate improvement suggestions
   - Provide example responses

### Tool Execution Flow

```javascript
// Tool request from agent
{
  type: 'tool_use',
  tool: 'WebSearch',
  input: { query: 'STAR method examples' }
}

// System executes and returns
{
  type: 'tool_result',
  content: 'Found 5 relevant examples...'
}
```

## Streaming Response

### SSE (Server-Sent Events) Protocol

```javascript
// Status updates
data: {"type":"raw","content":"Analyzing transcript..."}

// Partial results
data: {"type":"result","content":"## Strengths\n\n"}

// Final completion
data: {"type":"complete","content":"Analysis complete"}
```

### Client-Side Handling

```javascript
const eventSource = new EventSource('/api/analyze/stream')

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data)

  switch(data.type) {
    case 'raw':
      updateStatus(data.content)
      break
    case 'result':
      appendAnalysis(data.content)
      break
    case 'complete':
      finalizeAnalysis()
      break
  }
}
```

## Analysis Framework

### Evaluation Criteria

1. **Structure & Clarity**
   - Clear problem definition
   - Logical flow
   - Concise communication

2. **Problem-Solving**
   - Analytical approach
   - Creative solutions
   - Trade-off analysis

3. **Product Sense**
   - User empathy
   - Market understanding
   - Metrics awareness

4. **Technical Competence**
   - Technical feasibility
   - System thinking
   - Data-driven approach

5. **Leadership & Collaboration**
   - Stakeholder management
   - Team dynamics
   - Influence without authority

### Scoring Rubric

| Score | Description | Indicators |
|-------|-------------|------------|
| Excellent | Exceptional performance | Clear mastery, innovative thinking |
| Good | Strong performance | Solid approach, minor gaps |
| Satisfactory | Adequate performance | Basic competence, some improvements needed |
| Needs Improvement | Below expectations | Significant gaps, requires practice |

## Output Format

### Standard Analysis Structure

```markdown
# Interview Analysis

## Overall Assessment
Brief summary of performance

## Strengths
- Specific strength with example
- Another strength with evidence

## Areas for Improvement
- Improvement area with specific suggestion
- Another area with actionable advice

## Detailed Feedback

### [Topic 1]
Detailed analysis with examples

### [Topic 2]
Detailed analysis with examples

## Recommendations
1. Specific action item
2. Practice suggestion
3. Resource recommendation

## Example Improvements
Before: "Original response from transcript"
After: "Suggested improved response"
```

## Error Handling

### Common Scenarios

1. **Empty Transcript**
   - Message: "Please provide a transcript to analyze"
   - Status: 400 Bad Request

2. **Invalid Format**
   - Message: "Transcript format not recognized"
   - Suggestion: "Please upload a text file"

3. **API Timeout**
   - Retry logic: 3 attempts
   - Fallback: Return partial analysis

4. **Rate Limiting**
   - Queue management
   - User notification
   - Graceful degradation

## Performance Optimization

### Caching Strategy
- Cache common frameworks
- Store interview type templates
- Reuse analysis patterns

### Streaming Optimizations
- Chunk size: 1KB
- Buffer management
- Progressive rendering

### Resource Management
- Connection pooling
- Memory limits
- Timeout controls

## Security Considerations

### Data Protection
- No permanent storage of transcripts (unless saved by user)
- Encrypted transmission
- Sanitized inputs

### API Security
- Rate limiting per user
- Authentication required
- Input validation

### Privacy
- No PII extraction
- Anonymous analysis
- User-controlled data

## Monitoring and Logging

### Metrics Tracked
- Analysis completion rate
- Average processing time
- Error frequency
- User satisfaction

### Log Levels
```javascript
logger.info('Analysis started', { userId, type })
logger.warn('Retry attempted', { attempt, error })
logger.error('Analysis failed', { error, context })
```

## Future Enhancements

### Planned Features
1. Multi-language support
2. Voice transcript processing
3. Comparative analysis
4. Progress tracking
5. Custom evaluation criteria

### Model Improvements
- Fine-tuning for interview analysis
- Industry-specific models
- Personalized feedback

### Integration Possibilities
- Calendar integration
- Video analysis
- Mock interview practice
- Peer review system

## Development Setup

### Environment Variables
```env
ANTHROPIC_API_KEY=your_api_key
MODEL_NAME=claude-3-5-sonnet-20241022
MAX_RETRIES=3
STREAM_TIMEOUT=120000
```

### Testing the Agent
```javascript
// Test prompt
const testTranscript = "Sample interview transcript..."
const analysis = await analyzeWithAgent(testTranscript, 'google-apm')
```

## Troubleshooting

### Common Issues

1. **Slow Analysis**
   - Check API quotas
   - Verify network connection
   - Consider transcript length

2. **Incomplete Results**
   - Increase timeout
   - Check token limits
   - Verify streaming connection

3. **Inconsistent Feedback**
   - Review temperature settings
   - Check prompt consistency
   - Validate input format

## Support and Updates

- Documentation: This file
- Issues: GitHub repository
- Updates: Check Anthropic SDK releases
- Model versions: Monitor Claude updates

Last Updated: November 2024
