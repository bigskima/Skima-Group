import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";
const pwaInstallScript = "(() => {\n  if (window.__skimaPwaReady) return;\n  window.__skimaPwaReady = true;\n  if (\"serviceWorker\" in navigator) navigator.serviceWorker.register(\"/service-worker.js\", { scope: \"/\" }).catch(() => {});\n  const standalone = (window.matchMedia && window.matchMedia(\"(display-mode: standalone)\").matches) || navigator.standalone === true;\n  if (standalone) return;\n  const ua = navigator.userAgent || \"\";\n  const isIos = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === \"MacIntel\" && navigator.maxTouchPoints > 1);\n  const isAndroid = /Android/i.test(ua);\n  if (!isIos && !isAndroid) return;\n  let deferredPrompt = null;\n  const banner = document.createElement(\"aside\");\n  banner.setAttribute(\"role\", \"region\");\n  banner.setAttribute(\"aria-label\", \"Install SKIMA Store\");\n  banner.style.cssText = \"position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:2147483647;box-sizing:border-box;max-width:540px;margin:0 auto;padding:13px 12px 13px 15px;border:1px solid #e6e6e8;border-radius:17px;background:#fff;color:#17171a;box-shadow:0 7px 25px rgba(0,0,0,.18);display:flex;align-items:center;gap:10px;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;\";\n  const copy = document.createElement(\"div\"); copy.style.cssText = \"flex:1;min-width:0;\";\n  const eyebrow = document.createElement(\"div\"); eyebrow.textContent = \"SKIMA ON YOUR HOME SCREEN\"; eyebrow.style.cssText = \"font-size:8px;font-weight:900;letter-spacing:1px;color:#b11d2d;margin-bottom:3px;\";\n  const title = document.createElement(\"div\"); title.textContent = \"Install SKIMA Store\"; title.style.cssText = \"font-size:14px;line-height:18px;font-weight:900;color:#17171a;\";\n  const message = document.createElement(\"div\"); message.textContent = \"Open SKIMA from your phone like an app. No app-store download is required.\"; message.style.cssText = \"font-size:10px;line-height:14px;color:#55555d;margin-top:3px;\";\n  copy.append(eyebrow,title,message);\n  const actions = document.createElement(\"div\"); actions.style.cssText = \"display:flex;align-items:center;gap:7px;flex-shrink:0;\";\n  const install = document.createElement(\"button\"); install.type=\"button\"; install.textContent=\"How to install\"; install.style.cssText=\"min-height:38px;padding:0 12px;border:0;border-radius:11px;background:#e21d2e;color:#fff;font-size:10px;font-weight:900;white-space:nowrap;\";\n  const close = document.createElement(\"button\"); close.type=\"button\"; close.textContent=\"×\"; close.setAttribute(\"aria-label\",\"Dismiss install suggestion\"); close.style.cssText=\"width:27px;height:34px;border:0;background:transparent;color:#707078;font-size:23px;line-height:25px;\";\n  actions.append(install,close); banner.append(copy,actions);\n  const showInstructions = () => { message.textContent=isIos ? \"In Safari, tap Share, choose “Add to Home Screen”, then confirm with Add.\" : \"Open your browser menu (⋮) and choose “Install app” or “Add to Home screen”.\"; install.textContent=\"Got it\"; };\n  install.addEventListener(\"click\",async()=>{ if(!deferredPrompt){showInstructions();return;} try{await deferredPrompt.prompt();const choice=await deferredPrompt.userChoice;deferredPrompt=null;if(choice.outcome===\"accepted\")banner.remove();else showInstructions();}catch{showInstructions();} });\n  close.addEventListener(\"click\",()=>banner.remove());\n  window.addEventListener(\"beforeinstallprompt\",(event)=>{event.preventDefault();deferredPrompt=event;install.textContent=\"Install\";});\n  window.addEventListener(\"appinstalled\",()=>banner.remove());\n  const mount=()=>{if(document.body&&!banner.isConnected)document.body.appendChild(banner);};\n  if(document.readyState===\"loading\")document.addEventListener(\"DOMContentLoaded\",mount,{once:true});else mount();\n})();";
export default function RootHtml({ children }: PropsWithChildren) {
  return (
    <html lang="en-NG">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="theme-color" content="#E21D2E" />
        <meta name="description" content="Shop products and manage your SKIMA Store orders." />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="SKIMA Store" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="icon" type="image/png" href="/icons/skima-app-icon.png" />
        <link rel="apple-touch-icon" href="/icons/skima-app-icon.png" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <title>SKIMA Store</title>
        <script dangerouslySetInnerHTML={{ __html: pwaInstallScript }} />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
