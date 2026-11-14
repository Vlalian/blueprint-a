---
type: llm
focus: trace
weight: 1
---

next-actions.md claims both 13-coupon-field and 14-receipt-email (two slots are free once 11 is done) and does not claim 12-checkout-page, because 12 depends on ticket 10 which is not done.
