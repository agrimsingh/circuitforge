# Testing Strategy

## Approach
Minimal but targeted testing for MVP. Focus on deterministic logic, not AI output.

## Test Pyramid

### Unit Tests (Vitest)
- **SSE parser**: Given raw SSE text, produces correct typed events
- **Export conversion**: Given fixture Circuit JSON, produces expected zip structure
- **Model config**: Model aliases resolve to valid model strings

### Integration Tests (future)
- Agent route: mock Anthropic API, verify SSE event sequence
- Export route: send real Circuit JSON fixture, verify zip contents

### E2E Tests (future)
- Full flow: prompt → streaming UI → code → preview → export

## Tools
- **Vitest**: Unit and integration tests
- **Testing Library**: Component tests (future)

## What We Don't Test
- AI output quality (non-deterministic)
- tscircuit rendering (tested by tscircuit team)
- jlcsearch API responses (external dependency)

## Running Tests
```bash
npm test          # run all tests
npm test -- --watch  # watch mode
```
