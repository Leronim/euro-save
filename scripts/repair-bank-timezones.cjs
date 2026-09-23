// Run inside the app container after deploying the timezone parser fix.
// Dry-run by default. --apply updates only dates exactly matching the old UTC parser.
require('reflect-metadata');
const {PrismaClient}=require('@prisma/client');
const {BankMessageParserService}=require(process.cwd()+'/dist/src/parser/bank-message-parser.service.js');
const db=new PrismaClient(),parser=new BankMessageParserService();
(async()=>{
 const owner=await db.user.findUniqueOrThrow({where:{telegramId:process.env.TELEGRAM_OWNER_ID}});
 const result=await db.$transaction(async tx=>{
  const counts={expense:0,pendingExpense:0,applied:process.argv.includes('--apply')};
  for(const table of ['expense','pendingExpense']){
   const rows=await tx[table].findMany({where:{userId:owner.id,incomingBankMessageId:{not:null},...(table==='expense'?{source:'ios_shortcuts'}:{status:{in:['pending','edited']}})},include:{incomingBankMessage:true}});
   for(const row of rows){
    const message=row.incomingBankMessage;if(!message?.receivedAt||!row.transactionDate)continue;
    const parsed=parser.parse(message.text,message.receivedAt);
    if(parsed.status!=='authorised'||!parsed.transactionTime||!parsed.transactionDate)continue;
    const [h,m]=parsed.transactionTime.split(':').map(Number);
    const old=new Date(message.receivedAt);old.setUTCHours(h,m,0,0);
    if(row.transactionDate.getTime()!==old.getTime()||old.getTime()===parsed.transactionDate.getTime())continue;
    counts[table]++;
    if(counts.applied)await tx[table].updateMany({where:{id:row.id,userId:owner.id,transactionDate:old,updatedAt:row.updatedAt},data:{transactionDate:parsed.transactionDate}});
   }
  }
  return counts;
 },{isolationLevel:'Serializable',timeout:30000});
 console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect());
