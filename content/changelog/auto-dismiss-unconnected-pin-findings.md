---
title: Auto-dismiss unconnected pin review findings
category: fix
createdAt: 2026-02-17
---

Unconnected-pin review findings for generic numbered pins (pin 1, pin 2, etc.) on IC references like U1/U2 no longer require manual Accept/Dismiss in the sidebar. Previously, `shouldTreatUnconnectedPinAsMustRepair` flagged any U-prefixed component as must-repair regardless of pin name, causing benign unused-pin warnings to persist as open findings after every repair loop.

Two fixes were applied: the classification now only flags named functional pins (VIN, VOUT, SDA, etc.) as must-repair while treating generic numbered pins as auto-fixable, and a post-repair-loop sweep auto-dismisses any surviving `kicad_unconnected_pin`, `off_grid`, and `floating_label` findings that the agent couldn't resolve.
