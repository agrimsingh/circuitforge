# Implement and Verify Workflow

## Purpose
Multi-agent review loop to catch issues before they reach production.

## Steps

1. **Implement**: Write the code according to the spec.
2. **Self-review**: Re-read your own code. Check for:
   - Does it match the spec?
   - Are there edge cases?
   - Is error handling complete?
3. **Fix**: Address any issues found in self-review.
4. **Verify**: Run tests if they exist. Check linter output.
5. **Update docs**: Update quality.md grades and TODO.md status.

## When to Use
- Any new feature implementation
- Bug fixes that touch multiple files
- Refactors that change interfaces

## Max Rounds
3 rounds of self-review. If still failing after 3, escalate to user.
