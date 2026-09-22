'use strict';
const tg = window.Telegram?.WebApp;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = { period: 'm', anchor: '', tab: 'home', currency: 'EUR', report: null, categories: [], filter: null, query: '', limit: 30, loading: false, request: 0, editId: null };
const money = value => new Intl.NumberFormat('ru-RU', {style:'currency',currency:state.currency}).format(value);
const sum = rows => rows.reduce((s, row) => s + Math.round(Number(row.amount) * 100), 0) / 100;
const dateKey = value => new Intl.DateTimeFormat('en-CA', {timeZone:state.report.range.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const labelDate = value => new Intl.DateTimeFormat('ru-RU',{timeZone:state.report.range.timezone,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const colors = ['#367f61','#b69b60','#7898ac','#b6858b','#8a84ad','#90a765','#c3855a'];
const empty = text => `<div class="empty"><strong>Пока нет расходов</strong>${esc(text)}</div>`;
function applyTheme(){document.documentElement.classList.toggle('dark', tg?.colorScheme === 'dark');}
applyTheme();tg?.onEvent('themeChanged',applyTheme);tg?.ready();tg?.expand();
$('close').onclick = () => { if(tg?.initData) tg.close(); else { $('status').hidden=false; $('status').textContent='Можно закрыть эту вкладку и вернуться в Telegram.'; }};
function back(){if($('save').disabled)return;if($('editor').open){$('editor').close();return;}if(state.filter){state.filter=null;state.tab='categories';}else state.tab='home';render();}
tg?.BackButton.onClick(back);
function syncBack(){if($('editor').open || state.tab!=='home')tg?.BackButton.show();else tg?.BackButton.hide();}
async function api(path, options={}){
  const response=await fetch('/api/mini-app/'+path,{...options,headers:{'Content-Type':'application/json','X-Telegram-Init-Data':tg?.initData ?? '',...options.headers}});
  if(!response.ok){if(response.status===401)throw new Error('Откройте приложение заново кнопкой «Мои расходы» в вашем Telegram-боте.');throw new Error('Не удалось сохранить или загрузить данные. Попробуйте ещё раз.');}
  return response.json();
}
async function load(){
  const request=++state.request;state.loading=true;$('status').hidden=false;$('status').textContent='Загружаем расходы…';$('retry').hidden=true;$('content').hidden=true;
  $('controls').querySelectorAll('button,select').forEach(b=>b.disabled=true);$('add').disabled=true;
  try{
    const [report,categories]=await Promise.all([api(`report?period=${state.period}${state.anchor?'&anchor='+state.anchor:''}`),api('categories')]);
    if(request!==state.request)return;
    state.report=report;state.categories=categories;state.anchor=report.range.anchor;
    const currencies=[...new Set([...report.expenses,...report.previous].map(r=>r.currency))].sort();
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
function operations(rows){return rows.map(row=>`<button class="row" data-edit="${esc(row.id)}"><span class="badge">${esc(row.category?.emoji??'◌')}</span><span class="name"><strong>${esc(row.merchant??row.description??'Расход')}</strong><small>${esc(labelDate(row.transactionDate))} · ${esc(row.category?.name??'Другое')}</small></span><span class="amount">${esc(money(Number(row.amount)))}<small>Изменить ›</small></span></button>`).join('');}
function render(){
  if(!state.report)return;
  const {range:r,expenses,previous}=state.report;const rows=expenses.filter(x=>x.currency===state.currency);const total=sum(rows);const old=sum(previous.filter(x=>x.currency===state.currency));const cats=groups(rows);
  $('title').textContent={home:'Обзор расходов',categories:'По категориям',operations:'Все операции'}[state.tab];
  $('period-label').textContent=r.label;$('next').disabled=r.active;$('current').hidden=r.active;
  document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===state.tab);b.setAttribute('aria-current',b.dataset.tab===state.tab?'page':'false');});
  document.querySelectorAll('[data-period]').forEach(b=>b.classList.toggle('selected',b.dataset.period===state.period));
  syncBack();
  if(state.tab==='home'){
    const change=old?`${total<old?'↓':total>old?'↑':'→'} ${Math.abs((total-old)/old*100).toFixed(0)}% к прошлому периоду`:'Нет расходов для сравнения';
    const start=new Date(r.start);const first=dateKey(start);const days=Array.from({length:r.elapsed},(_,i)=>{const d=new Date(first+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);const key=d.toISOString().slice(0,10);return {key,amount:sum(rows.filter(row=>dateKey(row.transactionDate)===key))};});const max=Math.max(...days.map(d=>d.amount),1);
    $('content').innerHTML=`<section class="card hero"><small>${r.active?'Потрачено к этому моменту':'Всего за период'}</small><div class="total">${esc(money(total))}</div><div class="comparison">${esc(change)}</div><p class="note">${r.active?'Сравнение с тем же отрезком прошлого периода.':'Сравнение с полным предыдущим периодом.'} Только подтверждённые расходы.</p></section><div class="metrics"><div class="metric"><small>В среднем за день</small><strong>${esc(money(total/r.elapsed))}</strong></div><div class="metric"><small>Операций за период</small><strong>${rows.length}</strong></div></div><section class="card"><div class="section-title"><h2>Ритм расходов</h2><small>По дням</small></div><div class="chart">${days.map(d=>`<button class="bar" style="height:${Math.max(3,d.amount/max*100)}%" data-day="${esc(d.key)}" aria-label="${esc(d.key+': '+money(d.amount))}"></button>`).join('')}</div><div class="axis"><span>${first.slice(8)}.${first.slice(5,7)}</span><span>${days.at(-1).key.slice(8)}.${days.at(-1).key.slice(5,7)}</span></div><p id="chart-note" class="chart-note">Нажмите на столбик, чтобы увидеть сумму</p></section>${state.period==='m'&&r.active&&r.elapsed>=3?`<p class="muted">Прогноз к концу месяца: ≈ ${esc(money(total/r.elapsed*r.days))}<br>По среднему расходу за день, без учёта будущих покупок.</p>`:''}<section class="card"><div class="section-title"><h2>На что уходит</h2><button class="text-button" data-go="categories">Все ›</button></div>${cats.length?categoryRows(cats.slice(0,3),total):empty('Добавьте первую покупку кнопкой сверху.')}</section>`;
    document.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{$('chart-note').textContent=b.dataset.day.split('-').reverse().join('.')+' · '+money(days.find(d=>d.key===b.dataset.day).amount);});
  }else if(state.tab==='categories'){
    let offset=0;const gradient=cats.map((g,i)=>{const start=offset;offset+=total?g.amount/total*100:0;return `${colors[i%colors.length]} ${start}% ${offset}%`;}).join(',');
    $('content').innerHTML=`<section class="card">${cats.length?`<div class="donut" role="img" aria-label="Распределение расходов по категориям" style="background:conic-gradient(${gradient})"><div><strong>${cats.length}</strong><small>категорий</small></div></div>${categoryRows(cats,total)}`:empty('Здесь появятся категории ваших покупок.')}</section><p class="muted">Нажмите на категорию, чтобы посмотреть покупки.</p>`;
  }else{
    $('content').innerHTML=`<input class="search" id="search" type="search" placeholder="Найти магазин или описание" aria-label="Поиск операций" value="${esc(state.query)}">${state.filter?`<div class="filter"><span>${esc(cats.find(c=>c.id===state.filter)?.name??'Категория')}</span><button class="quiet" id="clear-filter">Сбросить ✕</button></div>`:''}<div class="card" id="operation-list"></div>`;
    const list=()=>{const matches=rows.filter(row=>(!state.filter||(row.categoryId??'none')===state.filter)&&`${row.merchant??''} ${row.description??''}`.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));$('operation-list').innerHTML=matches.length?operations(matches.slice(0,state.limit))+(matches.length>state.limit?'<button class="more" id="more">Показать ещё</button>':''):'<div class="empty"><strong>Ничего не найдено</strong>Измените поиск, категорию или период.</div>';wireRows();if($('more'))$('more').onclick=()=>{state.limit+=30;list();};};
    $('search').oninput=e=>{state.query=e.target.value;state.limit=30;list();};if($('clear-filter'))$('clear-filter').onclick=()=>{state.filter=null;render();};list();
  }
  wireRows();document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.go;render();});
}
function wireRows(){document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.category;state.tab='operations';state.query='';state.limit=30;render();});document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(state.report.expenses.find(r=>r.id===b.dataset.edit)));}
function openEditor(row){
  const f=$('expense-form');state.editId=row?.id??null;$('editor-title').textContent=row?'Изменить расход':'Новый расход';f.reset();
  f.elements.categoryId.innerHTML=state.categories.map(c=>`<option value="${esc(c.id)}">${esc(c.emoji??'')} ${esc(c.name)}</option>`).join('');
  f.elements.merchant.value=row?.merchant??row?.description??'';f.elements.amount.value=row?Number(row.amount):'';f.elements.currency.value=row?.currency??state.currency;
  if(row?.categoryId)f.elements.categoryId.value=row.categoryId;
  const date=row?new Date(row.transactionDate):new Date();f.elements.transactionDate.value=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
  $('form-error').textContent='';$('editor').showModal();syncBack();
}
$('expense-form').onsubmit=async event=>{
  event.preventDefault();const f=event.target;const input={merchant:f.elements.merchant.value.trim(),amount:Number(f.elements.amount.value),currency:f.elements.currency.value.toUpperCase(),categoryId:f.elements.categoryId.value,transactionDate:new Date(f.elements.transactionDate.value).toISOString()};
  $('save').disabled=true;$('dismiss').disabled=true;$('form-error').textContent='';
  try{await api('expenses'+(state.editId?'/'+state.editId:''),{method:state.editId?'PATCH':'POST',body:JSON.stringify(input)});$('editor').close();tg?.HapticFeedback.notificationOccurred('success');await load();}
  catch(error){$('form-error').textContent=error.message;}
  finally{$('save').disabled=false;$('dismiss').disabled=false;syncBack();}
};
$('editor').addEventListener('cancel',e=>{if($('save').disabled)e.preventDefault();});$('editor').addEventListener('close',syncBack);
$('dismiss').onclick=()=>$('editor').close();$('add').onclick=()=>openEditor();$('retry').onclick=load;
$('currency').onchange=e=>{state.currency=e.target.value;render();};
$('prev').onclick=()=>{state.anchor=state.report.range.previousAnchor;load();};$('next').onclick=()=>{state.anchor=state.report.range.nextAnchor;load();};$('current').onclick=()=>{state.anchor='';load();};
document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{state.period=b.dataset.period;state.anchor='';state.limit=30;load();});
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;state.filter=null;state.limit=30;render();});
load();
