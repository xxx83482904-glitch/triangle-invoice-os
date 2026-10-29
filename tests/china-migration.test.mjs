import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planSplit, migrateFiles } from '../scripts/split-china-data.mjs';

function empty(edition) {
  const data = edition ? { appEdition: edition } : {};
  for (const key of ['users','clients','vendors','projects','estimates','issuedInvoices','issuedInvoiceItems','receivedInvoices','payments','bankAccounts','bankTransactions','accountingCategories','bankRules','bankSyncStates','bankReconciliations','bankTransfers','mailDocuments','mailFolders','attachments','auditLogs','selectOptions','invoiceNumberSettings']) data[key] = [];
  return data;
}
function fixture() {
  const source = empty(undefined), target = empty('CHINA');
  source.users = [{ id:'jp-admin', email:'admin@example.invalid', passwordHash:'jp-secret', role:'ADMIN' }];
  target.users = [{ id:'cn-admin', email:'admin@example.invalid', passwordHash:'cn-secret', role:'ADMIN' }];
  for (const company of ['JAPAN','CHINA']) {
    source.clients.push({id:`client-${company}`,company});
    source.vendors.push({id:`vendor-${company}`,company});
    source.projects.push({id:`project-${company}`,company,clientId:`client-${company}`,managerId:'jp-admin',memberIds:['jp-admin'],contractAmount:100});
    source.issuedInvoices.push({id:`invoice-${company}`,projectId:`project-${company}`,clientId:`client-${company}`,createdById:'jp-admin',total:100});
    source.issuedInvoiceItems.push({id:`item-${company}`,invoiceId:`invoice-${company}`,amount:100});
    source.payments.push({id:`payment-${company}`,issuedInvoiceId:`invoice-${company}`,amount:50,createdById:'jp-admin'});
    source.bankAccounts.push({id:`account-${company}`,company});
    source.bankTransactions.push({id:`transaction-${company}`,company,bankAccountId:`account-${company}`,amount:50});
    source.bankReconciliations.push({id:`match-${company}`,company,transactionId:`transaction-${company}`,invoiceKind:'issued',invoiceId:`invoice-${company}`,paymentId:`payment-${company}`,amount:50,confirmedById:'jp-admin'});
  }
  source.attachments.push({id:'file',relatedType:'IssuedInvoice',relatedId:'invoice-CHINA',fileUrl:'/uploads/received-invoices/document.pdf',uploadedById:'jp-admin'});
  source.auditLogs.push({id:'audit-cn',userId:'jp-admin',targetId:'invoice-CHINA',beforeStateJson:{users:source.users},afterJson:{japan:'private'}},{id:'audit-jp',userId:'jp-admin',targetId:'invoice-JAPAN',beforeStateJson:{projects:source.projects}});
  return {source,target};
}
test('moves related records without transferring credentials or changing Japan financial rows',()=>{
  const {source,target}=fixture(), before=structuredClone(source); const p=planSplit(source,target);
  assert.equal(p.china.projects.length,1); assert.equal(p.japan.projects.length,1);
  assert.equal(p.china.projects[0].managerId,'cn-admin');
  assert.deepEqual(p.china.users,target.users); assert.deepEqual(p.japan.users,source.users);
  assert.deepEqual(p.japan.bankTransactions,source.bankTransactions.filter(x=>x.company==='JAPAN'));
  assert.equal(p.china.payments[0].amount,50); assert.equal(p.report.totals.issued,100);
  assert.equal(p.japan.auditLogs[0].beforeStateJson,undefined);
  assert.equal(p.china.auditLogs[0].afterJson,undefined); assert.deepEqual(source,before);
  assert(planSplit(p.japan,p.china).alreadyApplied);
});
test('conflicting target data and unmatched user identities fail closed',()=>{
  const {source,target}=fixture(); target.projects=[{id:'project-CHINA',name:'new data'}];
  assert.throws(()=>planSplit(source,target),/Target conflict/);
  target.projects=[]; target.users[0].email='another@example.invalid';
  assert.throws(()=>planSplit(source,target),/No existing China user/);
});
test('cross-company relationships are not silently dropped',()=>{
  const {source,target}=fixture(); source.projects[0].clientId='client-CHINA';
  assert.throws(()=>planSplit(source,target),/Broken reference/);
});
test('deleted Chinese mail stays archived while active mail blocks migration',()=>{
  const {source,target}=fixture(); source.mailDocuments=[{id:'old-mail',company:'CHINA',deletedAt:'2026-01-01',fileUrl:'/api/files/old.pdf'}];
  const p=planSplit(source,target); assert.equal(p.china.mailDocuments.length,0); assert.equal(p.legacyArchive.mailDocuments.length,1);
  delete source.mailDocuments[0].deletedAt; assert.throws(()=>planSplit(source,target),/Active Chinese mail/);
});
test('destination business records are preserved, and imports keep sync disabled',()=>{
  const {source,target}=fixture(); target.clients=[{id:'existing',company:'CHINA'}];
  source.bankSyncStates=[{id:'sync',company:'CHINA',autoSync:true,status:'RUNNING',runId:'old'}];
  const p=planSplit(source,target); assert.equal(p.china.clients[0].id,'existing'); assert.equal(p.china.bankSyncStates[0].autoSync,false);
});
test('file migration backs up, verifies hashes, and supports a safe no-op retry',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'triangle-migration-test-'));
  try {
    const {source,target}=fixture(); const sourceFile=path.join(root,'source.json'),targetFile=path.join(root,'target.json');
    const sourceUploads=path.join(root,'source-uploads'),targetUploads=path.join(root,'target-uploads');fs.mkdirSync(sourceUploads);fs.mkdirSync(targetUploads);
    fs.writeFileSync(sourceFile,JSON.stringify(source));fs.writeFileSync(targetFile,JSON.stringify(target));
    const args={sourceFile,targetFile,sourceUploads,targetUploads,backupRoot:path.join(root,'backup')};
    assert.throws(()=>migrateFiles(args),/Active attachment is missing/);
    fs.writeFileSync(path.join(sourceUploads,'document.pdf'),'example bytes');
    const dry=migrateFiles(args);assert.equal(dry.applied,false);assert.equal(fs.existsSync(args.backupRoot),false);
    const result=migrateFiles({...args,apply:true});assert.equal(result.applied,true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(args.backupRoot,'japan-before.json'))),source);
    assert.equal(fs.readFileSync(path.join(targetUploads,'document.pdf'),'utf8'),'example bytes');
    assert(migrateFiles({...args,apply:true}).alreadyApplied);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
