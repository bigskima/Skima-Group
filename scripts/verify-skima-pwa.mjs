import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const apps=[
 {key:"refill",dir:"apps/lpg-mobile",name:"SKIMA LPG",short:"SKIMA LPG"},
 {key:"store",dir:"apps/store-mobile",name:"SKIMA Store",short:"SKIMA Store"},
 {key:"bills",dir:"apps/bills-mobile",name:"SKIMA Bills",short:"SKIMA Bills"},
 {key:"logistics",dir:"apps/logistics-mobile",name:"SKIMA Logistics",short:"SKIMA Logi"}
];
const signature=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const read=(p)=>readFileSync(resolve(root,p),"utf8");
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
for(const app of apps){
 const manifest=JSON.parse(read(`${app.dir}/public/manifest.webmanifest`));
 assert(manifest.name===app.name&&manifest.short_name===app.short,`${app.name}: manifest identity`);
 assert(manifest.start_url==="/"&&manifest.scope==="/"&&manifest.display==="standalone",`${app.name}: standalone manifest`);
 assert(manifest.icons?.some(i=>i.src==="/icons/skima-app-icon-192.png"&&i.sizes==="192x192"&&i.type==="image/png"&&i.purpose==="any"),`${app.name}: required 192px install icon`);
 assert(manifest.icons?.some(i=>i.src==="/icons/skima-app-icon-512.png"&&i.sizes==="512x512"&&i.type==="image/png"&&i.purpose.includes("maskable")),`${app.name}: required 512px maskable install icon`);
 const iconPath=resolve(root,app.dir,"public/icons/skima-app-icon.png");
 assert(existsSync(iconPath),`${app.name}: source brand/favicon image missing`);
 const png=readFileSync(iconPath),w=png.readUInt32BE(16),h=png.readUInt32BE(20);
 assert(png.subarray(0,8).equals(signature)&&w===1254&&h===1254,`${app.name}: source brand image format or dimensions`);
 const iconGenerator=read("scripts/generate-skima-pwa-icons.mjs");
 assert(iconGenerator.includes("[180, 192, 512]")&&iconGenerator.includes("generateImageAsync"),`${app.name}: web export must generate platform-sized SKIMA icons`);
 const html=read(`${app.dir}/app/+html.tsx`);
 for(const marker of ['rel="icon"','rel="apple-touch-icon"','rel="manifest"','apple-mobile-web-app-capable','beforeinstallprompt','serviceWorker.register'])assert(html.includes(marker),`${app.name}: HTML missing ${marker}`);
 assert(html.includes('rel="apple-touch-icon" href="/icons/skima-app-icon-180.png"'),`${app.name}: Apple Home Screen icon missing`);
 const sw=read(`${app.dir}/public/service-worker.js`);
 assert(sw.includes(`skima-${app.key}-pwa-shell-v1`) && (sw.includes('request.mode === "navigate"') || sw.includes('request.mode==="navigate"')), `${app.name}: service worker shell`);
 for(const size of [180,192,512])assert(sw.includes(`/icons/skima-app-icon-${size}.png`),`${app.name}: service worker must precache ${size}px icon`);
 assert(sw.includes('request.method !== "GET"') || sw.includes('request.method!=="GET"'), `${app.name}: non-GET requests must bypass cache`);
 assert(sw.includes('if (!isPublicStatic) return;') || sw.includes('if(!allowed)return;'), `${app.name}: service worker must use a static-only allowlist`);
 assert(sw.includes('url.pathname.startsWith("/_expo/static/")')&&sw.includes('url.pathname.startsWith("/assets/")'),`${app.name}: static bundle allowlist`);
 assert(!sw.includes('"/functions/v1/')&&!sw.includes('"/rest/v1/'),`${app.name}: API routes must not be cached`);
 console.log(`PASS ${app.name}: manifest, favicon, Apple icon, install prompt and offline shell`);
}
