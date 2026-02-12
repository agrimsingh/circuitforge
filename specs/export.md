# Export Spec

## Overview
Hybrid export pipeline: client compiles tscircuit code to Circuit JSON, server converts to manufacturing files, returns as zip.

## Flow
1. Client sends tscircuit code to `POST https://compile.tscircuit.com/api/compile`
   - Body: `{ fs_map: { "main.tsx": "<code>" } }`
   - Response: `{ circuit_json: [...] }`
2. Client sends Circuit JSON to `POST /api/export`
   - Body: `{ circuit_json: [...] }`
3. Server converts and returns zip

## Server Conversion (`/api/export`)

### Libraries
- `circuit-json-to-gerber`: Gerber files + Excellon drill files
- `circuit-json-to-bom-csv`: Bill of Materials CSV
- `circuit-json-to-pnp-csv`: Pick and Place CSV

### Zip Contents
```
circuitforge-export.zip
├── gerbers/
│   ├── *.gbr (one per layer)
│   ├── plated.drl
│   └── unplated.drl
├── bom.csv
└── pnp.csv
```

### Error Handling
- Invalid Circuit JSON → 400 with error details
- Conversion failure → 500 with partial results if possible

## Design Decisions
- **Why hybrid**: tscircuit Compile API handles the heavy JSX→CircuitJSON step (avoids bundling tscircuit on our server). Gerber/BOM/PNP conversion is lightweight JS.
- **Why not all client-side**: Gerber conversion libraries may be large; server keeps client bundle lean.
- **Why not all server-side**: Compile API is already hosted and maintained by tscircuit team.
