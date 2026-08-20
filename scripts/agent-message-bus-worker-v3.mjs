import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sourcePath=path.resolve('scripts/agent-message-bus-worker-v2.mjs');
const runtimePath=path.resolve('scripts/.agent-message-bus-worker-v3-runtime.mjs');
let source=await fs.readFile(sourcePath,'utf8');

const oldBirth=`    agentId = created?.agentId || created?.id;\n    if (!agentId) throw new Error('create_agent returned no id');`;
const newBirth=`    agentId = created?.agentId || created?.id || null;\n    if (!agentId) {\n      // n8n MCP create_agent may return an editor URL instead of an id. Read the durable object back by exact name.\n      for (let attempt = 1; attempt <= 6 && !agentId; attempt += 1) {\n        await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 500 * attempt)));\n        const afterCreate = await tool('search_agents', { projectId, query: candidate.name, limit: 50 });\n        const afterRows = Array.isArray(afterCreate?.data) ? afterCreate.data : (Array.isArray(afterCreate?.agents) ? afterCreate.agents : []);\n        const exactAfter = afterRows.filter((row) => row?.name === candidate.name);\n        if (exactAfter.length > 1) throw new Error('Duplicate synergy child after create ' + candidate.name);\n        agentId = exactAfter[0]?.id || exactAfter[0]?.agentId || null;\n      }\n    }\n    if (!agentId) throw new Error('create_agent durable readback returned no id');`;
if(!source.includes(oldBirth))throw new Error('v2 birth patch target not found');
source=source.replace(oldBirth,newBirth);
source=source.replace("const model = 'groq/openai/gpt-oss-120b';","const model = 'groq/openai/gpt-oss-20b';");
source=source.replaceAll("{ provider: 'groq', id: 'openai/gpt-oss-120b' }","{ provider: 'groq', id: 'openai/gpt-oss-20b' }");
await fs.writeFile(runtimePath,source);
try{await import(`${pathToFileURL(runtimePath).href}?v=${Date.now()}`);}finally{await fs.unlink(runtimePath).catch(()=>{});}
