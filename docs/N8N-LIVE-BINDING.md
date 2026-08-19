# n8n Cloud live binding

Canonical instance:

`https://thethr0ne7.app.n8n.cloud`

This instance is registered in `registry/external-runtimes.json` as the external orchestration surface for the bounded Agent Nursery.

## What is already wired in the repository

- instance URL and `/api/v1` public API base;
- import/deploy source: `integrations/n8n/workflows/ai-factory-agent-nursery.json`;
- idempotent create/update client: `scripts/deploy-n8n-agent-nursery.mjs`;
- manual GitHub Actions deployment workflow: `.github/workflows/n8n-agent-nursery-deploy.yml`;
- CI validator: `scripts/validate-live-n8n-binding.mjs`;
- hard A3 autonomy ceiling;
- explicit denial of Root-of-Trust mutation, self-promotion and production-write authority;
- deployment intentionally leaves the n8n workflow inactive.

## Remaining authentication gate

The repository does not contain and must never contain the n8n API key.

Create an n8n API key in the n8n account UI and store it in the GitHub repository Actions secret named `N8N_API_KEY`. Do not paste the key into issues, commits, chat logs, workflow JSON, or source files.

After the secret exists, manually dispatch **Deploy n8n agent nursery gateway** in GitHub Actions. The action creates or updates the workflow but does not activate it.

## Activation gate

Do not activate the production webhook while it is unauthenticated. Before activation:

1. attach an n8n webhook authentication credential or place the webhook behind an authenticated Factory gateway;
2. verify that only the six nursery actions are accepted;
3. verify A4-A7 are blocked at the n8n boundary;
4. verify Root-of-Trust mutation and self-promotion remain denied;
5. perform a test candidate cycle with no production write authority;
6. record the resulting execution/evaluation evidence in Factory.

The six accepted orchestration actions are:

- `spawn_candidate`
- `start_training`
- `submit_evaluation`
- `request_repair`
- `quarantine_candidate`
- `request_promotion_review`

None of these actions grants production promotion. Promotion remains a Factory/owner gate.

## Security note

n8n can run powerful nodes. Treat external workflow payloads, Code-node output, HTTP responses and AI-node output as untrusted evidence. They cannot override Factory policy or Root of Trust.
