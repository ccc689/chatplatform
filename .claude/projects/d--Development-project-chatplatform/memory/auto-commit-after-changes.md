---
name: auto-commit-after-changes
description: Claude should git commit after completing each round of code changes
metadata:
  type: feedback
  project: chatplatform
---

Always run `git add -A && git commit -m "<description>"` after completing a meaningful set of code changes. After EVERY session where code was modified, there should be a new commit.

Commit message format: short Chinese description of what was changed/fixed/added, in imperative mood.

If GitHub is unreachable (network issues), the local commit still persists — push can be retried later with `git push origin main`.

**Why:** The user had multiple sessions of code changes (1000+ lines) that were all lost as intermediate snapshots because no intermediate commits were made. They want each change round to have its own save point.

**How to apply:** After finishing each batch of code changes and before reporting completion, run:
```bash
git add -A && git commit -m "<description>"
git push origin main  # if network allows
```
If push fails due to network, note it but the local commit is saved.
