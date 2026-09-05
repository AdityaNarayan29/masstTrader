# Documentation index

| Document | What it covers | Audience |
| --- | --- | --- |
| [../README.md](../README.md) | What the platform is, features, API reference, quick start | Everyone - start here |
| [../SKILLS.md](../SKILLS.md) | **Production-readiness tracker.** Prioritised work with status, updated after every completed item | Whoever is working on it next |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | System internals - modules, data flow, agent nodes | Backend contributors |
| [../FeatureRequirements.md](../FeatureRequirements.md) | The V2 autonomous-agent spec: risk rules, RAG, build phases | Product intent, and the source of truth for risk limits |
| [DESIGN.md](DESIGN.md) | Design system - tokens, primitives, layout rules, checklist | Anyone touching the frontend |
| [../deploy/VPS-SETUP.md](../deploy/VPS-SETUP.md) | Windows VPS deployment runbook | Deploying |
| [../deploy/README.md](../deploy/README.md) | Original EC2 deployment notes (historical - that host is gone) | Reference only |

## Conventions

- **`SKILLS.md` is the working document.** Anything unfinished belongs there
  with a status, not in a comment or somebody's memory.
- Every entry in its change log records what was done **and how it was
  verified**. An item is not `DONE` without a verification step that actually ran.
- Documentation that describes code must be updated in the same commit as the
  code. `ARCHITECTURE.md` listed a module that had already been deleted; that
  is the failure mode to avoid.
