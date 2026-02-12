# Core Beliefs

## On Specifications
- Specs are the source of truth for system behavior.
- Specs are living documents — update them when reality diverges.
- Every spec must be verifiable: if you can't test it, it's not a spec.

## On Planning
- Plans before code. Complex work gets an ExecPlan.
- Plans are self-contained: a complete novice should be able to implement from just the plan.
- Plans are living documents with progress, surprises, decisions, and outcomes.

## On Quality
- Verification over trust. Observable outcomes over assertions.
- Fix the system, not the symptom. If a bug recurs, the process failed.
- Grade honestly. The quality scorecard only works if grades reflect reality.

## On Context
- Context is scarce. Don't waste it on stale or redundant information.
- The repository is the memory. Write artifacts to disk, not just to chat.
- Stale docs are worse than no docs. Update or delete.

## On Implementation
- Depth-first. Finish one thing before starting another.
- Small, verifiable steps. Each commit should be independently testable.
- Idempotent and safe. Every operation should be safe to retry or rollback.

## On Simplicity
- Design for removal. The best code is the code you don't write.
- Selective documentation. Document decisions, not obvious code.
- Start simple. Add complexity only when forced by verified requirements.
