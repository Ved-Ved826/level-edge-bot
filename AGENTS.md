\# Project Agent Rules



\- Work from repository root.

\- Never claim a check passed unless you actually ran it.

\- Never hide errors.

\- Never swallow exceptions in user-facing flows.

\- Never commit secrets.

\- Preserve multi-guild isolation.

\- Every query involving guild-scoped data must respect guild\_id.

\- Treat concurrency as a first-class concern.

\- Deferred Discord interactions must always receive a final response.

\- Do not solve root-cause bugs with arbitrary delays or retries.

\- Prefer existing project abstractions over duplicating systems.

\- Do not add dependencies unless justified.

\- Run build/typecheck/tests after meaningful changes.

\- Re-read modified files after editing.

\- Review git diff before committing.

\- Do not perform destructive git operations without necessity.

\- Before declaring completion, perform an adversarial review.

