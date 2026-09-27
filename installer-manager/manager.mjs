import { readFile, writeFile, rename, mkdir, mkdtemp, rm, stat, chown } from "node:fs/promises";
import { join } from "node:path";

const imagePattern=/^[a-zA-Z0-9][a-zA-Z0-9./:_@-]{0,254}$/;
export function validServer(value) {
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname!=="/"||!(url.protocol==="https:"||(url.protocol==="http:"&&["localhost","127.0.0.1"].includes(url.hostname))))throw new Error("INVALID_LICENSE_SERVER");
  return url.origin;
}
export function replaceImage(env,image) {
  if(!imagePattern.test(image))throw new Error("INVALID_IMAGE");
  if(!/^HRIS_IMAGE=.+$/m.test(env))throw new Error("INSTALLATION_NOT_FOUND");
  return env.replace(/^HRIS_IMAGE=.*$/m,`HRIS_IMAGE=${image}`);
}
export class UpgradeManager {
  constructor({directory="/installation",data="/data",licenseServer,siteOrigin,project,run,fetcher=fetch,health,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
    this.directory=directory;this.data=data;this.server=validServer(licenseServer);this.origin=new URL(siteOrigin).origin;
    if(!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project))throw new Error("INVALID_PROJECT");
    this.project=project;this.run=run;this.fetcher=fetcher;this.health=health;this.delay=delay;this.state={stage:"idle"};this.running=false;
  }
  async save(state){this.state={...state,updatedAt:new Date().toISOString()};await mkdir(this.data,{recursive:true,mode:0o700});await writeFile(join(this.data,"status.json"),JSON.stringify(this.state),{mode:0o600});}
  async initialize(){
    try{this.state=JSON.parse(await readFile(join(this.data,"status.json"),"utf8"));}catch(error){if(error.code!=="ENOENT")throw error;}
    if(["validating","downloading","restarting","checking","rolling_back"].includes(this.state.stage)){
      // A process crash during a switch must restore the previous image before accepting another job.
      if(this.state.previousImage&&["restarting","checking","rolling_back"].includes(this.state.stage)){
        try{await this.setImage(this.state.previousImage);await this.startApp();await this.waitHealthy();await this.save({stage:"failed",code:"INTERRUPTED_ROLLED_BACK"});}
        catch{await this.save({stage:"failed",code:"ROLLBACK_FAILED"});}
      }else await this.save({stage:"failed",code:"INTERRUPTED"});
    }
  }
  async setImage(image){
    const file=join(this.directory,".env"),env=await readFile(file,"utf8"),owner=await stat(file);
    await writeFile(`${file}.upgrade.tmp`,replaceImage(env,image),{mode:0o600});
    if(process.platform!=="win32")await chown(`${file}.upgrade.tmp`,owner.uid,owner.gid);
    await rename(`${file}.upgrade.tmp`,file);
  }
  async composeArgs(){
    const args=["compose","--project-name",this.project,"--project-directory",this.directory,"--env-file",join(this.directory,".env"),"-f",join(this.directory,"compose.image.yml"),"-f",join(this.directory,"compose.manager.yml")];
    const env=await readFile(join(this.directory,".env"),"utf8");
    const files=/^COMPOSE_FILE=(.*)$/m.exec(env)?.[1]||"";
    if(files.includes("compose.external.yml"))args.push("-f",join(this.directory,"compose.external.yml"));
    if(files.includes("compose.lifecycle.yml"))throw new Error("LEGACY_LIFECYCLE_LAYOUT");
    return args;
  }
  async startApp(){await this.run([...(await this.composeArgs()),"up","-d","--no-deps","--pull","never","app"]);}
  async waitHealthy(pro=false){for(let attempt=0;attempt<60;attempt++){if(await this.health(pro).catch(()=>false))return;await this.delay(3000);}throw new Error("HEALTH_CHECK_FAILED");}
  start(code){
    if(this.running)return false;
    if(!/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/.test(code))throw new Error("INVALID_CODE");
    this.running=true;
    this.completion=this.upgrade(code).finally(()=>{this.running=false;});return true;
  }
  async upgrade(code){
    let previousImage,switched=false,config;
    try{
      await this.save({stage:"validating"});
      await this.composeArgs();
      const env=await readFile(join(this.directory,".env"),"utf8");
      previousImage=/^HRIS_IMAGE=(.+)$/m.exec(env)?.[1].trim();
      if(!previousImage||!imagePattern.test(previousImage))throw new Error("INSTALLATION_NOT_FOUND");
      // Pin the running image, not its mutable tag: pulling :latest must not
      // overwrite the only rollback target.
      const container=String(await this.run([...(await this.composeArgs()),"ps","--all","--quiet","app"])).trim();
      if(!/^[a-f0-9]{12,64}$/.test(container))throw new Error("INSTALLATION_NOT_FOUND");
      const runningImage=String(await this.run(["inspect","--format","{{.Image}}",container])).trim();
      if(!/^sha256:[a-f0-9]{64}$/.test(runningImage))throw new Error("INSTALLATION_NOT_FOUND");
      previousImage=runningImage;
      const response=await this.fetcher(`${this.server}/api/licenses/upgrade`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code}),redirect:"error",signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error("LICENSE_REJECTED");
      const {data:credentials}=await response.json();
      if(credentials?.siteOrigin!==this.origin||!/^inst_[A-Za-z0-9_-]{16,128}$/.test(credentials.username)||typeof credentials.password!=="string"||credentials.password.length<32||!imagePattern.test(credentials.image)||!/^([a-z0-9-]+\.)+[a-z0-9-]+(?::\d{2,5})?$/.test(credentials.registry)||!credentials.image.startsWith(`${credentials.registry}/`))throw new Error("INVALID_DISTRIBUTION");
      config=await mkdtemp(join(this.data,"registry-"));
      await this.run(["--config",config,"login",credentials.registry,"--username",credentials.username,"--password-stdin"],credentials.password);
      await this.save({stage:"downloading",previousImage});
      await this.run(["--config",config,"pull",credentials.image]);
      // Persist the rollback target before changing the installation. Pull never stops the current app.
      await this.save({stage:"restarting",previousImage});switched=true;
      await this.setImage(credentials.image);await this.startApp();
      await this.save({stage:"checking",previousImage});await this.waitHealthy(true);
      await this.save({stage:"complete"});
    }catch(error){
      let failure=["LICENSE_REJECTED","INVALID_DISTRIBUTION","INSTALLATION_NOT_FOUND","LEGACY_LIFECYCLE_LAYOUT"].includes(error.message)?error.message:"UPGRADE_FAILED";
      if(switched&&previousImage){
        try{await this.save({stage:"rolling_back",previousImage});await this.setImage(previousImage);await this.startApp();await this.waitHealthy();failure="UPGRADE_ROLLED_BACK";}
        catch{failure="ROLLBACK_FAILED";}
      }
      await this.save({stage:"failed",code:failure});
    }finally{if(config)await rm(config,{recursive:true,force:true});}
  }
}
