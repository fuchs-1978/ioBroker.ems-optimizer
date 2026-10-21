'use strict';

// Offline deterministic replay of unmodified upstream code and real FSM.
// A gRPC request is given a snapshot when issued; response delivery is controlled.
// No claim about a tested SHIP peer, physical installation or live wire ordering.
// ioBroker I/O, registration, RPC, clock/timers, guard failsafe configuration
// and the downstream distribution callback are doubles; EgLpc is not executed.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const [sourceArgument,fsmArgument,...unexpectedArguments]=process.argv.slice(2);
if(!sourceArgument||!fsmArgument||unexpectedArguments.length){
  console.error('Usage: node test/replays/eebus-lpc-ordering.cjs /path/to/lpc-use-case.js /path/to/state-machine-3.1.0.js');
  process.exit(64);
}
const sourcePath=path.resolve(sourceArgument);
const fsmPath=path.resolve(fsmArgument);
const source=fs.readFileSync(sourcePath,'utf8');
const sourceSha256=crypto.createHash('sha256').update(source).digest('hex');
assert.equal(sourceSha256,'b9da9b439d422ef36f25cfa3a2f50a39a980f5facaa2e9eb3ba1958a7020f2dc');
const fsmSha256=crypto.createHash('sha256').update(fs.readFileSync(fsmPath)).digest('hex');
assert.equal(fsmSha256,'f10baaebe04f6132ad391fb7274c7e59ceeb87fdf45449c6bd1a745ca9d49289');
const StateMachine=require(fsmPath);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function settle(){for(let i=0;i<12;i++)await Promise.resolve();}
async function scenario(reordered){
  let now=Date.parse('2026-10-22T00:00:00Z');
  let timerId=1;
  let pendingApprovalValue=9000,pendingApprovalCounter=1;
  const timers=new Map(),states=new Map(),trace=[],rpcRequests=[],approvals=[];
  const stream=new EventEmitter();stream.cancel=()=>{};
  const oldRead=deferred(),newRead=deferred();
  const reads=[Promise.resolve({load_limit:{is_active:true,value:12000,duration_nanoseconds:0}}),oldRead.promise,newRead.promise];
  const publish=(id,val,ack)=>{const state={val,ack,q:0,ts:++now};states.set(id,state);trace.push({kind:'state',id,...state});};
  const adapter={
    extendObjectAsync:async()=>{},getStateAsync:async()=>null,
    setState:publish,setStateAsync:async(...args)=>publish(...args),
    setTimeout:(fn,ms)=>{const id=timerId++;timers.set(id,{kind:'timeout',fn,ms});return id;},
    clearTimeout:id=>timers.delete(id),
    setInterval:(fn,ms)=>{const id=timerId++;timers.set(id,{kind:'interval',fn,ms});return id;},
    clearInterval:id=>timers.delete(id),
    log:{debug(){},info(){},warn(){},error(...args){throw Error(args.join(' '));}}
  };
  const transport={
    makeClient:()=>({close(){}}),getEndpoint:()=> 'offline-in-memory-only',isTransportError:()=>false,
    callUnary:async(_client,method,args)=>{
      const req={kind:'rpc-request',method,args,ts:++now};rpcRequests.push(req);trace.push(req);
      if(method==='ConsumptionLimit'){assert(reads.length>0);return reads.shift();}
      if(method==='PendingConsumptionLimit')return {load_limits:{[String(pendingApprovalCounter)]:{is_active:true,value:pendingApprovalValue}}};
      if(method==='ApproveOrDenyConsumptionLimit'){approvals.push({...args});return {};}
      if(method==='IsHeartbeatWithinDuration')return {is_within_duration:true};
      if(['SetConsumptionNominalMax','SetConsumptionLimit','SetFailsafeConsumptionActivePowerLimit','SetFailsafeDurationMinimum','StartHeartbeat'].includes(method))return {};
      throw Error('Unexpected RPC '+method);
    }
  };
  class FrozenDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const sandbox={module:{exports:{}},exports:{},__dirname:path.dirname(sourcePath),Date:FrozenDate,
    require:id=>{
      if(id==='node:path')return path;
      if(id==='javascript-state-machine')return StateMachine;
      if(id==='./grpc-client')return transport;
      if(id==='./grpc-service')return {addCsLpcUseCase:async()=> 'fixed-lpc-instance'};
      throw Error('Unexpected require '+id);
    }};
  vm.runInNewContext(source,sandbox,{filename:sourcePath});
  const {LpcUseCase,shouldApproveLimit}=sandbox.module.exports;
  assert.equal(shouldApproveLimit(9000,[4200]),true);
  assert.equal(shouldApproveLimit(4200,[4200]),true);
  const lpc=new LpcUseCase(adapter,{contractualConsumptionNominalMax:12000,heartbeatTimeoutSeconds:30,controlboxSki:'fixed-peer'},
    {SubscribeUseCaseEvents:()=>stream},s=>s,{
      getGuardFailsafeLimits:()=>[4200],
      onLimitUpdate:async(active,watts,duration)=>trace.push({kind:'distribution-callback',active,watts,duration,ts:++now})
    });
  await lpc.start();
  const eventPromise=name=>Promise.all(stream.listeners('data').map(listener=>listener({remote_ski:'fixed-peer',use_case_event:{event:name}})));
  await eventPromise('DataUpdateLimit');await settle();
  assert.equal(lpc.state,'limited');assert.equal(states.get('LPC.limit').val,12000);
  await eventPromise('LimitWriteApprovalRequired');await settle();
  assert.equal(approvals.length,1);assert.equal(approvals[0].approve,true);
  assert.equal(approvals[0].msg_counter,1);
  const observations=[];
  const observe=label=>observations.push({label,state:lpc.state,publishedState:states.get('LPC.state'),
    publishedLimit:states.get('LPC.limit'),publishedDuration:states.get('LPC.limitDuration'),
    lastDistributionCallback:trace.filter(t=>t.kind==='distribution-callback').at(-1)});
  const oldHandler=eventPromise('DataUpdateLimit');await settle();
  assert.equal(rpcRequests.filter(r=>r.method==='ConsumptionLimit').length,2);
  const oldResponse={load_limit:{is_active:true,value:9000,duration_nanoseconds:600000000000}};
  const newResponse={load_limit:{is_active:true,value:4200,duration_nanoseconds:300000000000}};
  if(!reordered){oldRead.resolve(oldResponse);await oldHandler;await settle();observe('older-9000-completed-before-newer-request');}
  pendingApprovalValue=4200;pendingApprovalCounter=2;
  await eventPromise('LimitWriteApprovalRequired');await settle();
  assert.equal(approvals.length,2);assert(approvals.every(a=>a.approve===true));
  assert.deepEqual(approvals.map(a=>a.msg_counter),[1,2]);
  const newHandler=eventPromise('DataUpdateLimit');await settle();
  assert.equal(rpcRequests.filter(r=>r.method==='ConsumptionLimit').length,3);
  newRead.resolve(newResponse);await newHandler;await settle();
  assert.equal(states.get('LPC.limit').val,4200);assert.equal(states.get('LPC.limitDuration').val,5);
  observe('newer-4200-published');
  if(reordered){oldRead.resolve(oldResponse);await oldHandler;await settle();observe('older-9000-response-completed-after-newer-4200');}
  const expected=reordered?9000:4200;
  assert.equal(lpc.state,'limited');
  assert.equal(states.get('LPC.limit').val,expected);
  assert.equal(states.get('LPC.limitDuration').val,reordered?10:5);
  assert(states.get('LPC.limitDuration').ts>states.get('LPC.limit').ts);
  assert.equal(trace.filter(t=>t.kind==='distribution-callback').at(-1).watts,expected);
  const lastDistributionCallback=trace.filter(t=>t.kind==='distribution-callback').at(-1);
  lpc.stop();
  return {scenario:reordered?'older-unary-response-after-newer-limit':'ordered-control',guardFailsafeW:4200,
    pureApprovalRuleBothPass:true,actualApprovalHandlerApprovals:approvals,
    latestIntendedLimitW:4200,finalState:lpc.state,finalPublishedLimitW:states.get('LPC.limit').val,
    finalPublishedDurationMinutes:states.get('LPC.limitDuration').val,lastDistributionCallbackW:lastDistributionCallback.watts,
    observedRpcResponseReordering:reordered,observations,trace};
}
(async()=>{
 const control=await scenario(false),adversarial=await scenario(true);
 console.log(JSON.stringify({node:process.version,sourcePath,fsmPath,sourceSha256,fsmSha256,
   upstreamCommit:'d6f9329fc424445f81cfd56b0b20f3929c9d16c2',fsmCommit:'0d603577423244228cebcd62e60dbbfff27c6ea3',
   actualUnmodifiedUpstreamSource:true,actualUnmodifiedFsmDependency:true,
   testDoubles:['ioBroker I/O','gRPC transport','use-case registration','clock/timers','guard failsafe supplier','distribution callback'],
   actualEgLpcDistributionExecuted:false,productionObserved:false,
   scope:'Possible module interleaving under controlled unary reply order; not a full SHIP admission or live installation test',
   control,adversarial},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
