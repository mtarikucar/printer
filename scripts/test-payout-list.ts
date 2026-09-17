/** Pure pagination/cursor contracts: no database or network. */
import assert from "node:assert/strict";
import {
  parsePayoutListRequest, parsePayoutListQuery, encodePayoutCursor, decodePayoutCursor, validatePayoutListQuery,
  isExactPayoutTimestamp, checkedPayoutInteger, payoutDisplayStatus, PayoutListInputError,
  type PayoutListScope,
} from "../src/lib/config/payout-list";
let checks=0;
const test=(name:string,run:()=>void)=>{run();checks++;console.log(`PASS ${name}`);};
const id="00000000-0000-4000-8000-000000000001";
const admin={audience:"admin",kind:"manufacturer"} as const;
const owner={audience:"partner",kind:"manufacturer",partnerId:id} as const;
test("defaults differ only by audience",()=>{
  assert.deepEqual(parsePayoutListRequest(new URLSearchParams(),{audience:"admin"}),{scope:admin,query:{status:"pending",limit:50}});
  assert.deepEqual(parsePayoutListRequest(new URLSearchParams(),owner),{scope:owner,query:{status:"all",limit:50}});
});
test("SSR params share strict parsing and validate the owner from scope",()=>{
  assert.deepEqual(parsePayoutListQuery({status:"paid",limit:"25",cursor:undefined},owner),{status:"paid",limit:25});
  assert.deepEqual(parsePayoutListQuery(new URLSearchParams(),admin),{status:"pending",limit:50});
  for(const partnerId of ["", "bad", `${id} `])
    assert.throws(()=>parsePayoutListQuery(new URLSearchParams(),{...owner,partnerId}),PayoutListInputError);
  assert.throws(()=>parsePayoutListQuery({status:["paid","all"]},owner),PayoutListInputError);
  assert.throws(()=>parsePayoutListQuery({status:"all",extra:"x"},owner),PayoutListInputError);
});
test("limit is a strictly bounded decimal integer",()=>{
  for(const limit of ["0","101","-1","1.5","1e2","Infinity","NaN","9007199254740993","01"," 2",""])
    assert.throws(()=>parsePayoutListRequest(new URLSearchParams({limit}),{audience:"admin"}),PayoutListInputError);
  assert.equal(parsePayoutListRequest(new URLSearchParams({limit:"100"}),owner).query.limit,100);
});
test("unknown, duplicate and foreign owner filters refuse",()=>{
  for(const query of ["status=unknown","kind=customer","status=all&status=paid","limit=2&limit=3","audience=admin","partnerId=bad"])
    assert.throws(()=>parsePayoutListRequest(new URLSearchParams(query),{audience:"admin"}),PayoutListInputError);
  for(const query of [`partnerId=${id}`,"kind=painter"])
    assert.throws(()=>parsePayoutListRequest(new URLSearchParams(query),owner),PayoutListInputError);
});
test("cursor roundtrip preserves six fractional digits and rejects scope changes",()=>{
  const value=encodePayoutCursor(owner,"all",{lastTimestamp:"2026-09-17 12:34:56.123456",lastId:id});
  assert.equal(decodePayoutCursor(value,owner,"all").lastTimestamp,"2026-09-17 12:34:56.123456");
  for(const scope of [admin,{...owner,kind:"painter"},{...owner,partnerId:"00000000-0000-4000-8000-000000000002"}] as PayoutListScope[])
    assert.throws(()=>decodePayoutCursor(value,scope,"all"),PayoutListInputError);
  assert.throws(()=>decodePayoutCursor(value,owner,"pending"),PayoutListInputError);
});
test("invalid dates, lossy timestamps and malformed cursor encodings refuse",()=>{
  assert.equal(isExactPayoutTimestamp("2024-02-29 23:59:59.000001"),true);
  assert.equal(isExactPayoutTimestamp("0001-01-01 00:00:00.000000"),true);
  for(const ts of ["2025-02-29 00:00:00.000000","2026-04-31 00:00:00.000000","2026-09-17 24:00:00.000000","2026-09-17 12:00:00.123","2026-09-17T12:00:00.123456Z","0000-01-01 00:00:00.000000"])
    assert.equal(isExactPayoutTimestamp(ts),false,ts);
  for(const cursor of ["","!","A","x".repeat(2049),btoa('{}')])
    assert.throws(()=>decodePayoutCursor(cursor,admin,"pending"),PayoutListInputError);
  const valid=decodePayoutCursor(encodePayoutCursor(admin,"pending",{lastId:id,lastTimestamp:"2026-09-17 00:00:00.000001"}),admin,"pending");
  for(const change of [{v:2},{extra:true},{lastId:"bad"},{lastTimestamp:"2026-02-30 00:00:00.000000"}]) {
    const forged=btoa(JSON.stringify({...valid,...change})).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
    assert.throws(()=>decodePayoutCursor(forged,admin,"pending"),PayoutListInputError);
  }
});
test("direct reader inputs cannot bypass request validation",()=>{
  for(const limit of [NaN,Infinity,1.1,0,101,Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>validatePayoutListQuery(admin,{status:"all",limit}),PayoutListInputError);
});
test("money/counts must already be exact integers",()=>{
  assert.equal(checkedPayoutInteger(-2147483647),-2147483647);
  for(const amount of ["100",NaN,Infinity,1.1,Number.MAX_SAFE_INTEGER+1,null])
    assert.throws(()=>checkedPayoutInteger(amount),RangeError);
});
test("void state dominates raw pending and paid separates transfer from netting",()=>{
  assert.equal(payoutDisplayStatus({status:"pending",settlementKind:"transfer",voidedAt:"now"}),"voided");
  assert.equal(payoutDisplayStatus({status:"pending",settlementKind:"netting",voidedAt:null}),"pending");
  assert.equal(payoutDisplayStatus({status:"paid",settlementKind:"netting",voidedAt:null}),"netted");
  assert.equal(payoutDisplayStatus({status:"paid",settlementKind:"transfer",voidedAt:null}),"paid");
});
console.log(`${checks} payout list pure checks passed`);
