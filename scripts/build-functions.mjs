import { build } from "esbuild";

await build({
  entryPoints: [
    "netlify/functions/mcp.ts",
    "netlify/functions/oauth-authorize.ts",
    "netlify/functions/oauth-token.ts",
    "netlify/functions/oauth-register.ts",
  ],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outdir: "functions-built",
  logLevel: "info",
});

console.log("Functions bundled to functions-built/");
