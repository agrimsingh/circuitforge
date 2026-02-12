# Safe Refactor Workflow

## Purpose
Refactor code while maintaining behavioral equivalence.

## Steps

1. **Characterize**: Understand current behavior. Read tests, read callers.
2. **Plan**: Describe the refactor in prose. What changes, what stays the same.
3. **Bridge**: If possible, make old and new coexist temporarily.
4. **Refactor**: Make the change in small, verifiable steps.
5. **Verify**: Run tests. Manually verify if no tests exist.
6. **Clean up**: Remove bridge code, update imports, update docs.

## When to Use
- Renaming or reorganizing modules
- Changing data structures
- Extracting shared utilities
- Performance optimizations that change internals

## Safety Checks
- All existing tests must pass after refactor
- No new TypeScript errors
- No new linter warnings
