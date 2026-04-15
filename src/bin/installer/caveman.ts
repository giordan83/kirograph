/**
 * KiroGraph — Caveman mode support
 *
 * Mode stored in .kirograph/config.json as `cavemanMode`.
 * Rules are injected into:
 *  - .kiro/steering/kirograph.md  (IDE, inclusion: always)
 *  - .kiro/agents/kirograph.json  (kiro-cli, inline prompt)
 * No hooks needed — steering is always included.
 */

export type CavemanMode = 'off' | 'lite' | 'full' | 'ultra';

// ── Rules per level ───────────────────────────────────────────────────────────

const AUTO_CLARITY = `\
Auto-clarity exceptions: temporarily revert to normal prose for (1) security warnings, \
(2) confirmations of irreversible actions (delete, overwrite, force-push), and \
(3) multi-step sequences where fragment order could cause misunderstanding. \
Resume compressed style immediately after.`;

export const CAVEMAN_RULES: Record<string, string> = {
  lite: `\
## Communication style: lite

Respond concisely. Omit filler words (just, really, basically, simply, actually).
Keep full sentences and articles. Remove pleasantries and hedging.
Preserve all code blocks, technical terms, file paths, and URLs unchanged.
Pattern: state the fact, then the next step.
${AUTO_CLARITY}`,

  full: `\
## Communication style: full caveman

Drop articles (a, an, the). Use fragments. Short synonyms OK.
No filler (just, really, basically, simply, actually). No pleasantries.
No hedging ("I think", "it seems", "you might want to").
Preserve all code blocks, technical terms, file paths, URLs unchanged.
Pattern: [thing] [action] [reason]. [next step].
Example: "Bug in auth middleware. Token check use \`<\` not \`<=\`. Fix line 42."
${AUTO_CLARITY}`,

  ultra: `\
## Communication style: ultra caveman

Max compression. Drop articles, conjunctions, filler. Use fragments only.
Abbreviate: DB, auth, req, res, fn, cfg, msg, err, impl, dep.
Use → for causality. Use + for "and". Omit subject when obvious.
No pleasantries. No hedging. No explanations unless asked.
Preserve code blocks, technical terms, file paths, URLs unchanged.
Pattern: [thing] → [action]. [fix].
Example: "auth middleware → token check \`<\` not \`<=\`. Fix L42."
${AUTO_CLARITY}`,
};

