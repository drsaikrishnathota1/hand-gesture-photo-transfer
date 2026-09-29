process.env.NODE_ENV='test';
process.env.AIRGESTURE_TEST_AUTH_BYPASS='1';

const test=require('node:test');
const assert=require('node:assert/strict');

let createServer,WebSocket;
let depsAvailable=true;
try{
  ({createServer}=require('../server.js'));
  WebSocket=require('ws');
}catch(error){
  if(error.code==='MODULE_NOT_FOUND')depsAvailable=false;
  else throw error;
}

function openClient(url){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(url);
    ws.once('open',()=>resolve(ws));
    ws.once('error',reject);
  });
}

function nextMessage(ws,predicate=()=>true,timeout=5000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error('Timed out waiting for WebSocket message'));},timeout);
    const handler=(raw)=>{
      const msg=JSON.parse(raw.toString());
      if(!predicate(msg))return;
      cleanup();
      resolve(msg);
    };
    const cleanup=()=>{clearTimeout(timer);ws.off('message',handler);};
    ws.on('message',handler);
  });
}

async function join(ws,payload){
  const p=nextMessage(ws,m=>m.type==='broadcast-joined');
  ws.send(JSON.stringify(payload));
  return p;
}

async function withServer(fn){
  const instance=createServer();
  await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));
  const port=instance.server.address().port;
  try{
    await fn({...instance,port});
  }finally{
    for(const client of instance.wss.clients)client.terminate();
    await new Promise(resolve=>instance.server.close(resolve));
  }
}

test('sender intent reaches already-connected receiver immediately',{skip:!depsAvailable},async()=>{
  await withServer(async({port})=>{
    const url=`ws://127.0.0.1:${port}`;
    const host=await openClient(url);
    await join(host,{type:'join',room:'FAST01',role:'sender'});

    const receiver=await openClient(url);
    await join(receiver,{type:'join',room:'FAST01',role:'receiver'});

    const incoming=nextMessage(receiver,m=>m.type==='broadcast-intent');
    host.send(JSON.stringify({
      type:'broadcast-intent',
      file:{name:'sample.pdf',size:1234,mime:'application/pdf'}
    }));

    const msg=await incoming;
    assert.equal(msg.intent.name,'sample.pdf');
    assert.equal(msg.intent.size,1234);
  });
});

test('receiver joining after intent still sees pending request',{skip:!depsAvailable},async()=>{
  await withServer(async({port})=>{
    const url=`ws://127.0.0.1:${port}`;
    const host=await openClient(url);
    await join(host,{type:'join',room:'LATE01',role:'sender'});

    host.send(JSON.stringify({
      type:'broadcast-intent',
      file:{name:'late.png',size:456,mime:'image/png'}
    }));

    await new Promise(resolve=>setTimeout(resolve,50));

    const receiver=await openClient(url);
    const joined=await join(receiver,{type:'join',room:'LATE01',role:'receiver'});
    assert.equal(joined.intent.name,'late.png');
    assert.equal(joined.intent.size,456);
  });
});

test('sender cancel clears pending intent',{skip:!depsAvailable},async()=>{
  await withServer(async({port})=>{
    const url=`ws://127.0.0.1:${port}`;
    const host=await openClient(url);
    await join(host,{type:'join',room:'CANCEL01',role:'sender'});

    const receiver=await openClient(url);
    await join(receiver,{type:'join',room:'CANCEL01',role:'receiver'});

    host.send(JSON.stringify({
      type:'broadcast-intent',
      file:{name:'cancel.pdf',size:10,mime:'application/pdf'}
    }));

    await nextMessage(receiver,m=>m.type==='broadcast-intent');

    const cancelled=nextMessage(receiver,m=>m.type==='broadcast-intent-cancelled');
    host.send(JSON.stringify({type:'broadcast-intent-cancel'}));
    await cancelled;
  });
});
