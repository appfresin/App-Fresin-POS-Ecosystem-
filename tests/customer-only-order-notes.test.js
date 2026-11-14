const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('deploy-ready/pos/app.js','utf8');
const start=source.indexOf('function orderCustomerNoteDisplay(');
const end=source.indexOf('\nfunction selfOrderOpenTableOrder(',start);
const ctx=vm.createContext({});vm.runInContext(source.slice(start,end),ctx);
test('legacy delivery metadata is removed in inline and multiline order notes',()=>{
  for(const separator of ['\n',' ']) {
    const note=['Tanpa gula','Kurir membayar harga produk di outlet; ongkir langsung diterima kurir dari pelanggan.','Pin lokasi: https://www.google.com/maps?q=1,2','Patokan alamat: Pagar hijau'].join(separator);
    assert.equal(ctx.orderGroupNote({note},{batch:1}), 'Tanpa gula');
    assert.equal(ctx.orderGroupNote({note:'old'},{batch:2,items:[{variantData:{orderBatchNote:note}}]}),'Tanpa gula');
  }
});
test('ordinary customer line breaks, empty notes and additional batches remain correct',()=>{
  assert.equal(ctx.orderGroupNote({note:'Tanpa gula\nEs sedikit'},{batch:1}),'Tanpa gula\nEs sedikit');
  assert.equal(ctx.orderGroupNote({note:'Patokan alamat: Pagar hijau'},{batch:1}),'');
  assert.equal(ctx.orderGroupNote({note:'Pesanan pertama'},{batch:2}),'');
});
