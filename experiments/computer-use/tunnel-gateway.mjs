import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const root = path.dirname(fileURLToPath(import.meta.url));
const sdkRoot = '/Applications/gpt-bridge.app/Contents/Resources/runtime/dc/node_modules/@modelcontextprotocol/sdk/dist/esm/';
const sdk = p => import(pathToFileURL(sdkRoot + p));
const [{Server}, {StdioServerTransport}, {Client}, {StdioClientTransport}, types] = await Promise.all([
  sdk('server/index.js'), sdk('server/stdio.js'), sdk('client/index.js'), sdk('client/stdio.js'), sdk('types.js')]);
delete process.env.MACBRIDGE_RUNTIME_KEY;
const runDir = process.env.CU_PROBE_RUN_DIR || path.join(root, 'runtime/e2e');
fs.mkdirSync(runDir, {recursive:true, mode:0o700});
const lock = path.join(runDir, 'gateway.lock');
fs.mkdirSync(lock, {mode:0o700}); // fail closed if another gateway owns this experiment
const runID = randomUUID(), started = Date.now();
const code = 'CU-' + randomBytes(4).toString('hex').toUpperCase();
const env = {HOME:process.env.HOME, PATH:'/usr/bin:/bin:/usr/sbin:/sbin', LANG:'en_US.UTF-8'};
const readyPath=path.join(runDir,runID+'.ready');
const gui = spawn(path.join(root,'GPTBridgeTunnelProbe'), [], {env:{...env, CU_VISUAL_CODE:code, CU_RESULT_PATH:path.join(runDir,'result.json'), CU_READY_PATH:readyPath}, stdio:'ignore'});
const guiReady = new Promise((resolve,reject) => { gui.once('spawn',resolve); gui.once('error',reject); });
const transport = new StdioClientTransport({command:path.join(root,'peekaboo/peekaboo-macos-arm64/peekaboo'), args:['mcp','--no-remote'], env, stderr:'pipe'});
transport.stderr?.on('data',b=>fs.appendFileSync(path.join(runDir,'backend.log'),b,{mode:0o600}));
const backend = new Client({name:'gpt-bridge-cu-tunnel-probe',version:'0.1'});
const server = new Server({name:'gpt-bridge-cu-probe',version:'0.1'}, {capabilities:{tools:{}}, instructions:'Only a dedicated test window is available. Read its visual challenge from cu_probe_observe image. Type it once with cu_probe_type, click once with cu_probe_click, then observe the result. Never guess a code if images are unavailable.'});
let busy=false, typed=false, clicked=false, stopped=false, windowID=null, observations=0;
const log = data => fs.appendFileSync(path.join(runDir,'calls.ndjson'),JSON.stringify({at:new Date().toISOString(),runID,...data})+'\n',{mode:0o600});
const text = value => ({content:[{type:'text',text:JSON.stringify(value)}]});
async function observe() {
  if (gui.exitCode !== null || gui.signalCode !== null) throw new Error('Test window has exited.');
  if (++observations > 30) throw new Error('Observation limit reached.');
  const r=await backend.callTool({name:'see', arguments:{app_target:`PID:${gui.pid}`,include_elements:true,...(windowID?{window_id:windowID}:{})}},undefined,{timeout:45000});
  fs.writeFileSync(path.join(runDir,'last-observation.json'),JSON.stringify(r),{mode:0o600});
  if (r.isError || !r._meta?.snapshot_id || !r.content?.some(c=>c.type==='image')) throw new Error('Test window observation failed; no screenshot delivered.');
  const receipt=r._meta.target_receipt;
  if (receipt?.pid !== gui.pid || !receipt.window_id || (windowID && windowID !== receipt.window_id)) throw new Error('Unexpected target identity.');
  windowID=receipt.window_id;
  const images=r.content.filter(c=>c.type==='image').map(c=>({type:'image',mimeType:c.mimeType,data:c.data}));
  fs.writeFileSync(path.join(runDir,`observation-${observations}.png`),Buffer.from(images[0].data,'base64'),{mode:0o600});
  return {snapshot:r._meta.snapshot_id,elements:r._meta.ui_elements,images};
}
const empty={type:'object',properties:{},additionalProperties:false};
server.setRequestHandler(types.ListToolsRequestSchema,async()=>({tools:[
  {name:'cu_probe_info',description:'Status of the dedicated Computer Use experiment; does not disclose the screen code.',inputSchema:empty,annotations:{readOnlyHint:true}},
  {name:'cu_probe_observe',description:'Return only the dedicated test window screenshot. Read the visual code from the IMAGE. No OCR or accessibility text is returned.',inputSchema:empty,annotations:{readOnlyHint:true}},
  {name:'cu_probe_type',description:'Type the screen code you READ FROM THE IMAGE into the dedicated test field, once.',inputSchema:{type:'object',properties:{text:{type:'string',pattern:'^CU-[A-F0-9]{8}$',maxLength:11}},required:['text'],additionalProperties:false}},
  {name:'cu_probe_click',description:'Click the dedicated verification button once. Always observe afterward; never retry a dispatched action.',inputSchema:empty}
]}));
server.setRequestHandler(types.CallToolRequestSchema,async request=>{
  const {name}=request.params, args=request.params.arguments||{};
  if (busy) return {...text({error:'Another call is in progress.'}),isError:true};
  busy=true;
  try {
    if (Date.now()-started>45*60*1000) throw new Error('Experiment expired; restore the normal service.');
    if (!['cu_probe_info','cu_probe_observe','cu_probe_type','cu_probe_click'].includes(name)) throw new Error('Tool unavailable.');
    const keys=Object.keys(args);
    if (name==='cu_probe_type' ? keys.length!==1 || keys[0]!=='text' || !/^CU-[A-F0-9]{8}$/.test(args.text) : keys.length!==0) throw new Error('Invalid arguments.');
    log({tool:name,phase:'started',...(name==='cu_probe_type'?{input:args.text}:{})});
    if(name==='cu_probe_info') return text({runID,scope:'dedicated test window only',typed,clicked,remainingSeconds:Math.max(0,Math.floor((started+45*60*1000-Date.now())/1000))});
    if(name==='cu_probe_observe') {
      const o=await observe(); log({tool:name,phase:'image-returned',images:o.images.length});
      return {content:[{type:'text',text:'Dedicated test window screenshot. Read the code/result visually; no screen text is provided separately.'},...o.images]};
    }
    if(name==='cu_probe_type' && typed) throw new Error('Typing was already dispatched; observe instead.');
    if(name==='cu_probe_click' && (!typed || clicked)) throw new Error('Type first; only one click dispatch is allowed.');
    const o=await observe();
    const element=o.elements.find(e=>name==='cu_probe_type'?e.identifier==='probe-input':e.role==='button'&&e.title==='验证点击');
    if(!element?.is_actionable) throw new Error('Test control not actionable.');
    if(name==='cu_probe_type') typed=true; else clicked=true;
    const r=await backend.callTool({name:name==='cu_probe_type'?'type':'click',arguments:{snapshot:o.snapshot,on:element.id,...(name==='cu_probe_type'?{text:args.text,clear:true}:{})}},undefined,{timeout:45000});
    const state={tool:name,phase:'dispatched',upstreamIsError:!!r.isError,mutationDispatched:r._meta?.mutation_dispatched??null,effect:r._meta?.effect??'unknown',retrySafe:false,next:'cu_probe_observe'};
    log(state); return text(state);
  } catch(e) { log({tool:name,phase:'error',error:String(e.message)});return {...text({error:String(e.message),next:'Observe before any further action; never automatically retry.'}),isError:true}; }
  finally {busy=false;}
});
async function stop(){
  if(stopped)return; stopped=true;
  gui.kill('SIGTERM');
  await backend.close().catch(()=>{}); await server.close().catch(()=>{});
  fs.rmdirSync(lock); process.exit(0);
}
process.on('SIGTERM',stop);process.on('SIGINT',stop);process.stdin.on('end',stop);
try {
  await guiReady;
  for(let attempt=0;attempt<100&&!fs.existsSync(readyPath);attempt++)await delay(50);
  if(!fs.existsSync(readyPath))throw new Error('GUI did not become ready.');
  await backend.connect(transport);
  fs.writeFileSync(path.join(runDir,'run.json'),JSON.stringify({runID,pid:process.pid,guiPID:gui.pid,startedAt:new Date(started).toISOString()}),{mode:0o600});
  await server.connect(new StdioServerTransport());
} catch(e) { console.error('Computer Use experiment startup failed:',e.message);await stop(); }
