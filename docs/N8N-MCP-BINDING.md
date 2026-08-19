# n8n instance-level MCP binding

Canonical endpoint:

`https://thethr0ne7.app.n8n.cloud/mcp-server/http`

This endpoint is the n8n instance-level MCP server. It is not a webhook and it is not the n8n REST API.

## Intended Factory role

The MCP connection is the preferred interactive control surface for the bounded Agent Nursery. Subject to permissions granted by n8n, an authenticated MCP client can discover workflows, inspect workflow details, execute/test exposed workflows, and on supported n8n versions create or edit workflows. Production publication remains a separate controlled action.

## Authentication

Preferred interactive mode: OAuth.

Non-interactive fallback: an n8n MCP access token supplied as a bearer token. Store it only in a secret store under `N8N_MCP_TOKEN`. Never commit it.

The older `N8N_API_KEY` path remains only as a bootstrap/deployment fallback for the REST API workflow deployer.

## Factory authority boundary

The MCP transport does not grant authority by itself. Factory keeps the existing limits:

- maximum nursery autonomy: A3;
- no Root-of-Trust mutation;
- no self-promotion;
- no implicit production write authority;
- no secret-scope expansion;
- no automatic workflow publication;
- every side effect must remain traceable and attributable.

## n8n exposure model

Instance-level MCP does not mean every workflow is fully exposed. n8n requires MCP access to be enabled at the instance level and individual workflows must be made available before full details/execution are accessible. Workflow search may return previews for workflows the authenticated user can view.

## Bootstrap sequence

1. Enable Instance-level MCP in n8n.
2. Connect an MCP client using OAuth (preferred) or a bearer MCP token.
3. Confirm the client can search workflows.
4. Create or import `AI Factory Agent Nursery Gateway` while keeping it unpublished.
5. Enable MCP access only for the bounded nursery workflows that Factory needs.
6. Test the workflow in manual/test mode.
7. Verify Factory authority checks and trace evidence.
8. Publish only after an explicit release gate.

## Current state

The server URL is bound in `registry/external-runtimes.json`. Authentication is not stored in the repository, so the repository alone cannot claim a live authenticated MCP session.
