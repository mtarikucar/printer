/** Production WHERE predicates, not comments/pre-reads: cancelled cash-due rows
 * must refuse late forward writes. Optional --db executes the exact extracted
 * predicates on a disposable QA schema (no application workers or services).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
import * as orm from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { orders } from '../src/lib/db/schema';
import { moneySplitEditBlock } from '../src/lib/config/order-money-edit';
import { QC_RESET_MANUFACTURER_STATUSES } from '../src/lib/config/order-model-policy';

const id='00000000-0000-4000-8000-000000000001', partner='00000000-0000-4000-8000-000000000002';
const cancelled={id,status:'rejected',paymentStatus:'succeeded',manufacturerId:null,painterId:null,manufacturerStatus:'unassigned',painterStatus:'unassigned',needsPainting:true,paintingPriceKurus:4000,workshopSessionId:null,receivedByPainterAt:null};
const unknown=Symbol('unknown');
type Value=unknown;
const environment:Record<string,Value>={id,orderId:id,manufacturerId:partner,painterId:partner,session:{manufacturerId:partner},g:{painterId:partner},order:{...cancelled,status:'awaiting_model',manufacturerId:partner,painterId:partner},current:{...cancelled,needsPainting:true},job:{orderId:id,manufacturerId:partner,painterId:partner},args:{orderId:id},movesForward:true,advances:true,QC_RESET_MANUFACTURER_STATUSES};
function walk(n:ts.Node, f:(n:ts.Node)=>void){f(n);ts.forEachChild(n,c=>walk(c,f));}
function member(n:ts.Node,name:string):n is ts.CallExpression{return ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text===name;}
interface Write {path:string;line:number;where:ts.Expression;set:ts.Expression;owner:string}
function writes(path:string):Write[]{
  const sf=ts.createSourceFile(path,fs.readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true), found:Write[]=[];
  walk(sf,n=>{
    if(!member(n,'where'))return;
    let update=false,set:ts.Expression|undefined;
    walk(n.expression,c=>{
      if(member(c,'update')&&c.arguments[0]?.getText(sf)==='orders')update=true;
      if(member(c,'set'))set=c.arguments[0];
    });
    if(!update||!set)return;
    let parent:ts.Node|undefined=n,owner='';
    while(parent){if(ts.isFunctionDeclaration(parent)&&parent.name){owner=parent.name.text;break;}parent=parent.parent;}
    found.push({path,line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,where:n.arguments[0],set,owner});
  });return found;
}
// Deliberately conservative three-valued evaluator. Unsupported expressions
// cannot prove a write safe. Handles AND/OR structurally, never regex comments.
function value(n:ts.Expression):Value {
  if(ts.isParenthesizedExpression(n)||ts.isAsExpression(n)||ts.isNonNullExpression(n))return value(n.expression);
  if(ts.isStringLiteral(n)||ts.isNumericLiteral(n))return ts.isStringLiteral(n)?n.text:Number(n.text);
  if(n.kind===ts.SyntaxKind.NullKeyword)return null;
  if(n.kind===ts.SyntaxKind.TrueKeyword)return true;
  if(n.kind===ts.SyntaxKind.FalseKeyword)return false;
  if(ts.isIdentifier(n))return n.text==='orders'?cancelled:environment[n.text]??unknown;
  if(ts.isPropertyAccessExpression(n)){const base=value(n.expression);return base&&typeof base==='object'&&n.name.text in base?(base as Record<string,Value>)[n.name.text]:unknown;}
  if(ts.isArrayLiteralExpression(n))return n.elements.map(e=>value(e as ts.Expression));
  if(ts.isConditionalExpression(n)){const c=value(n.condition);return c===true?value(n.whenTrue):c===false?value(n.whenFalse):unknown;}
  if(!ts.isCallExpression(n)||!ts.isIdentifier(n.expression))return unknown;
  const name=n.expression.text,a=n.arguments.map(value);
  if(name==='notRefundedGuard')return true; // the fixture is still succeeded
  if(name==='and')return a.includes(false)?false:a.every(v=>v===true)?true:unknown;
  if(name==='or')return a.includes(true)?true:a.every(v=>v===false)?false:unknown;
  if(name==='isNull')return a[0]===unknown?unknown:a[0]===null;
  if(name==='isNotNull')return a[0]===unknown?unknown:a[0]!==null;
  if(a.some(v=>v===unknown))return unknown;
  // SQL comparisons with NULL do not pass a WHERE clause.
  if(['eq','ne','gt','gte','lt','lte','inArray','notInArray'].includes(name)&&a.some(v=>v===null))return false;
  if(name==='eq')return a[0]===a[1];
  if(name==='ne')return a[0]!==a[1];
  if(name==='inArray'&&Array.isArray(a[1]))return a[1].includes(a[0]);
  if(name==='notInArray'&&Array.isArray(a[1]))return !a[1].includes(a[0]);
  return unknown;
}
const checks:Write[]=[];
function select(path:string,match:(w:Write)=>boolean=()=>true){const selected=writes(path).filter(match);assert.ok(selected.length,`no relevant write found: ${path}`);checks.push(...selected);}
const admin='src/app/api/admin/orders/[id]';
for(const route of ['approve','start-printing','qc-approve','qc-reject'])select(`${admin}/${route}/route.ts`);
select(`${admin}/ship/route.ts`,w=>w.set.getText().includes('status: "shipped"'));
select(`${admin}/upload-model/route.ts`,w=>w.set.getText().includes('advances'));
for(const route of ['approve','reject'])select(`src/app/api/admin/painter-qc/[id]/${route}/route.ts`);
for(const route of ['accept','start-printing','finish-printing','submit-qc','ship'])select(`src/app/api/manufacturer/orders/[id]/${route}/route.ts`);
for(const route of ['accept','received','painted','submit-qc','ship'])select(`src/app/api/painter/orders/[id]/${route}/route.ts`);
select('src/lib/services/on-behalf.ts');
select('src/lib/services/model-approval.ts',w=>w.set.getText().includes('status: nextStatus'));
select('src/lib/services/order-model.ts',w=>w.owner==='resetQcForNewRevision');
select('src/lib/services/order-confirm.ts',w=>w.owner==='kickOffMarketplaceOrder');
select('src/lib/queue/workers/model-generation.worker.ts');
select('src/lib/queue/workers/mesh-processing.worker.ts');
for(const worker of ['manufacturer-accept-sla','painter-accept-sla'])select(`src/lib/queue/workers/${worker}.worker.ts`,w=>w.set.getText().includes('declined'));

// Execute the production kickoff function with only I/O replaced. A lost
// transition must not emit awaiting_model or send confirmation mail.
async function checkKickoffEffects(){
  const sf=ts.createSourceFile('confirm.ts',fs.readFileSync('src/lib/services/order-confirm.ts','utf8'),ts.ScriptTarget.Latest,true);
  const fn=sf.statements.find((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text==='kickOffMarketplaceOrder');
  assert.ok(fn);
  const js=ts.transpile(fn.getText().replace(/^export\s+/,''),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});
  for(const won of [false,true]){
    const effects:string[]=[];
    const result=Object.assign(Promise.resolve(won?[{id}]:[]),{returning:async()=>won?[{id}]:[]});
    const bindings={...orm,orders,notRefundedGuard:()=>orm.ne(orders.paymentStatus,'refunded'),
      db:{update:()=>({set:()=>({where:()=>result})})},
      orderHasPrintableContent:async()=>false,
      emitOrderChanged:async()=>{effects.push('event');},
      sendOrderConfirmationEmails:async()=>{effects.push('email');},
    };
    const kickoff=new Function(...Object.keys(bindings),`${js};return kickOffMarketplaceOrder;`)(...Object.values(bindings));
    await kickoff({id,sellerManufacturerId:null},'tr');
    assert.deepEqual(effects,won?['event','email']:[],`kickoff ${won?'winning':'lost'} transition side effects`);
  }
  console.log('PASS kickoff lost write skips forward event/email; winning write preserves both');
}

async function main(){
  assert.ok(moneySplitEditBlock({...cancelled,shippedAt:null,manufacturerEarningExists:false,painterEarningExists:false}));
  // Pin the reason the money editor's id-only final predicate is safe: policy
  // reads the fresh locked row, rather than a stale route pre-read.
  const editor=ts.createSourceFile('editor.ts',fs.readFileSync('src/lib/services/order-money-edit.ts','utf8'),ts.ScriptTarget.Latest,true);
  let lock=-1,gate=-1;
  walk(editor,n=>{if(member(n,'for')&&n.arguments[0]?.getText()==='"update"')lock=n.pos;if(ts.isIfStatement(n)&&n.expression.getText()==='before.blockedReason')gate=n.pos;});
  assert.ok(lock>=0&&gate>lock,'money split policy follows order UPDATE lock');
  let failed=0;
  for(const w of checks){const safe=value(w.where)===false;console.log(`${safe?'PASS':'FAIL'} ${w.path}:${w.line} late write ${safe?'refuses':'can match or is unproven'} rejected/succeeded`);if(!safe)failed++;}
  // Prove that detached guards, not lack of a refunded status, do the work.
  const parse=(s:string)=>(ts.createSourceFile('fixture.ts',`const p=${s}`,ts.ScriptTarget.Latest,true).statements[0] as ts.VariableStatement).declarationList.declarations[0].initializer!;
  assert.equal(value(parse('and(eq(orders.id,id),notRefundedGuard())')),true);
  assert.equal(value(parse('or(ne(orders.status,"rejected"),eq(orders.id,id))')),true);
  assert.equal(value(parse('and(eq(orders.id,id),ne(orders.status,"rejected"))')),false);
  await checkKickoffEffects();
  if(process.argv.includes('--db')){
    const connectionString=process.env.QA_MONEY_PG_URL;if(!connectionString)throw new Error('QA_MONEY_PG_URL required');
    const url=new URL(connectionString);if(url.hostname!=='127.0.0.1'||url.port!=='55433')throw new Error('Refusing non-QA database');
    const {default:pg}=await import('pg');const client=new pg.Client({connectionString});const schema=`cancel_placement_${randomUUID().replaceAll('-','')}`;
    await client.connect();try{
      await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema}`);
      await client.query('CREATE TABLE orders(id uuid PRIMARY KEY,status text,payment_status text,manufacturer_id uuid,painter_id uuid,manufacturer_status text,painter_status text,needs_painting boolean,painting_price_kurus int,workshop_session_id uuid,received_by_painter_at timestamp)');
      await client.query("INSERT INTO orders VALUES($1,'rejected','succeeded',NULL,NULL,'unassigned','unassigned',true,4000,NULL,NULL)",[id]);
      const dialect=new PgDialect();let cases=0;
      const targets=checks.filter(w=>w.path.endsWith('/upload-model/route.ts')||w.owner==='kickOffMarketplaceOrder'||(w.path.endsWith('/mesh-processing.worker.ts')&&w.set.getText().includes('unknown_size')));
      assert.equal(targets.length,3,'all three fixed transitions have real DB coverage');
      for(const w of targets){
        const bindings={...orm,...environment,orders,notRefundedGuard:()=>orm.ne(orders.paymentStatus,'refunded')};
        const js=ts.transpile(`(${w.where.getText()})`,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}).trim().replace(/;$/,'');
        const predicate=new Function(...Object.keys(bindings),`return ${js}`)(...Object.values(bindings));
        const upload=w.path.endsWith('/upload-model/route.ts'),kickoff=w.owner==='kickOffMarketplaceOrder';
        const before=upload?'awaiting_model':kickoff?'paid':'processing_mesh';
        const after=upload?'approved':kickoff?'awaiting_model':'failed_mesh';
        const query=dialect.sqlToQuery(orm.sql`UPDATE ${orders} SET status=${after} WHERE ${predicate} RETURNING ${orders.id}`);
        const fixtures=[{status:'rejected',payment:'succeeded',wins:false},{status:before,payment:'succeeded',wins:true},{status:'printing',payment:'succeeded',wins:false}];
        if(upload||kickoff)fixtures.push({status:before,payment:'refunded',wins:false});
        for(const fixture of fixtures){
          await client.query('UPDATE orders SET status=$1,payment_status=$2 WHERE id=$3',[fixture.status,fixture.payment,id]);
          const changed=await client.query(query.sql,query.params);
          assert.equal(changed.rowCount,fixture.wins?1:0,`${w.path}: ${fixture.status}/${fixture.payment} late write`);
          const saved=await client.query('SELECT status,payment_status FROM orders WHERE id=$1',[id]);
          assert.deepEqual(saved.rows[0],{status:fixture.wins?after:fixture.status,payment_status:fixture.payment});
          cases++;
        }
        console.log(`DB PASS ${w.path}:${w.line} cancellation/stale refusal and eligible transition`);
      }
      console.log(`DB ${cases}/${cases} real conditional UPDATE cases passed`);
    }finally{await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await client.end();}
  }
  console.log(`${checks.length-failed}/${checks.length} placement predicates refuse; money-editor lock/policy passed`);
  process.exitCode=failed?1:0;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
