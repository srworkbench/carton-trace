const C=require('./core');let s=C.create('CT-104',[{sku:'MUG',name:'Stoneware mug',qty:24},{sku:'TEA',name:'Tea tin',qty:12},{sku:'BOT',name:'Bottle',qty:8}],['1','2','3','4']);
for(const [box,sku,n] of [['1','MUG',12],['2','MUG',12],['2','TEA',6],['3','TEA',6],['4','BOT',8]])s=C.assign(s,box,sku,n);
console.log(JSON.stringify({complete:C.complete(s),missingCarton:'2',contents:C.contents(s,'2'),state:s},null,2));
