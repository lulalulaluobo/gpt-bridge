import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const sdk='/Applications/gpt-bridge.app/Contents/Resources/runtime/dc/node_modules/@modelcontextprotocol/sdk/dist/esm/';
const {Client}=await import(pathToFileURL(sdk+'client/index.js'));
const {StdioClientTransport}=await import(pathToFileURL(sdk+'client/stdio.js'));
const client=new Client({name:'cu-gateway-smoke',version:'0.1'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'tunnel-gateway.mjs')],env:{HOME:process.env.HOME,PATH:'/usr/bin:/bin',CU_PROBE_RUN_DIR:path.join(root,'runtime/smoke')},stderr:'pipe'});
try {
 await client.connect(transport);
 const tools=await client.listTools();
 if(tools.tools.length!==4)throw new Error('Unexpected tools exposed.');
 console.log('Tools:',tools.tools.map(t=>t.name));
 const observation=await client.callTool({name:'cu_probe_observe',arguments:{}},undefined,{timeout:60000});
 const pictures=observation.content.filter(c=>c.type==='image');
 if(observation.isError||pictures.length!==1)throw new Error('Screenshot failed.');
 if(JSON.stringify(observation.content.filter(c=>c.type!=='image')).match(/CU-[A-F0-9]{8}/))throw new Error('Code leaked in text response.');
 const denied=await client.callTool({name:'cu_probe_click',arguments:{pid:1}});
 if(!denied.isError)throw new Error('Unscoped parameter accepted.');
 console.log('PASS: image response, no plaintext code, rejects arbitrary PID, only four scoped tools.');
} finally {await client.close();}
