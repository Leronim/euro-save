'use strict';
const tg = window.Telegram?.WebApp;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = { period: 'm', anchor: '', tab: 'home', currency: 'EUR', report: null, categories: [], filter: null, query: '', limit: 30, loading: false, request: 0, editId: null, overview:null, dayFilter:null, pendingOpen:false, ruleMerchant:null, savedDate:null, historyMode:true, historyRows:[], historyFilters:{}, historyRequest:0 };
const money = (value, currency=state.currency) => new Intl.NumberFormat('ru-RU', {style:'currency',currency}).format(value);
const sum = rows => rows.reduce((s, row) => s + Math.round(Number(row.amount) * 100), 0) / 100;
const dateKey = value => new Intl.DateTimeFormat('en-CA', {timeZone:state.report.range.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const labelDate = value => new Intl.DateTimeFormat('ru-RU',{timeZone:state.report.range.timezone,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const colors = ['#367f61','#b69b60','#7898ac','#b6858b','#8a84ad','#90a765','#c3855a'];
const empty = text => `<div class="empty"><strong>Пока нет расходов</strong>${esc(text)}</div>`;
function applyTheme(){document.documentElement.classList.toggle('dark', tg?.colorScheme === 'dark');}
applyTheme();tg?.onEvent('themeChanged',applyTheme);tg?.ready();tg?.expand();
$('close').onclick = () => { if(tg?.initData) tg.close(); else { $('status').hidden=false; $('status').textContent='Можно закрыть эту вкладку и вернуться в Telegram.'; }};
function back(){if($('save').disabled||document.querySelector('dialog[open] button[type=submit]:disabled'))return;if($('editor').open){$('editor').close();return;}if($('budget-dialog').open){$('budget-dialog').close();return;}if($('rule-dialog').open){$('rule-dialog').close();return;}if(state.filter||state.dayFilter){state.dayFilter=null;state.filter=null;state.tab='categories';}else state.tab='home';render();}
tg?.BackButton.onClick(back);
function syncBack(){if($('editor').open || $('budget-dialog').open || $('rule-dialog').open || state.tab!=='home')tg?.BackButton.show();else tg?.BackButton.hide();}
async function api(path, options={}){
  const response=await fetch('/api/mini-app/'+path,{...options,headers:{'Content-Type':'application/json','X-Telegram-Init-Data':tg?.initData ?? '',...options.headers}});
  if(!response.ok){if(response.status===401)throw new Error('Откройте приложение заново кнопкой «Мои расходы» в вашем Telegram-боте.');const error=await response.json().catch(()=>({}));throw new Error(response.status===400||response.status===409||response.status===404?error.message:'Не удалось сохранить или загрузить данные. Попробуйте ещё раз.');}
  return response.json();
}
async function load(){
  const request=++state.request;state.loading=true;$('status').hidden=false;$('status').textContent='Загружаем расходы…';$('retry').hidden=true;$('content').hidden=true;
  $('controls').querySelectorAll('button,select').forEach(b=>b.disabled=true);$('add').disabled=true;
  try{
    const [report,categories]=await Promise.all([api(`report?period=${state.period}${state.anchor?'&anchor='+state.anchor:''}`),api('categories')]);
    if(request!==state.request)return;
    const overview=await api('overview?month='+report.range.anchor.slice(0,4)+'-'+report.range.anchor.slice(4,6));
    if(request!==state.request)return;
    state.overview=overview;state.report=report;state.categories=categories;state.anchor=report.range.anchor;
    const currencies=[...new Set([...report.expenses,...report.previous,...overview.budgets].map(r=>r.currency))].sort();
    if(!currencies.length)currencies.push('EUR');if(!currencies.includes(state.currency))state.currency=currencies[0];
    $('currency').innerHTML=currencies.map(c=>`<option ${c===state.currency?'selected':''}>${esc(c)}</option>`).join('');
    $('controls').hidden=false;$('status').hidden=true;$('content').hidden=false;state.loading=false;$('add').disabled=false;
    $('controls').querySelectorAll('button,select').forEach(b=>b.disabled=false);render();
  }catch(error){if(request!==state.request)return;state.loading=false;$('status').textContent=error.message;$('retry').hidden=false;$('controls').querySelectorAll('button,select').forEach(b=>b.disabled=false);}
}
function groups(rows){
  const map=new Map();for(const row of rows){const id=row.categoryId??'none';const group=map.get(id)??{id,name:row.category?.name??'Другое',emoji:row.category?.emoji??'◌',rows:[]};group.rows.push(row);map.set(id,group);}
  return [...map.values()].map(g=>({...g,amount:sum(g.rows)})).sort((a,b)=>b.amount-a.amount);
}
function categoryRows(items,total){return items.map((g,i)=>`<button class="row" data-category="${esc(g.id)}"><span class="badge">${esc(g.emoji)}</span><span class="name"><strong>${esc(g.name)}</strong><div class="progress"><i style="width:${total?g.amount/total*100:0}%;background:${colors[i%colors.length]}"></i></div></span><span class="amount">${esc(money(g.amount))}<small>${total?Math.round(g.amount/total*100):0}% · ${g.rows.length} оп.</small></span></button>`).join('');}
function operations(rows){return rows.map(row=>`<button class="row" data-edit="${esc(row.id)}"><span class="badge">${esc(row.category?.emoji??'◌')}</span><span class="name"><strong>${esc(merchantLabel(row.merchant??row.description??'Расход'))}</strong><small>${esc(labelDate(row.transactionDate))} · ${esc(row.category?.name??'Другое')}</small></span><span class="amount">${esc(money(Number(row.amount),row.currency))}<small>Изменить ›</small></span></button>`).join('');}
function render(){
  ++state.historyRequest;
  if(!state.report)return;
  const {range:r,expenses,previous}=state.report;const rows=expenses.filter(x=>x.currency===state.currency);const total=sum(rows);const old=sum(previous.filter(x=>x.currency===state.currency));const cats=groups(rows);
  $('title').textContent={home:'Обзор расходов',categories:'По категориям',operations:'Все операции',salary:'Калькулятор накоплений'}[state.tab];
  $('period-label').textContent=periodLabel();$('next').disabled=r.active;$('current').hidden=r.active;
  document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===state.tab);b.setAttribute('aria-current',b.dataset.tab===state.tab?'page':'false');});
  document.querySelectorAll('[data-period]').forEach(b=>b.classList.toggle('selected',b.dataset.period===state.period));
  $('controls').hidden=state.tab==='salary'||state.tab==='operations'&&state.historyMode;
  $('add').hidden=state.tab==='salary';
  syncBack();renderNotice();
  if(state.tab==='home'){
    const change=old?`${total<old?'↓':total>old?'↑':'→'} ${Math.abs((total-old)/old*100).toFixed(0)}% к прошлому периоду`:'Нет расходов для сравнения';
    const start=new Date(r.start);const first=dateKey(start);const days=Array.from({length:r.elapsed},(_,i)=>{const d=new Date(first+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);const key=d.toISOString().slice(0,10);return {key,amount:sum(rows.filter(row=>dateKey(row.transactionDate)===key))};});const max=Math.max(...days.map(d=>d.amount),1);
    $('content').innerHTML=`<section class="card hero"><small>${r.active?'Потрачено к этому моменту':'Всего за период'}</small><div class="total">${esc(money(total))}</div><div class="comparison">${esc(change)}</div>${budgetSummary(total)}<p class="note">${r.active?'Сравнение с тем же отрезком прошлого периода.':'Сравнение с полным предыдущим периодом.'} Только подтверждённые расходы.${comparisonReason(rows,previous.filter(x=>x.currency===state.currency))}</p></section>${pendingSummary()}<div class="metrics"><div class="metric"><small>В среднем за день</small><strong>${esc(money(total/r.elapsed))}</strong></div><div class="metric"><small>Операций за период</small><strong>${rows.length}</strong></div></div><section class="card"><div class="section-title"><h2>Ритм расходов</h2><small>По дням</small></div><div class="chart">${days.map(d=>`<button class="bar" style="height:${Math.max(3,d.amount/max*100)}%" data-day="${esc(d.key)}" aria-label="${esc(d.key+': '+money(d.amount))}"></button>`).join('')}</div><div class="axis"><span>${first.slice(8)}.${first.slice(5,7)}</span><span>${days.at(-1).key.slice(8)}.${days.at(-1).key.slice(5,7)}</span></div><p id="chart-note" class="chart-note">Нажмите на день, чтобы открыть покупки</p></section>${state.period==='m'&&r.active&&r.elapsed>=3?`<p class="muted">Прогноз к концу месяца: ≈ ${esc(money(total/r.elapsed*r.days))}<br>По среднему расходу за день, без учёта будущих покупок.</p>`:''}<section class="card"><div class="section-title"><h2>На что уходит</h2><button class="text-button" data-go="categories">Все ›</button></div>${cats.length?categoryRows(cats.slice(0,3),total):empty('Добавьте первую покупку кнопкой сверху.')}</section>`;
    document.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{state.dayFilter=b.dataset.day;state.filter=null;state.tab='operations';state.historyMode=false;state.query='';render();});
  }else if(state.tab==='categories'){
    let offset=0;const gradient=cats.map((g,i)=>{const start=offset;offset+=total?g.amount/total*100:0;return `${colors[i%colors.length]} ${start}% ${offset}%`;}).join(',');
    $('content').innerHTML=`<section class="card">${cats.length?`<div class="donut" role="img" aria-label="Распределение расходов по категориям" style="background:conic-gradient(${gradient})"><div><strong>${cats.length}</strong><small>категорий</small></div></div>${categoryRows(cats,total)}`:empty('Здесь появятся категории ваших покупок.')}</section><p class="muted">Нажмите на категорию, чтобы посмотреть покупки.</p>${rulesSummary()}`;
  }else if(state.tab==='salary'){
    renderSalary();
  }else if(state.historyMode){
    renderHistory();
  }else{
    $('content').innerHTML=`<button class="text-button" id="all-history">Вся история и фильтры →</button><input class="search" id="search" type="search" placeholder="Найти магазин или описание" aria-label="Поиск операций" value="${esc(state.query)}">${state.filter||state.dayFilter?`<div class="filter"><span>${esc(state.dayFilter?dayLabel(state.dayFilter):cats.find(c=>c.id===state.filter)?.name??'Категория')}</span><button class="quiet" id="clear-filter">Сбросить ✕</button></div>`:''}<div class="card" id="operation-list"></div>`;
    $('all-history').onclick=()=>{state.historyMode=true;render();};
    const list=()=>{const matches=rows.filter(row=>(!state.dayFilter||dateKey(row.transactionDate)===state.dayFilter)&&(!state.filter||(row.categoryId??'none')===state.filter)&&`${row.merchant??''} ${row.description??''}`.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));$('operation-list').innerHTML=matches.length?groupedOperations(matches.slice(0,state.limit),matches)+(matches.length>state.limit?'<button class="more" id="more">Показать ещё</button>':''):'<div class="empty"><strong>Ничего не найдено</strong>Измените поиск, категорию или период.</div>';wireRows();if($('more'))$('more').onclick=()=>{state.limit+=30;list();};};
    $('search').oninput=e=>{state.query=e.target.value;state.limit=30;list();};if($('clear-filter'))$('clear-filter').onclick=()=>{state.filter=null;state.dayFilter=null;render();};list();
  }
  wireExtras();wireRows();document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.go;render();});
}
function wireRows(){document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{state.dayFilter=null;state.filter=b.dataset.category;state.tab='operations';state.historyMode=false;state.query='';state.limit=30;render();});document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor((state.tab==='operations'&&state.historyMode?state.historyRows:state.report.expenses).find(r=>r.id===b.dataset.edit)));}
function openEditor(row){
  $('delete-expense').hidden=!row;const f=$('expense-form');state.editId=row?.id??null;$('editor-title').textContent=row?'Изменить расход':'Новый расход';f.reset();$('merchant-scope').hidden=!row;
  f.elements.categoryId.innerHTML=state.categories.map(c=>`<option value="${esc(c.id)}">${esc(c.emoji??'')} ${esc(c.name)}</option>`).join('');
  f.elements.merchant.value=row?.merchant??row?.description??'';f.elements.amount.value=row?Number(row.amount):'';f.elements.currency.value=row?.currency??state.currency;
  if(row?.categoryId)f.elements.categoryId.value=row.categoryId;
  $('merchant-original').hidden=!row?.merchant;$('merchant-original').textContent=row?.merchant?'В банковском сообщении: '+row.merchant:'';
  const date=row?new Date(row.transactionDate):new Date();f.elements.transactionDate.value=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
  $('form-error').textContent='';$('editor').showModal();syncBack();
}
$('expense-form').onsubmit=async event=>{
  event.preventDefault();const f=event.target;const input={merchant:f.elements.merchant.value.trim(),amount:Number(f.elements.amount.value),currency:f.elements.currency.value.toUpperCase(),categoryId:f.elements.categoryId.value,applyToMerchant:!!state.editId&&f.elements.applyToMerchant.checked,transactionDate:new Date(f.elements.transactionDate.value).toISOString()};
  $('save').disabled=true;$('delete-expense').disabled=true;$('dismiss').disabled=true;$('form-error').textContent='';
  try{if(input.applyToMerchant&&!await approveMerchant(input.merchant))return;const saved=await api('expenses'+(state.editId?'/'+state.editId:''),{method:state.editId?'PATCH':'POST',body:JSON.stringify(input)});$('editor').close();tg?.HapticFeedback.notificationOccurred('success');state.savedDate=input.transactionDate;await load();}
  catch(error){$('form-error').textContent=error.message;}
  finally{$('save').disabled=false;$('delete-expense').disabled=false;$('dismiss').disabled=false;syncBack();}
};
$('editor').addEventListener('cancel',e=>{if($('save').disabled)e.preventDefault();});$('editor').addEventListener('close',syncBack);
$('dismiss').onclick=()=>$('editor').close();$('add').onclick=()=>openEditor();$('retry').onclick=load;
$('currency').onchange=e=>{state.currency=e.target.value;render();};
$('prev').onclick=()=>{state.dayFilter=null;state.anchor=state.report.range.previousAnchor;load();};$('next').onclick=()=>{state.dayFilter=null;state.anchor=state.report.range.nextAnchor;load();};$('current').onclick=()=>{state.dayFilter=null;state.anchor='';load();};
document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{state.period=b.dataset.period;state.anchor='';state.dayFilter=null;state.limit=30;load();});
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;state.historyMode=true;state.filter=null;state.dayFilter=null;state.limit=30;render();});
load();

function merchantLabel(name){if(/\bzorba['’]?s\b/i.test(name))return 'Zorbas';if(/^lidl\b/i.test(name))return 'Lidl';return name;}
function periodLabel(){const r=state.report.range;const fmt=options=>new Intl.DateTimeFormat('ru-RU',{timeZone:r.timezone,...options});if(state.period==='m')return fmt({month:'long',year:'numeric'}).format(new Date(r.start)).replace(' г.','');const end=new Date(r.start);end.setUTCDate(end.getUTCDate()+6);return fmt({day:'numeric',month:'short'}).format(new Date(r.start))+' – '+fmt({day:'numeric',month:'short'}).format(end);}
function dayLabel(key){const today=dateKey(new Date());const yesterday=new Date(today+'T12:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);return key===today?'Сегодня':key===yesterday.toISOString().slice(0,10)?'Вчера':new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(new Date(key+'T12:00:00Z'));}
function groupedOperations(shown,all){let last='';return shown.map(row=>{const key=dateKey(row.transactionDate);const heading=key!==last?`<div class="day-heading"><strong>${esc(dayLabel(key))}</strong><span>${esc(money(sum(all.filter(x=>dateKey(x.transactionDate)===key))))}</span></div>`:'';last=key;return heading+operations([row]);}).join('');}
function comparisonReason(rows,previous){const old=groups(previous);const changes=groups(rows).map(g=>({name:g.name,delta:g.amount-(old.find(o=>o.id===g.id)?.amount??0)})).filter(g=>g.delta>0).sort((a,b)=>b.delta-a.delta);return previous.length&&changes.length?`<br>${esc(changes[0].name)}: на ${esc(money(changes[0].delta))} больше.`:'';}
function budgetSummary(total){if(state.period!=='m')return '';const budget=state.overview.budgets.find(b=>b.currency===state.currency);if(!budget)return '<button class="budget-link" id="set-budget">＋ Задать бюджет на месяц</button>';const limit=Number(budget.amount),left=limit-total;const r=state.report.range;return `<div class="budget-block"><div><span>${left>=0?'Осталось':'Сверх бюджета'}</span><strong>${esc(money(Math.abs(left)))}</strong></div><div class="budget-track"><i style="width:${Math.min(100,total/limit*100)}%"></i></div><small>Из ${esc(money(limit))}${r.active?' · '+esc(money(Math.max(0,left)/(r.days-r.elapsed+1)))+' в день до конца месяца':''}</small><button id="set-budget" class="budget-link">Изменить бюджет</button></div>`;}
function pendingSummary(){const rows=state.overview.pending;if(!rows.length)return '';return `<section class="card pending"><button class="pending-toggle" id="pending-toggle"><strong>Ждут подтверждения <span>${rows.length}</span></strong><span>${state.pendingOpen?'Свернуть ↑':'Проверить →'}</span></button>${state.pendingOpen?rows.map(row=>`<div class="pending-row"><strong>${esc(merchantLabel(row.merchant??row.description??'Покупка'))}</strong><p>${esc(new Intl.NumberFormat('ru-RU',{style:'currency',currency:row.currency}).format(Number(row.amount)))}</p><select aria-label="Категория покупки" data-pending-category="${esc(row.id)}">${categoryOptions(row.categoryId)}</select><div class="pending-actions"><button class="primary" data-pending="${esc(row.id)}" data-action="confirm">Записать</button><button data-pending="${esc(row.id)}" data-action="ignore">Игнорировать</button></div></div>`).join(''):''}</section>`;}
function categoryOptions(id){return state.categories.map(c=>`<option value="${esc(c.id)}" ${c.id===id?'selected':''}>${esc(c.emoji??'')} ${esc(c.name)}</option>`).join('');}
function rulesSummary(){const rules=state.overview.rules;return `<section class="card"><h2>Правила магазинов</h2><p class="muted">Категории, которые вы выбрали для всех покупок магазина.</p>${rules.length?rules.map(rule=>`<button class="row" data-rule="${esc(rule.id)}"><span class="name"><strong>${esc(merchantLabel(rule.merchantName))}</strong><small>${esc(rule.category.emoji??'')} ${esc(rule.category.name)}</small></span><span>Изменить ›</span></button>`).join(''):'<p class="muted">Здесь появятся ваши сохранённые правила.</p>'}</section>`;}
async function approveMerchant(merchant){const {count}=await api('merchant-count?merchant='+encodeURIComponent(merchant));if(count<2)return true;return new Promise(resolve=>{const text=`Применить категорию к ${count} покупкам магазина и запомнить для будущих?`;if(tg?.initData)tg.showConfirm(text,resolve);else resolve(window.confirm(text));});}
function renderNotice(){const action=state.overview.lastAction;const other=state.savedDate&&(new Date(state.savedDate)<new Date(state.report.range.start)||new Date(state.savedDate)>new Date(state.report.range.cutoff));$('notice').hidden=!action&&!other;$('notice').innerHTML=(action?'<span>Последнее действие можно отменить в течение 10 минут.</span><button id="undo-action">Отменить</button>':'')+(other?'<button id="show-saved">Перейти к сохранённой покупке</button>':'');if($('undo-action'))$('undo-action').onclick=async()=>{try{$('undo-action').disabled=true;await api('undo/'+action.id,{method:'POST'});state.savedDate=null;await load();}catch(error){showError(error);if($('undo-action'))$('undo-action').disabled=false;}};if($('show-saved'))$('show-saved').onclick=()=>{state.period='m';state.anchor=dateKey(state.savedDate).replaceAll('-','');state.tab='operations';state.filter=null;state.dayFilter=null;state.savedDate=null;load();};}
function showError(error){$('status').hidden=false;$('status').textContent=error.message;}
function wireExtras(){
  if($('set-budget'))$('set-budget').onclick=()=>{const form=$('budget-form');form.elements.amount.value=state.overview.budgets.find(b=>b.currency===state.currency)?.amount??'';$('budget-month').textContent=periodLabel()+' · '+state.currency;form.querySelector('.form-message').textContent='';$('budget-dialog').showModal();syncBack();};
  if($('pending-toggle'))$('pending-toggle').onclick=()=>{state.pendingOpen=!state.pendingOpen;render();};
  document.querySelectorAll('[data-pending]').forEach(button=>button.onclick=async()=>{const id=button.dataset.pending;const row=button.closest('.pending-row');row.querySelectorAll('button,select').forEach(b=>b.disabled=true);try{await api('pending/'+id,{method:'POST',body:JSON.stringify({action:button.dataset.action,categoryId:row.querySelector('select').value})});await load();}catch(error){showError(error);row.querySelectorAll('button,select').forEach(b=>b.disabled=false);}});
  document.querySelectorAll('[data-rule]').forEach(button=>button.onclick=()=>{const rule=state.overview.rules.find(r=>r.id===button.dataset.rule);state.ruleMerchant=rule.merchantName;$('rule-name').textContent=rule.merchantName;$('rule-form').elements.categoryId.innerHTML=categoryOptions(rule.categoryId);$('rule-form').querySelector('.form-message').textContent='';$('rule-dialog').showModal();syncBack();});
}
async function saveModal(form,operation,dialog){const buttons=form.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);try{await operation();$(dialog).close();await load();}catch(error){form.querySelector('.form-message').textContent=error.message;}finally{buttons.forEach(b=>b.disabled=false);syncBack();}}
$('budget-form').onsubmit=e=>{e.preventDefault();saveModal(e.target,()=>api('budget',{method:'POST',body:JSON.stringify({month:state.anchor.slice(0,4)+'-'+state.anchor.slice(4,6),currency:state.currency,amount:Number(e.target.elements.amount.value)})}),'budget-dialog');};
$('rule-form').onsubmit=e=>{e.preventDefault();saveModal(e.target,async()=>{if(!await approveMerchant(state.ruleMerchant))return;await api('rules',{method:'POST',body:JSON.stringify({merchant:state.ruleMerchant,categoryId:e.target.elements.categoryId.value})});},'rule-dialog');};
document.querySelectorAll('[data-dismiss]').forEach(button=>button.onclick=()=>{$(button.dataset.dismiss).close();syncBack();});
for(const id of ['budget-dialog','rule-dialog']){$(id).addEventListener('close',syncBack);$(id).addEventListener('cancel',e=>{if($(id).querySelector('button[type="submit"]').disabled)e.preventDefault();});}

function renderHistory(){
  const f=state.historyFilters;
  const field=(name,label,type='text')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(f[name]??'')}" ${type==='number'?'min="0" max="9999999999.99" step="0.01" inputmode="decimal"':''} ${type==='text'?'maxlength="200"':''}></label>`;
  const count=Object.values(f).filter(Boolean).length;
  $('content').innerHTML=`<p class="muted">${f.from||f.to?`Период: ${esc(f.from??'')||'с начала истории'} — ${esc(f.to??'')||'без верхней границы'}`:'История за все месяцы. Даты можно ограничить в фильтрах.'}</p><input class="search" id="history-search" type="search" maxlength="200" placeholder="Поиск по всей истории" aria-label="Поиск по всей истории" value="${esc(state.query)}"><details class="card history-filters"><summary>Фильтры${count?' · '+count:''}</summary><form id="history-form"><div class="form-grid">${field('from','С даты','date')}${field('to','По дату включительно','date')}</div>${field('merchant','Магазин содержит')}<label>Категория<select name="category"><option value="">Все категории</option><option value="none" ${f.category==='none'?'selected':''}>Без категории</option>${categoryOptions(f.category)}</select></label><label>Валюта<select name="currency" id="history-currency"><option value="">Все валюты</option>${[...new Set(['EUR',f.currency].filter(Boolean))].map(c=>`<option ${f.currency===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label><div class="form-grid">${field('min','Сумма от','number')}${field('max','Сумма до','number')}</div><p class="muted">Суммы сравниваются в валюте каждой операции.</p><div class="pending-actions"><button type="submit" class="primary">Применить</button><button type="button" id="history-reset">Сбросить</button></div></form></details><p id="history-summary" class="muted" role="status"></p><section class="card" id="history-list"></section>`;
  $('history-form').elements.category.value=f.category??'';
  $('history-form').onsubmit=e=>{e.preventDefault();state.historyFilters=Object.fromEntries(new FormData(e.target));render();};
  $('history-reset').onclick=()=>{state.historyFilters={};state.query='';render();};
  let timer;
  $('history-search').oninput=e=>{state.query=e.target.value;clearTimeout(timer);++state.historyRequest;timer=setTimeout(()=>{if(state.tab==='operations'&&state.historyMode)loadHistory();},300);};
  loadHistory();
}
async function loadHistory(offset=0){
  const request=++state.historyRequest;
  const list=$('history-list'),summary=$('history-summary');
  if(!list)return;
  if(!offset){state.historyRows=[];list.innerHTML='';}
  if($('history-more'))$('history-more').disabled=true;
  summary.textContent='Загружаем историю…';
  try{
    const result=await api('history?'+new URLSearchParams({...state.historyFilters,q:state.query,offset:String(offset)}));
    if(request!==state.historyRequest)return;
    state.historyRows=offset?[...state.historyRows,...result.rows]:result.rows;
    summary.textContent=`Найдено: ${result.total} · `+(result.totals.map(t=>money(Number(t.amount),t.currency)).join(' + ')||'Нет расходов');
    const select=$('history-currency'),selected=select.value;
    select.innerHTML='<option value="">Все валюты</option>'+[...new Set(['EUR',...result.currencies,selected].filter(Boolean))].sort().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');select.value=selected;
    let last='';
    list.innerHTML=state.historyRows.length?state.historyRows.map(row=>{const key=dateKey(row.transactionDate);const heading=key!==last?`<div class="day-heading"><strong>${esc(dayLabel(key))}</strong></div>`:'';last=key;return heading+operations([row]);}).join(''):'<div class="empty"><strong>Ничего не найдено</strong>Измените поиск или сбросьте фильтры.</div>';
    if(result.nextOffset!==null){list.insertAdjacentHTML('beforeend','<button class="more" id="history-more">Показать ещё</button>');$('history-more').onclick=()=>loadHistory(result.nextOffset);}
    wireRows();
  }catch(error){if(request!==state.historyRequest)return;summary.textContent=error.message;list.insertAdjacentHTML('beforeend','<button class="more" id="history-retry">Попробовать снова</button>');$('history-retry').onclick=()=>{$('history-retry').remove();loadHistory(offset);};}
}
$('delete-expense').onclick=async()=>{
  if(!state.editId)return;
  const buttons=[$('save'),$('dismiss'),$('delete-expense')];buttons.forEach(b=>b.disabled=true);$('form-error').textContent='';
  try{await api('expenses/'+state.editId,{method:'DELETE'});$('editor').close();state.savedDate=null;tg?.HapticFeedback.notificationOccurred('success');await load();}
  catch(error){$('form-error').textContent=error.message;}
  finally{buttons.forEach(b=>b.disabled=false);syncBack();}
};

async function renderSalary(){
  const request=state.historyRequest;
  const currency=state.salaryCurrency??state.currency;
  $('content').innerHTML='<p class="muted" role="status">Загружаем калькулятор…</p>';
  try{
    const result=await api('salary?currency='+encodeURIComponent(currency));
    if(request!==state.historyRequest||state.tab!=='salary')return;
    const p=result.plan;
    $('content').innerHTML=`<section class="card"><form id="salary-form"><h2>От зарплаты до зарплаты</h2><p class="muted">Настройки сохраняются и используются каждый зарплатный период.</p><div class="form-grid"><label>Зарплата на руки<input name="salary" type="number" min="0" max="9999999999.99" step="0.01" inputmode="decimal" required value="${result.configured?esc(p.salary):''}" placeholder="0.00"></label><label>Валюта<select name="currency" id="salary-currency">${[...new Set(['EUR','USD','GBP',currency,...state.report.expenses.map(r=>r.currency)])].sort().map(c=>`<option value="${esc(c)}" ${c===currency?'selected':''}>${esc(c)}</option>`).join('')}</select></label></div><label>День выплаты зарплаты<input name="payday" type="number" min="1" max="31" step="1" required value="${p.payday}"></label><p class="muted">По умолчанию — 27-е. Если такого числа в месяце нет, используем последний день.</p><h2>Фоновые расходы за период</h2><p class="muted">Только расходы, которых нет в приложении. Например, аренда наличными. Не добавляйте сюда уже записанные покупки, иначе они вычтутся дважды.</p><div id="background-rows"></div><button type="button" class="text-button" id="background-add">＋ Добавить расход</button><p id="salary-error" role="alert"></p><button type="submit" class="primary">Рассчитать и сохранить</button></form></section><div id="salary-result"></div>`;
    p.background.forEach(addBackgroundRow);
    $('background-add').onclick=()=>{if($('background-rows').children.length<30)addBackgroundRow({name:'',amount:''});salaryDirty();};
    $('salary-currency').onchange=e=>{state.salaryCurrency=e.target.value;render();};
    $('salary-form').oninput=salaryDirty;
    $('salary-form').onsubmit=async e=>{
      e.preventDefault();const form=e.target;
      const input={salary:Number(form.elements.salary.value),payday:Number(form.elements.payday.value),currency:form.elements.currency.value,background:[...$('background-rows').children].map(row=>({name:row.querySelector('[name=backgroundName]').value.trim(),amount:Number(row.querySelector('[name=backgroundAmount]').value)}))};
      form.querySelectorAll('button,input,select').forEach(b=>b.disabled=true);$('salary-error').textContent='';
      const current=state.historyRequest;
      try{const saved=await api('salary',{method:'POST',body:JSON.stringify(input)});if(current===state.historyRequest&&state.tab==='salary')showSalaryResult(saved);}
      catch(error){if(current===state.historyRequest&&$('salary-error'))$('salary-error').textContent=error.message;}
      finally{form.querySelectorAll('button,input,select').forEach(b=>b.disabled=false);}
    };
    if(result.configured)showSalaryResult(result);
  }catch(error){if(request!==state.historyRequest)return;$('content').innerHTML=`<p role="alert">${esc(error.message)}</p><button id="salary-retry">Попробовать снова</button>`;$('salary-retry').onclick=()=>render();}
}
function salaryDirty(){if($('salary-result'))$('salary-result').innerHTML='<p class="muted">Нажмите «Рассчитать и сохранить», чтобы обновить результат.</p>';}
function addBackgroundRow(item){
  const row=document.createElement('div');row.className='background-row';
  row.innerHTML=`<label>Название<input name="backgroundName" maxlength="100" required placeholder="Например, аренда" value="${esc(item.name)}"></label><label>Сумма<input name="backgroundAmount" type="number" min="0" max="9999999999.99" step="0.01" inputmode="decimal" required value="${esc(item.amount)}"></label><button type="button" class="quiet" aria-label="Убрать фоновый расход">✕</button>`;
  row.querySelector('button').onclick=()=>{row.remove();salaryDirty();};$('background-rows').append(row);
}
function showSalaryResult(result){
  const r=result,fmt=value=>money(value,r.plan.currency);
  $('salary-result').innerHTML=`<section class="card hero"><small>${esc(r.cycle.label)}</small><h2>${r.remaining>=0?'Остаток сейчас':'Не хватает уже сейчас'}</h2><div class="total">${esc(fmt(Math.abs(r.remaining)))}</div><p class="note">Зарплата минус все фоновые расходы периода и подтверждённые расходы из приложения. Это расчётный остаток, а не баланс банковского счёта.</p></section><section class="card"><h2>Из чего складывается</h2><div class="salary-line"><span>Зарплата на руки</span><strong>${esc(fmt(r.plan.salary))}</strong></div><div class="salary-line"><span>Фоновые расходы</span><strong>− ${esc(fmt(r.background))}</strong></div><div class="salary-line"><span>В приложении · ${r.count} оп.</span><strong>− ${esc(fmt(r.spent))}</strong></div><p class="muted">Следующая зарплата: ${esc(r.cycle.nextPayday)}. Учитывается только ${esc(r.plan.currency)}, без пересчёта других валют.${r.pendingCount?` Есть неподтверждённые покупки (${r.pendingCount}) — они пока не включены.`:''}</p></section><section class="card"><h2>${r.projectedSavings!==null&&r.projectedSavings<0?'Возможный дефицит к зарплате':'Получится отложить к зарплате'}</h2>${r.projectedSavings===null?'<p class="muted">Прогноз появится после трёх дней периода, когда будет хотя бы один подтверждённый расход.</p>':`<div class="total">≈ ${esc(fmt(Math.abs(r.projectedSavings)))}</div><p class="muted">При сохранении среднего темпа расходов за ${r.cycle.elapsed} дн. Ожидаемые расходы в приложении за весь период: ${esc(fmt(r.projectedExpenses))}. Фоновые расходы вычтены один раз. Неполный день и крупные разовые покупки могут заметно менять прогноз.</p>`}</section>`;
}
