# Repo Intake / Runability Gate

## Purpose

Understand an existing repository before changing it and prove that the local/CI execution path is real.

## Activate when

The task modifies an existing codebase or claims a repository is ready/runnable.

## Workflow

1. Confirm repository identity, default branch and intended product.
2. Inspect top-level structure, package/build files, runtime entry points and documentation.
3. Identify generated/vendor/archive areas and protected paths.
4. Read current CI/workflow/build commands and environment requirements.
5. Locate relevant tests and product routes.
6. Run or inspect the narrowest credible runability checks available.
7. Record baseline failures before making changes.
8. Produce verified scope for Engineering Kernel.

## Gate

Return:

- `READY` — repository identity and execution path are verified;
- `CONDITIONAL` — repository is understood but some check cannot run;
- `BLOCKED` — wrong folder/repo, missing source, missing required dependency or no credible execution path.

## Guardrails

- Never create a greenfield replacement when the task is to modify an existing repository unless explicitly authorized.
- Do not claim runtime verification from static inspection alone.
- Separate environment failure from product-code failure.
