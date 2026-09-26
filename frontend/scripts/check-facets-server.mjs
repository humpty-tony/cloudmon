// Dedicated browser-check server; isolated worktrees may share node_modules.
import {fileURLToPath} from "node:url";
import {createServer} from "vite";
const server = await createServer({root:fileURLToPath(new URL("..",import.meta.url)),cacheDir:"node_modules/.vite-vector-facets/browser",server:{host:"127.0.0.1",port:5192,strictPort:true}});
await server.listen();
server.printUrls();
for (const signal of ["SIGINT","SIGTERM"]) process.on(signal,async()=>{await server.close();process.exit(0)});
