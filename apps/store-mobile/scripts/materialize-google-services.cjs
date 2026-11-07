const fs = require("node:fs");
const path = require("node:path");

const secretName = "SKIMA_STORE_GOOGLE_SERVICES_JSON_BASE64";
const encoded = process.env[secretName];
if (!encoded) {
  process.stdout.write("No private Google Services file supplied for store; Android remote push remains unconfigured.\n");
  process.exit(0);
}

const target = path.resolve(__dirname, "../google-services.json");
let config;
try {
  config = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
} catch {
  throw new Error(secretName + " must contain a base64-encoded google-services.json file.");
}
const projectId = config.project_info?.project_id;
const clients = Array.isArray(config.client) ? config.client : [];
const packages = clients
  .map((client) => client?.client_info?.android_client_info?.package_name)
  .filter((value) => typeof value === "string");
if (!projectId || !packages.includes("com.skima.store")) {
  throw new Error("The Google Services file must belong to Android package com.skima.store.");
}
fs.writeFileSync(target, JSON.stringify(config), { encoding: "utf8", mode: 0o600 });
process.stdout.write("Materialised the private Google Services file for store.\n");
