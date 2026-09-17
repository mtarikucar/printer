/** Customer route contract: real handlers/normalizer, fake auth/DB/service; no network or sends. */
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const require = createRequire(import.meta.url);
const saved = new Map<string, NodeJS.Module | undefined>();
const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
function stub(path: string, exports: unknown) {
  const id = require.resolve(path);
  saved.set(id, require.cache[id]);
  require.cache[id] = { id, filename: id, loaded: true, exports } as NodeJS.Module;
}
const dialect = new PgDialect();
type Read = { where: SQL; columns: Record<string, boolean>; orderBy?: SQL[] };
type Row = Record<string, unknown>;
const userId = randomUUID(), otherUserId = randomUUID(), orderId = randomUUID(), otherOrderId = randomUUID();
const orderNumber = "CUSTOMER-1", disputeId = randomUUID(), recordId = randomUUID(), operationKey = randomUUID();
let authenticated = true, authThrows = false, readFailure: string | null = null, serviceThrows = false, checks = 0;
let orderRows: Row[] = [], disputeRows: Row[] = [], recordRows: Row[] = [], allocationRows: Row[] = [];
let result: Row = { ok: true, disputeId, replayed: false };
const reads: Array<{ table: string; columns: string[] }> = [];
const calls: Array<{ orderNumber: string; userId: string; input: unknown }> = [];
const context = (number = orderNumber) => ({ params: Promise.resolve({ orderNumber: number }) });
const request = (body: unknown = {}) => new NextRequest(`http://localhost/api/customer/orders/${orderNumber}/dispute`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const valid = () => ({ category: "damaged", description: "  Ürün hasarlı olarak teslim edildi.  " });
const ownedOrder = () => ({ id: orderId, orderNumber, userId, status: "delivered" });
const complaint = (overrides: Row = {}): Row => ({
  id: disputeId, orderId, userId, category: "damaged", description: "Ürün hasarlı olarak teslim edildi.",
  status: "resolved", resolution: "Talebiniz değerlendirildi.", createdAt: new Date("2026-09-01T12:00:00Z"),
  resolvedAt: new Date("2026-09-02T12:00:00Z"), refundRecordId: null, decisionOperationKey: null,
  adminEmail: "private-admin@test.invalid", decisionSnapshot: { private: "must not escape" },
  ...overrides,
});
function filterValue(query: ReturnType<PgDialect["sqlToQuery"]>, field: string) {
  const match = query.sql.match(new RegExp(`"${field}" = \\$(\\d+)`));
  return match ? query.params[Number(match[1]) - 1] : undefined;
}
function select(table: string, rows: Row[], options: Read): Row | undefined {
  reads.push({ table, columns: Object.keys(options.columns) });
  const q = dialect.sqlToQuery(options.where);
  const open = filterValue(q, "status") === "open";
  if (readFailure === table || (table === "disputes" && readFailure === (open ? "open" : "latest"))) throw new Error("fake read unavailable");
  const fields: Record<string, string> = {
    id: "id", order_number: "orderNumber", user_id: "userId", order_id: "orderId", status: "status",
    refund_id: "refundId", operation_key: "operationKey", kind: "kind",
  };
  if (table === "orders") {
    assert.equal(filterValue(q, "user_id"), userId, "GET ownership must be checked in the order query");
    assert.ok(filterValue(q, "order_number"), "GET must anchor the requested order number");
  }
  if (table === "disputes") {
    assert.equal(filterValue(q, "order_id"), orderId);
    if (!open) {
      assert.equal(filterValue(q, "user_id"), userId, "Complaint details must belong to the authenticated owner");
      const sorting = options.orderBy?.map(item => dialect.sqlToQuery(item).sql).join(", ") ?? "";
      assert.match(sorting, /"created_at" desc/);
      assert.match(sorting, /"id" desc/, "Equal timestamps need deterministic latest-dispute ordering");
    }
  }
  if (table === "orderRefundAllocations") {
    assert.equal(filterValue(q, "order_id"), orderId, "Refund totals must be scoped to this order");
    assert.equal(filterValue(q, "refund_id"), recordId);
    assert.equal(filterValue(q, "kind"), "refund");
  }
  let matching = rows.filter(row => Object.entries(fields).every(([column, field]) => {
    const value = filterValue(q, column); return value === undefined || row[field] === value;
  }));
  if (options.orderBy) matching = matching.sort((a,b) => Number(b.createdAt) - Number(a.createdAt) || String(b.id).localeCompare(String(a.id)));
  const row = matching[0];
  return row ? Object.fromEntries(Object.entries(options.columns).filter(([, include]) => include).map(([field]) => [field, row[field]])) : undefined;
}
const check = (name: string, actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected, name); checks++; console.log(`PASS ${name}`);
};
async function main() {
  try {
    stub("../src/lib/services/customer-auth", { getSessionUser: async () => {
      if (authThrows) throw new Error("fake session failure");
      return authenticated ? { userId, email: "customer@test.invalid" } : null;
    } });
    stub("../src/lib/db", { db: {
      query: {
        orders: { findFirst: async (options: Read) => select("orders", orderRows, options) },
        disputes: { findFirst: async (options: Read) => select("disputes", disputeRows, options) },
        orderRefundRecords: { findFirst: async (options: Read) => select("orderRefundRecords", recordRows, options) },
        orderRefundAllocations: { findFirst: async (options: Read) => select("orderRefundAllocations", allocationRows, options) },
      },
      insert: () => { throw new Error("Route must not insert disputes or notices"); },
      transaction: () => { throw new Error("Route must not own money or opening transactions"); },
    } });
    const serviceBoundary = { openDispute: async (number: string, owner: string, input: unknown) => {
      calls.push({ orderNumber: number, userId: owner, input });
      if (serviceThrows) throw new Error("fake opening failure");
      return result;
    } };
    // Stub the service before module resolution: this tests the adapter without
    // loading the backend's database, notice, queue or money dependency graph.
    loader._load = function(name, ...args) {
      if (name === "@/lib/services/dispute-resolution") return serviceBoundary;
      return originalLoad.call(this,name,...args);
    };
    const route = await import("../src/app/api/customer/orders/[orderNumber]/dispute/route");
    authenticated = false;
    for (const method of ["GET", "POST"] as const) {
      const response = await route[method](request(valid()), context());
      check(`anonymous ${method} refuses`, response.status, 401);
      check(`anonymous ${method} has Turkish explanation`, (await response.json()).error, "Devam etmek için giriş yapın.");
    }
    check("anonymous never reads or delegates", [reads.length, calls.length], [0,0]); authenticated = true;
    orderRows = [{ ...ownedOrder(), userId: otherUserId }];
    let response: Response = await route.GET(request(), context());
    check("foreign order GET is hidden", response.status,404);
    check("foreign order does not expose complaint reads", reads.filter(row=>row.table !== "orders").length,0);
    orderRows = [ownedOrder()]; disputeRows = [];
    response = await route.GET(request(), context());
    check("owned delivered order without history may open", await response.json(), {canOpen:true,dispute:null});
    check("customer history is never cached",response.headers.get("cache-control"),"no-store");
    for (const status of ["approved","rejected","shipped","delivered"]) {
      orderRows = [{...ownedOrder(),status}];
      check(`GET opening policy ${status}`, (await (await route.GET(request(),context())).json()).canOpen, ["shipped","delivered"].includes(status));
    }
    disputeRows = [complaint({status:"open",resolution:null,resolvedAt:null})];
    response = await route.GET(request(),context()); let payload = await response.json();
    check("existing open dispute blocks opening",payload.canOpen,false);
    check("open dispute has no decision or guessed refund",[payload.dispute.resolvedAt,payload.dispute.refund],[null,null]);
    disputeRows = [complaint({id:randomUUID(),status:"open",createdAt:new Date("2026-08-01T00:00:00Z")}),complaint()];
    payload = await (await route.GET(request(),context())).json();
    check("older legacy open complaint blocks despite latest closed row",[payload.canOpen,payload.dispute.status],[false,"resolved"]);
    disputeRows = [complaint(),complaint({id:randomUUID(),userId:otherUserId,description:"PRIVATE OTHER USER",createdAt:new Date("2026-09-03T00:00:00Z")})];
    payload = await (await route.GET(request(),context())).json();
    check("latest complaint belongs to session user",payload.dispute.description,complaint().description);
    check("legacy closed projection has known date but unknown refund",payload.dispute,{
      category:"damaged",description:"Ürün hasarlı olarak teslim edildi.",status:"resolved",resolution:"Talebiniz değerlendirildi.",
      createdAt:"2026-09-01T12:00:00.000Z",resolvedAt:"2026-09-02T12:00:00.000Z",refund:null,
    });
    disputeRows = [complaint({resolvedAt:null})];
    check("legacy missing resolution date stays null",(await (await route.GET(request(),context())).json()).dispute.resolvedAt,null);
    check("legacy history does not trigger speculative refund lookup",reads.some(row=>row.table === "orderRefundRecords"),false);
    disputeRows = [complaint({status:"rejected",refundRecordId:recordId,decisionOperationKey:operationKey})];
    payload = await (await route.GET(request(),context())).json();
    check("rejected decision neither claims a refund nor cancels opening eligibility",[payload.dispute.status,payload.dispute.refund,payload.canOpen],["rejected",null,true]);
    disputeRows = [complaint({refundRecordId:recordId,decisionOperationKey:operationKey})];
    recordRows = [{id:recordId,operationKey,kind:"refund",cashAmountKurus:9000,giftAmountKurus:2000,externalReference:"SECRET-REFERENCE",adminEmail:"private@test.invalid"}];
    allocationRows = [{refundId:recordId,orderId:otherOrderId,kind:"refund",cashKurus:8000,giftKurus:1500},
      {refundId:recordId,orderId,kind:"refund",cashKurus:1000,giftKurus:500}];
    payload = await (await route.GET(request(),context())).json();
    check("linked actual refund exposes only this order's allocation",payload.dispute.refund,{cashKurus:1000,giftKurus:500});
    check("refund and history never expose internal actor/reference/ids",/SECRET|private|adminEmail|externalReference|refundRecordId|decisionOperationKey/.test(JSON.stringify(payload)),false);
    for (const kind of ["cancellation","legacy_evidence"]) {
      recordRows[0].kind = kind;
      check(`${kind} is not actual decision refund evidence`,(await (await route.GET(request(),context())).json()).dispute.refund,null);
    }
    recordRows[0].kind = "refund"; recordRows[0].operationKey = randomUUID();
    check("unrelated operation does not establish decision refund",(await (await route.GET(request(),context())).json()).dispute.refund,null);
    recordRows[0].operationKey = operationKey;
    allocationRows = allocationRows.filter(row=>row.orderId !== orderId);
    check("missing order allocation stays unknown",(await (await route.GET(request(),context())).json()).dispute.refund,null);
    allocationRows.push({refundId:recordId,orderId,kind:"refund",cashKurus:0,giftKurus:500});
    check("gift-only actual return is reported without invented cash",(await (await route.GET(request(),context())).json()).dispute.refund,{cashKurus:0,giftKurus:500});
    for (const failure of ["orders","latest","open","orderRefundRecords","orderRefundAllocations"]) {
      readFailure = failure; response = await route.GET(request(),context()); payload = await response.json();
      check(`${failure} read failure refuses empty success`,response.status,500);
      check(`${failure} read failure is explicit and Turkish`,typeof payload.error === "string" && /[çğıöşü]/.test(payload.error) && !("dispute" in payload),true);
    }
    readFailure = null; reads.length = 0;
    const invalid = [null,{}, {...valid(),category:"unknown"},{...valid(),description:"abcd"},
      {...valid(),description:"x".repeat(2001)},{...valid(),userId:otherUserId},{...valid(),orderId:otherOrderId},
      {...valid(),adminEmail:"spoof@test.invalid"},{...valid(),refund:{cashKurus:100}}];
    for (const input of invalid) check("strict malformed or spoofed opening input refused",(await route.POST(request(input),context())).status,400);
    const malformed = new NextRequest("http://localhost/api/customer/orders/CUSTOMER-1/dispute",{method:"POST",body:"{"});
    check("malformed JSON has validation response",(await route.POST(malformed,context())).status,400);
    check("invalid input never delegates or reads DB",[calls.length,reads.length],[0,0]);
    response = await route.POST(request(valid()),context());
    check("valid opening delegates unchanged order/session identity",calls[0],{
      orderNumber,userId,input:{category:"damaged",description:"Ürün hasarlı olarak teslim edildi."},
    });
    check("POST has no route-owned reads or money transaction",reads.length,0);
    check("opening success includes service receipt",await response.json(),{ok:true,disputeId,replayed:false});
    result = {ok:true,disputeId,replayed:true};
    response = await route.POST(request(valid()),context());
    check("identical retry returns service replay receipt",await response.json(),{ok:true,disputeId,replayed:true});
    for (const failure of [
      {ok:false,status:404,code:"not_found",error:"Sipariş bulunamadı."},
      {ok:false,status:400,code:"invalid_evidence",error:"Şikâyet yalnız sevk edilmiş siparişler için açılabilir."},
      {ok:false,status:409,code:"already_open",error:"Bu sipariş için açık bir şikâyet zaten var."},
      {ok:false,status:409,code:"busy",error:"Sipariş güncelleniyor. Lütfen tekrar deneyin."},
      {ok:false,status:503,code:"unavailable",error:"Şikâyet kaydı şu anda oluşturulamıyor."},
    ]) {
      result = failure; response = await route.POST(request(valid()),context());
      check(`service ${failure.code} status preserved`,response.status,failure.status);
      check(`service ${failure.code} body preserved`,await response.json(),failure);
    }
    serviceThrows = true; response = await route.POST(request(valid()),context());
    check("unexpected opening error is not success",response.status,500);
    check("unexpected opening error is Turkish",/[çğıöşü]/.test((await response.json()).error),true);
    serviceThrows = false; authThrows = true;
    for (const method of ["GET","POST"] as const) {
      response = await route[method](request(valid()),context());
      check(`unexpected ${method} auth failure has body`,[response.status,typeof (await response.json()).error],[500,"string"]);
    }
  } finally {
    loader._load = originalLoad;
    for (const [id, previous] of saved) { if (previous) require.cache[id] = previous; else delete require.cache[id]; }
  }
  console.log(`${checks} customer dispute API checks passed`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
