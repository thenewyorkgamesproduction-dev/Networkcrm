# Network Intelligence v0.6

## Core principle

Language understanding extracts evidence. Transparent formulas calculate stable, explainable scores. The original note remains the source of truth and every computed score must expose its supporting evidence.

## Score families

### Overall affinity (0–100)
Measures the strength and quality of the relationship across contexts.

- Trust and closeness: 25%
- Positive enthusiasm in notes: 20%
- Reliability and follow-through: 15%
- Repeated interaction: 15%
- Shared values and social compatibility: 10%
- Strategic or community value: 10%
- Recency and evidence confidence: 5%

Audience size must never dominate overall affinity. A poor event affects reliability or event fit, not the entire relationship.

### Topic interest (0–100)
Measures genuine interest in a topic such as poker, werewolf, startups, film, or content.

- Demonstrated behavior: 30%
- Expressed enthusiasm: 25%
- Repetition and consistency: 15%
- Recency: 10%
- Specificity: 10%
- Interpretation confidence: 10%

Negative evidence is applied after the positive components. Negation, discontinued interest, reluctance, and explicit dislike must be detected.

### Occasion fit (0–100)
Default event recommendation formula:

- Topic fit: 35%
- Overall affinity: 20%
- Reliability: 15%
- Social/event fit: 15%
- Reachability: 5%
- Group contribution: 10%

Occasion templates can change these weights. Intimate dinners emphasize affinity and social compatibility. Large poker nights emphasize poker interest, skill, energy, and reliability. Sponsor events emphasize trust and strategic relevance.

## Structured evidence record

Each meaningful statement should produce zero or more evidence records:

```ts
{
  evidence_id: string;
  person_id: string;
  source_memory_id: string;
  topic: string;
  dimension: "interest" | "behavior" | "relationship" | "reliability" | "social_fit" | "strategic_value";
  sentiment: number;          // -1 to 1
  enthusiasm: number;        // 0 to 1
  behavior_strength: number; // 0 to 1
  specificity: number;       // 0 to 1
  certainty: number;         // 0 to 1
  temporal_state: "current" | "recent" | "historical" | "stopped" | "unknown";
  evidence_type: string;
  evidence_text: string;
  created_at: string;
}
```

## Language interpretation

The parser must consider full phrases and context, not isolated keywords.

Signals include:

- Intensifiers: obsessed, favorite, absolutely loves, extremely interested
- Moderate interest: enjoys, likes, interested in
- Curiosity: wants to learn, might try, curious about
- Behavior: plays weekly, hosts, attends, teaches, competes, organizes
- Softeners: sometimes, casually, somewhat, maybe
- Negation: does not like, no longer interested, stopped playing
- Uncertainty: I think, possibly, might enjoy
- Recency: recently, last month, used to, years ago
- Occasion constraints: good with beginners, too competitive, brings energy, unreliable

Repeated behavioral evidence should usually outweigh a single enthusiastic adjective.

## Confidence

Scores expose a confidence level:

- High: multiple recent, specific, consistent evidence records
- Medium: one strong or several weak records
- Low: sparse, old, uncertain, or conflicting evidence

Low confidence must not be presented as certainty.

## Search behavior

When the user searches a recognized topic, results sort primarily by that topic's fit score. Overall affinity remains visible as a separate score.

Example:

- Richard Ens: Poker fit 90, overall affinity 72
- Mei Zhang: Poker fit 20, overall affinity 88

Each result displays a prominent strength meter and an expandable explanation.

## Suggested additions

Recommendations optimize for both individual quality and occasion relevance:

- Occasion/topic fit
- Overall affinity
- Reliability
- Reachability
- Group contribution
- Diversity of social circles and experience levels
- Exclusion of existing list members

Recommendations must include reasons and avoid selecting only the individually highest scores when doing so would create a poor room.

## Duplicate detection

- Certain: same normalized phone, email, or Instagram
- Probable: similar name plus matching company, role, or overlapping contact data
- Possible: similar name plus overlapping memories or interests

Never merge automatically based on name similarity alone. Merges require user review.

## Contact and follower parsing

The contact editor supports name, phone, email, Instagram, follower count, role, company, where met, summary, last contacted, and affinity override.

Follower strings normalize as follows:

- 120k -> 120000
- 1.2m -> 1200000
- 85,000 followers -> 85000
- about 30K on Instagram -> 30000

## Manual corrections

Corrections become explicit evidence or overrides. They never silently destroy historical notes.

Examples:

- Not actually interested in poker
- Ignore this old note
- Great generally, but not for competitive events
- Manual overall affinity override
- Manual topic-fit override

## Delivery sequence

1. Add evidence and score storage safely
2. Parse follower counts and structured language evidence
3. Compute topic interest and overall affinity
4. Expose explanations and confidence through the API
5. Add topic-fit meters and sorting to search
6. Add the complete contact editor
7. Add duplicate review and merge workflow
8. Add list-specific suggested additions
9. Add occasion templates and group-aware ranking
10. Add recalculation and manual correction tools
