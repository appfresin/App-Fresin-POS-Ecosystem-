const {spawn}=require('node:child_process');
const fs=require('node:fs');
const cli='C:/Users/Acer Swift/AppData/Local/OpenAI/Codex/bin/f71a721e0e6193a9/codex.exe';
const child=spawn(cli,['app-server','--stdio'],{stdio:['pipe','pipe','pipe']});
let serial=0,buffer='';const pending=new Map();
function request(method,params){return new Promise((resolve,reject)=>{
  const id=++serial;const timeout=setTimeout(()=>{pending.delete(id);reject(Error(`Timeout: ${method}`));},20000);
  pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});
  child.stdin.write(JSON.stringify({id,method,params})+'\n');
});}
child.stdout.on('data',data=>{buffer+=data;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const m=JSON.parse(line);if(!m.id)continue;const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result);}catch{}}});
let diagnostics='';child.stderr.on('data',data=>{diagnostics=(diagnostics+data).slice(-2500);});
child.on('exit',()=>{for(const p of pending.values())p.reject(Error('App-server proxy exited'));});
(async()=>{
  await request('initialize',{clientInfo:{name:'fresin_mcp_recovery',title:'Fresin MCP recovery',version:'1.0'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
  if(process.argv[2]){
    // A temporary transport context only: no model turn, agent, or saved chat.
    const transport=await request('thread/start',{ephemeral:true,cwd:process.cwd()});
    const threadId=transport.thread.id;
    const status=await request('mcpServerStatus/list',{serverName:'supabase-fresin',threadId,detail:'toolsAndAuthOnly'});
    const requestData=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    const advertised=status.data?.find(server=>server.name==='supabase-fresin')?.tools||{};
    const requests=Array.isArray(requestData)?requestData:[requestData];
    for(const item of requests)if(!advertised[item.tool])throw Error('Tool not advertised on the authenticated Fresin connection');
    const results=await Promise.all(requests.map(item=>request('mcpServer/tool/call',{threadId,server:'supabase-fresin',tool:item.tool,arguments:item.arguments})));
    const result=Array.isArray(requestData)?results:results[0];
    if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result));
    console.log(process.argv.includes('--summary') ? JSON.stringify({isError:result.isError||false,contentTypes:result.content?.map(item=>item.type),savedTo:process.argv[3]}) : JSON.stringify(result));
  }else{
    const status=await request('mcpServerStatus/list',{serverName:'supabase-fresin',detail:'toolsAndAuthOnly'});
    fs.writeFileSync('tests/artifacts/fresin-mcp-status.json',JSON.stringify(status));
    console.log(JSON.stringify(status).slice(0,600));
  }
})().catch(error=>{console.error(error.message);if(diagnostics)console.error(diagnostics);process.exitCode=1;}).finally(()=>{child.stdin.end();child.kill();});
