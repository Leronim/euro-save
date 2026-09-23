require('reflect-metadata');
const {PrismaClient}=require('@prisma/client');
const {reportRange}=require(process.cwd()+'/dist/src/expenses/period-report.js');
const {salaryCycle,salaryResult}=require(process.cwd()+'/dist/src/mini-app/salary-calculator.js');
const {weeklyDigest}=require(process.cwd()+'/dist/src/expenses/weekly-digest.js');
const db=new PrismaClient();
(async()=>{
 const user=await db.user.findUniqueOrThrow({where:{telegramId:process.env.TELEGRAM_OWNER_ID}});
 const now=new Date(),range=reportRange('w',undefined,user.timezone,now);
 const text=await db.$transaction(async tx=>{
  const rows=await tx.expense.findMany({where:{userId:user.id,transactionDate:{gte:range.start,lte:now}},include:{category:true}});
  const pending=await tx.pendingExpense.count({where:{userId:user.id,status:{in:['pending','edited']}}});
  const saved=await tx.salaryPlan.findMany({where:{userId:user.id},orderBy:{currency:'asc'}}),plans=[];
  for(const plan of saved){
   const cycle=salaryCycle(plan.payday,user.timezone,now);
   const spent=await tx.expense.aggregate({where:{userId:user.id,currency:plan.currency,transactionDate:{gte:cycle.start,lte:now}},_sum:{amount:true},_count:true});
   const background=plan.background.reduce((sum,row)=>sum+Math.round(Number(row.amount)*100),0)/100;
   plans.push({currency:plan.currency,nextPayday:cycle.nextPayday,result:salaryResult(Number(plan.salary),background,Number(spent._sum.amount??0),cycle.days,cycle.elapsed,spent._count,Number(plan.savingsTarget))});
  }
  return weeklyDigest(range.label,rows,plans,pending);
 },{isolationLevel:'RepeatableRead'});
 if(process.argv.includes('--dry-run')){console.log(JSON.stringify({ok:true,dryRun:true,characters:text.length}));return;}
 if(text.length>4096)throw new Error('Report exceeds Telegram limit');
 const response=await fetch('https://api.telegram.org/bot'+process.env.TELEGRAM_BOT_TOKEN+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:user.telegramId,text}),signal:AbortSignal.timeout(30000)});
 const result=await response.json();if(!response.ok||!result.ok)throw new Error('Telegram delivery failed');
 console.log('Weekly report delivered');
})().catch(()=>{console.error('Weekly report failed');process.exitCode=1}).finally(()=>db.$disconnect());
