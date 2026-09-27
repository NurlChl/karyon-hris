import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { UpgradeManager } from "./manager.mjs";

const token=process.env.HRIS_MANAGER_TOKEN||"",agentToken=process.env.HRIS_AGENT_TOKEN||"";
if(token.length<32||agentToken.length<32)throw new Error("Manager and agent tokens must be configured");
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
function run(args,input){return new Promise((resolve,reject)=>{
  const child=spawn("docker",args,{stdio:["pipe","pipe","ignore"],shell:false,env:{...process.env,COMPOSE_PATH_SEPARATOR:":"}});
  let output="";child.stdout.on("data",chunk=>{if(output.length<16384)output+=chunk.toString().slice(0,16384-output.length);});
  const timer=setTimeout(()=>{child.kill("SIGKILL");reject(new Error("DOCKER_TIMEOUT"));},15*60_000);
  child.once("error",()=>{clearTimeout(timer);reject(new Error("DOCKER_UNAVAILABLE"));});
  child.once("exit",code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error("DOCKER_FAILED"));});
  child.stdin.on("error",()=>{});child.stdin.end(input||"");
});}
const manager=new UpgradeManager({licenseServer:process.env.HRIS_LICENSE_SERVER,siteOrigin:process.env.HRIS_SITE_URL,project:process.env.HRIS_COMPOSE_PROJECT||"hris",run,
  health:async pro=>{
    const base=process.env.HRIS_APP_URL||"http://app:3000";
    const response=await fetch(`${base}/api/v1/health`,{signal:AbortSignal.timeout(5000),redirect:"error"});
    if(!response.ok)return false;
    if(!pro)return true;
    const license=await fetch(`${base}/api/v1/license/lease`,{headers:{authorization:`Bearer ${agentToken}`},signal:AbortSignal.timeout(5000),redirect:"error"});
    if(!license.ok)return false;const state=await license.json();return state.edition==="pro"&&["active","grace"].includes(state.status);
  }});
await manager.initialize();
createServer(async(req,res)=>{
  res.setHeader("content-type","application/json");res.setHeader("cache-control","no-store");
  const send=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
  if(!equal(req.headers.authorization||"",`Bearer ${token}`))return send(401,{error:"unauthorized"});
  if(req.method==="GET"&&req.url==="/v1/upgrade")return send(200,{stage:manager.state.stage,code:manager.state.code});
  if(req.method!=="POST"||req.url!=="/v1/upgrade")return send(404,{error:"not_found"});
  try{
    let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>1024)return send(413,{error:"too_large"});}
    const body=JSON.parse(raw);if(Object.keys(body).length!==1||typeof body.code!=="string")return send(400,{error:"invalid_input"});
    const started=manager.start(body.code);
    if(started)manager.completion.catch(()=>console.error("Upgrade state could not be persisted"));
    return send(202,{stage:started?"validating":manager.state.stage});
  }catch{return send(400,{error:"invalid_input"});}
}).listen(3210,"0.0.0.0");
