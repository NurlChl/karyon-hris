import "server-only";
import { createUpgradeCode, LicenseServerError } from "./activation";

export type UpgradeStatus={available:boolean;stage:string;code?:string};
function configuration(){
  const raw=process.env.HRIS_MANAGER_URL,token=process.env.HRIS_MANAGER_TOKEN;
  if(!raw||!token||token.length<32)return null;
  const url=new URL(raw);
  if(url.username||url.password||url.search||url.hash||url.pathname!=="/"||!(["http:","https:"].includes(url.protocol)))throw new LicenseServerError("Konfigurasi pengelola instalasi tidak valid.");
  if(url.protocol==="http:"&&!/^(manager|localhost|127\.0\.0\.1)$/.test(url.hostname))throw new LicenseServerError("Pengelola instalasi harus berada di jaringan internal.");
  return {url:url.origin,token};
}
export async function upgradeStatus():Promise<UpgradeStatus>{
  const config=configuration();if(!config)return {available:false,stage:"unavailable"};
  try{
    const response=await fetch(`${config.url}/v1/upgrade`,{headers:{authorization:`Bearer ${config.token}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3000)});
    if(!response.ok)return {available:false,stage:"unavailable"};
    const data=await response.json();return {available:true,stage:String(data.stage),...(data.code?{code:String(data.code)}:{})};
  }catch{return {available:false,stage:"unavailable"};}
}
export async function startAutomaticUpgrade():Promise<UpgradeStatus>{
  const config=configuration();if(!config)throw new LicenseServerError("Instalasi ini belum memakai pengelola upgrade otomatis. Jalankan installer terbaru satu kali di folder instalasi yang sama.");
  const current=await upgradeStatus();
  if(!current.available)throw new LicenseServerError("Pengelola instalasi belum dapat dihubungi. Coba kembali sebentar lagi.");
  if(["validating","downloading","restarting","checking","rolling_back"].includes(current.stage))return current;
  const {code}=await createUpgradeCode();
  const response=await fetch(`${config.url}/v1/upgrade`,{method:"POST",headers:{authorization:`Bearer ${config.token}`,"content-type":"application/json"},body:JSON.stringify({code}),redirect:"error",signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new LicenseServerError("Upgrade belum dapat dimulai. Coba kembali sebentar lagi.");
  return {available:true,...await response.json()};
}
