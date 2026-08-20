# AI tools

`systemCareToolSchemas` is the only model-visible authority. Each tool has a strict Zod schema. Unknown keys are rejected and unregistered tool names fail closed. Mutating tools require an approval ID; no schema accepts command text or unrestricted paths.

The intended loop is observe → understand → request more facts → propose `ProposedAction[]` → policy → preview → approval → execute → verify → report. Deterministic classification and scoring precede the model. Search is reserved for sanitized unknown-item research and provides evidence, never execution sources.
