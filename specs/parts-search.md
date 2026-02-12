# Parts Search Spec

## Overview
Integration with jlcsearch.tscircuit.com to find real, in-stock JLCPCB components.

## API Endpoints Used

### General Search
```
GET https://jlcsearch.tscircuit.com/api/search?q={query}&limit={n}&full=true
```
Returns: `{ components: [{ lcsc, mfr, package, description, stock, price }] }`

### Component List
```
GET https://jlcsearch.tscircuit.com/components/list.json?search={term}&package={pkg}
```

### Category-Specific
```
GET https://jlcsearch.tscircuit.com/resistors/list.json?resistance={value}&package={pkg}
GET https://jlcsearch.tscircuit.com/capacitors/list.json?capacitance={value}
GET https://jlcsearch.tscircuit.com/microcontrollers/list.json?search={term}
```

## MCP Tool Definition
- Server name: `circuitforge-tools`
- Tool name: `search_parts`
- Input schema:
  - `q` (string, required): Search query
  - `limit` (number, optional, default 10): Max results
  - `package` (string, optional): Package filter (e.g., "SOIC-8")
  - `full` (boolean, optional, default true): Include all fields
- Output: Array of component objects with LCSC code, manufacturer, package, description, stock, and price

## Agent Integration
- The `parts-scout` subagent has exclusive access to the jlcsearch tool
- It translates design requirements into search queries
- Returns structured component selections with justification
- Main agent uses selections to inform tscircuit code generation

## Constraints
- Rate limiting: Be respectful of jlcsearch API (no parallel burst queries)
- Prefer in-stock components (stock > 0)
- Prefer "basic" JLCPCB parts for lower assembly cost when possible
