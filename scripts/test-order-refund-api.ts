/** Real route handlers; only auth and financial service boundary stubbed. No DB/network. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { RecordRefundInput, RefundActor } from "../src/lib/config/order-refund";
const require = createRequire(import.meta.url), saved = new Map<string, NodeJS.Module | undefined>();
function stub(path: string, exports: unknown) {
  const id = require.resolve(path); saved.set(id,require.cache[id]); require.cache[id]={id,filename:id,loaded:true,exports} as NodeJS.Module;
}
let authenticated=true, failure=false, readCount=0, checks=0;
const writes: Array<{input:RecordRefundInput;actor:RefundActor}>=[];
const orderId=randomUUID(), sibling=randomUUID();
const context=(id: string=orderId)=>({params:Promise.resolve({id})});
const request=(value:unknown)=>new NextRequest(`http://localhost/api/admin/orders/${orderId}/refund`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(value)});
const payload=()=>({operationKey:randomUUID(),expectedFingerprint:"a".repeat(64),mode:"actual",reason:"Müşterinin talebi doğrultusunda",
  allocations:[{orderId,cashKurus:100,giftKurus:0}],cashEvidence:{method:"card",externalReference:"R-001",occurredAt:new Date(Date.now()-60000).toISOString(),paytrRefundCompleted:true}});
const check=(name:string,a:unknown,b:unknown)=>{assert.deepEqual(a,b,name);checks++;console.log(`PASS ${name}`);};
async function main(){try{
  stub("../src/lib/auth/require-admin",{requireAdmin:async()=>authenticated?{session:{user:{email:"admin@test.invalid"}}}:{response:NextResponse.json({error:"Oturum gerekli."},{status:401})}});
  stub("../src/lib/services/order-refund-record",{
    readOrderRefundView:async(id:string)=>{readCount++;if(failure)throw new Error("offline");return {orderId:id,history:[],expectedFingerprint:"a".repeat(64)};},
    recordOrderRefund:async(input:RecordRefundInput,actor:RefundActor)=>{writes.push({input,actor});return failure?{ok:false,status:409,code:"stale",error:"Ödeme kaydı değişti."}:{ok:true,refundId:randomUUID(),replayed:false,cashKurus:100,giftKurus:0,orders:[],notificationState:"pending"};},
  });
  const route=await import("../src/app/api/admin/orders/[id]/refund/route");
  authenticated=false;
  check("anonymous GET refused",(await route.GET(request({}),context())).status,401);
  check("anonymous POST refused",(await route.POST(request(payload()),context())).status,401);
  check("anonymous never reaches financial reads/writes",[readCount,writes.length],[0,0]); authenticated=true;
  check("bad route UUID refuses before query",(await route.GET(request({}),context("bad"))).status,404);
  check("old reason-only mutation refused",(await route.POST(request({reason:"İade istiyorum"}),context())).status,400);
  const foreign=payload();foreign.allocations[0].orderId=sibling;
  check("path order must be allocated",(await route.POST(request(foreign),context())).status,400);
  check("extra actor cannot be spoofed",(await route.POST(request({...payload(),adminEmail:"spoof@test.invalid"}),context())).status,400);
  check("invalid mutations never reach service",writes.length,0);
  let response=await route.GET(request({}),context());
  check("GET disables caching",response.headers.get("cache-control"),"no-store");
  check("GET preserves view contract",(await response.json()).orderId,orderId);
  const split=payload();split.allocations.push({orderId:sibling,cashKurus:200,giftKurus:0});
  response=await route.POST(request(split),context());check("valid shared payment allocation delegated",response.status,200);
  check("actor only from authenticated session",writes[0].actor,{adminEmail:"admin@test.invalid"});
  check("both allocated orders retained",writes[0].input.allocations.length,2);
  failure=true;
  response=await route.POST(request(payload()),context());check("service stale status propagated",response.status,409);
  check("service failure has renderable Turkish body",(await response.json()).error,"Ödeme kaydı değişti.");
  response=await route.GET(request({}),context());check("unreadable view never empty success",response.status,500);
  check("read failure body is Turkish",/[çğıöşü]/.test((await response.json()).error),true);
}finally{for(const[id,old]of saved){if(old)require.cache[id]=old;else delete require.cache[id];}}
console.log(`${checks} refund API checks passed`);}
main().catch(error=>{console.error(error);process.exitCode=1;});
