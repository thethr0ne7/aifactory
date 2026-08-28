import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet,jwtVerify,type JWTPayload } from "npm:jose@6";

type Claims=JWTPayload&{repository?:string;repository_id?:string;ref?:string;event_name?:string;workflow_ref?:string;job_workflow_ref?:string};
type Body={n8n_mcp_token?:string};
const SUPABASE_URL=mustEnv("SUPABASE_URL");
const db=createClient(SUPABASE_URL,adminKey(),{auth:{persistSession:false,autoRefreshToken:false}});
const ISSUER="https://token.actions.githubusercontent.com";
const JWKS=createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const AUDIENCE="aifactory-hot-runtime-bootstrap";
const EXPECTED_REPOSITORY="thethr0ne7/aifactory";
const EXPECTED_REPOSITORY_ID="1334997374";
const EXPECTED_REF="refs/heads/main";
const EXPECTED_WORKFLOW="thethr0ne7/aifactory/.github/workflows/agent-organization.yml@refs/heads/main";

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  try{
    await authenticate(req);
    const body=await safeJson<Body>(req);const token=String(body.n8n_mcp_token||"");
    if(token.length<20)return json({error:"runtime_token_required"},400);
    const {data,error}=await db.rpc("af_set_runtime_secret",{p_name:"n8n_mcp_token",p_secret:token});if(error)throw error;
    return json({ok:data===true,stored:"n8n_mcp_token",storage:"supabase-vault"});
  }catch(error){const msg=safeError(error);return json({error:msg.startsWith("oidc_")?"unauthorized":"bootstrap_failed",detail:msg},msg.startsWith("oidc_")?401:500);}
});
async function authenticate(req:Request){const token=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token)throw new Error("oidc_missing");const {payload}=await jwtVerify(token,JWKS,{issuer:ISSUER,audience:AUDIENCE,algorithms:["RS256"],clockTolerance:10});const c=payload as Claims;if(c.repository!==EXPECTED_REPOSITORY||c.repository_id!==EXPECTED_REPOSITORY_ID)throw new Error("oidc_repository");if(c.ref!==EXPECTED_REF)throw new Error("oidc_ref");if(String(c.job_workflow_ref??c.workflow_ref??"")!==EXPECTED_WORKFLOW)throw new Error("oidc_workflow");if(!new Set(["push","schedule","workflow_dispatch"]).has(String(c.event_name||"")))throw new Error("oidc_event");}
function adminKey(){const modern=Deno.env.get("SUPABASE_SECRET_KEYS");if(modern){try{const p=JSON.parse(modern);if(p?.default)return String(p.default);}catch{}}return mustEnv("SUPABASE_SERVICE_ROLE_KEY");}function mustEnv(n:string){const v=Deno.env.get(n);if(!v)throw new Error(`missing_env_${n}`);return v;}async function safeJson<T>(r:Request){try{return await r.json() as T;}catch{return{} as T;}}function safeError(e:any){return(e instanceof Error?e.message:String(e)).replace(/[\r\n]+/g," ").slice(0,800);}function json(v:any,s=200){return new Response(JSON.stringify(v),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});}
