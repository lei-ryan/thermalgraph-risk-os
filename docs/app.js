const state={view:'spatial',rack:7,horizon:60,layer:'node',event:null,action:null};
const racks=Array.from({length:12},(_,i)=>({id:i+1,power:null,risk:null,rise:null}));
let events=[];
let actions=JSON.parse(localStorage.getItem('thermalgraph-actions-en-v1')||'[]');

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
function toast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),1800)}
function navigate(view){if(view==='actions')view='audit';state.view=view;$$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));const panel=$(`#view-${view}`);$('#page-title').textContent=panel.dataset.title;$('#page-kicker').textContent=panel.dataset.kicker;history.replaceState(null,'',`#${view}`)}
$$('.nav-item').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.view)));

function rackButton(r){const b=document.createElement('button');b.className=`rack${r.id===state.rack?' active':''}${r.risk>70?' hot':''}`;b.dataset.rack=r.id;b.setAttribute('aria-label',`Rack ${String(r.id).padStart(2,'0')} risk ${r.risk}%`);b.innerHTML=`<div class="rack-cube"><span class="cube-face cube-front"><span class="cube-label"><b>R${String(r.id).padStart(2,'0')} · F</b><span>INLET</span></span><span class="sensor-stack"><i></i><i></i><i></i></span></span><span class="cube-face cube-back"><span class="cube-label"><b>R${String(r.id).padStart(2,'0')} · B</b><span>OUTLET</span></span><span class="sensor-stack"><i class="${r.risk>66?'alert':''}"></i><i class="${r.risk>58?'alert':''}"></i><i></i></span></span><span class="cube-face cube-side"></span><span class="cube-face cube-top"></span><span class="rack-base" style="width:${Math.min(92,45+r.power*6)}%"></span><span class="rack-risk">${r.risk}%</span></div>`;b.addEventListener('click',()=>selectRack(r));return b}
function renderRacks(){}
function selectRack(r){state.rack=r.id;renderRacks();$('#selected-rack').textContent=`Rack ${String(r.id).padStart(2,'0')}`;$('#trajectory-title').textContent=`Rack ${String(r.id).padStart(2,'0')} · Mid Front`;$('#rack-power').textContent=`${r.power.toFixed(1)} kW`;const front=23.9+r.id*.055;$('#front-temp').textContent=`${front.toFixed(1)} °C`;$('#back-temp').textContent=`${(front+r.rise).toFixed(1)} °C`;$('#temp-rise').textContent=`+${r.rise.toFixed(1)} °C`;updateRisk(r.risk);updateAssistantContext()}
function updateRisk(base=racks[state.rack-1].risk){const r=Math.max(20,Math.min(94,Math.round(base+(state.horizon-15)*.34)));$('#risk-value').textContent=`${r}%`;$('#stat-risk').textContent=`${r}%`;const evolution=$('#risk-evolution');if(evolution&&!evolution.children.length)evolution.innerHTML=Array.from({length:60},(_,i)=>{const p=Math.max(0,Math.min(100,r*(i+1)/60)),hue=120*(1-p/100);return `<span title="t+${i+1} min · ${Math.round(p)}%" style="background:hsl(${hue.toFixed(1)} 72% 43%)"></span>`}).join('');$('#risk-label').textContent=`${state.horizon} min thermal-deviation probability`;const x=390+state.horizon/60*346,y=Math.max(78,116-state.horizon*.52);$('#horizon-point').setAttribute('cx',x);$('#horizon-point').setAttribute('cy',y)}
const diagnoses={node:{target:'R07 Mid Back',note:'The mid-rear forecast trajectory departs from the observational reference.'},edge:{target:'R07 Front → Back',note:'The effective coupling rate departs from its recent stable range.'},subgraph:{target:'R07–R08 rear subgraph',note:'Adjacent racks form a contiguous spatial risk region.'}};
$$('.context-panel .segmented button').forEach(b=>b.addEventListener('click',()=>{$$('.context-panel .segmented button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.layer=b.dataset.layer;$('#diagnosis-target').textContent=diagnoses[state.layer].target;$('#diagnosis-note').textContent=diagnoses[state.layer].note;updateAssistantContext()}));
function upsertReplayAction(n){
  if(!n?.origin)return null;const id='OBS-'+n.origin.replace(/\D/g,'')+'-'+n.id;let action=actions.find(a=>a.id===id);
  if(!action){action={id,event:'t+60 risk inspection / '+n.origin,priority:(n.risk??0)>=50?'P1':'P2',kind:'Archived Risk Evidence',title:'Inspect '+n.id+' temperature and airflow conditions',description:'First verify sensor quality and time synchronization, then inspect same-height Front–Back temperature differences, adjacent-rack readings, and local obstructions. This action is generated from archived research data and the empirical risk-confidence space.',target:n.rack+' · '+n.side+' · '+n.id,evidence:['Observation time '+n.origin,'Current temperature '+n.temperature.toFixed(2)+' °C','t+60 frozen forecast '+n.prediction.toFixed(2)+' °C','Empirical risk probability '+Math.round(n.risk??0)+'%','90% empirical prediction interval '+n.intervalLower.toFixed(2)+'–'+n.intervalUpper.toFixed(2)+' °C'],status:'pending',notes:'',origin:n.origin,node:n.id,source:'TDC2.0 archived data and frozen forecasts',history:[{time:new Date().toISOString(),text:'Inspection action generated from spatial risk-confidence evidence'}]};actions.unshift(action);saveActions();}
  selectAction(id);$('#action-source').textContent='Source: '+n.origin+' · '+n.id;const values=[n.id,n.origin,'Historical residual correction + conditional correction','Empirical Risk-Confidence Space','60 min'];document.querySelectorAll('.action-provenance .kv b').forEach((b,i)=>b.textContent=values[i]??b.textContent);return action;
}
$('#spatial-to-actions').addEventListener('click',()=>{
  const n=window.thermalTwin?.getSelection();
  if(n?.mode==='replay')upsertReplayAction(n);
  navigate('audit');$('#action-workspace')?.scrollIntoView({behavior:'smooth',block:'start'});toast('Inspection action opened; no equipment control command will be issued');
});

function renderEvents(){const list=$('#event-list');list.innerHTML='';$('#event-count').textContent=events.length;events.forEach(e=>{const b=document.createElement('button');b.className=`event-card${e.id===state.event?' active':''}`;b.innerHTML=`<div><b>${e.id}</b><span>${e.prob}%</span></div><p>${e.name}</p><small>t+60 · ${e.time}</small>`;b.addEventListener('click',()=>selectEvent(e));list.appendChild(b)})}
function eventPath(values){return values.map((v,i)=>`${i?'L':'M'}${(48+i*688/59).toFixed(2)} ${(206-(Number.isFinite(v)?v:0)*1.81).toFixed(2)}`).join(' ')}
function renderObservationEvidence(evidence){
  const defs={stat:['standard-stat','standard-stat-bar','Temporal-Cycle Residual'],graph:['standard-graph','standard-graph-bar','Physical-Topology Support'],dynamic:['standard-dynamic','standard-dynamic-bar','Multivariate Dynamic Regime'],sequence:['standard-sequence','standard-sequence-bar','Multiscale Temporal Variation']};
  Object.entries(defs).forEach(([key,[valueId,barId]])=>{const v=evidence?.[key],pct=Number.isFinite(v)?Math.round(v*100):null;$('#'+valueId).textContent=pct==null?'Unavailable':`${pct}%`;$('#'+barId).style.width=(pct??0)+'%';});
  const cards=$$('.standard-grid article');cards.forEach(card=>{const value=evidence?.[card.dataset.standard];card.classList.toggle('elevated',Number.isFinite(value)&&value>=.8);});
}
function selectEvent(e){
  if(!e)return;state.event=e.id;renderEvents();const n=e.node,curve=n.riskCurve||[],first=curve.findIndex(v=>Number.isFinite(v)&&v>=50),pair=n.id.replace(/THB([BMT])$/,'THF$1').replace(/THF([BMT])$/,'THB$1');
  $('#event-title').textContent=e.name;$('#event-subtitle').textContent=`${e.time} issued · t+60 Empirical Risk-Confidence Space`;$('#event-prob').textContent=`${e.prob}%`;$('#event-horizon').textContent=first>=0?`${first+1} min`:'Not crossed';$('#event-forecast').textContent=Number.isFinite(n.prediction)?`${n.prediction.toFixed(2)} °C`:'—';$('#event-level').textContent='Node';
  $('#event-origin').textContent=n.origin;$('#event-current-temp').textContent=`${n.temperature.toFixed(2)} °C`;$('#event-target-time').textContent=n.targetTime||'t + 60 min';$('#event-prediction-interval').textContent=Number.isFinite(n.intervalLower)?`${n.intervalLower.toFixed(2)}–${n.intervalUpper.toFixed(2)} °C`:'—';
  $('.risk-main').setAttribute('d',eventPath(curve));const dot=$('.risk-first-crossing'),label=$('.risk-first-label');if(first>=0){const x=48+first*688/59,y=206-curve[first]*1.81;dot.hidden=false;dot.setAttribute('cx',x);dot.setAttribute('cy',y);label.textContent=`First crossing of 50%: ${first+1} min`;label.setAttribute('x',Math.min(590,x+10));label.setAttribute('y',Math.max(32,y-8));}else{dot.hidden=true;label.textContent='';}
  renderObservationEvidence(n.observationEvidence);
  $('#event-node-object').textContent=n.id;$('#event-edge-object').textContent=`${pair} ↔ ${n.id}`;const adjacent=n.rackIndex%6<5?'Next rack':'Previous rack';$('#event-subgraph-object').textContent=`${n.rack} + ${adjacent}`;$('#event-mini-network').innerHTML=`<span>${pair}</span><span class="hot">${n.id}</span><span>${n.rack}</span><span>${adjacent}</span>`;
}
$('#event-back-replay').addEventListener('click',()=>navigate('spatial'));
$('#event-to-actions').addEventListener('click',()=>{const e=events.find(e=>e.id===state.event);if(e?.node)upsertReplayAction(e.node);navigate('audit');$('#action-source').textContent=e?`Source: ${e.id} · ${e.name}`:'Source: current replay evidence';$('#action-workspace')?.scrollIntoView({behavior:'smooth',block:'start'});toast('Opened the physics-consistent inspection action')});

function statusName(status){return {pending:'Pending',progress:'In Progress',done:'Completed',na:'Not Applicable'}[status]}
function saveActions(){localStorage.setItem('thermalgraph-actions-en-v1',JSON.stringify(actions));updateActionCounts()}
function updateActionCounts(){const count=s=>actions.filter(a=>a.status===s).length;$('#pending-count').textContent=count('pending');$('#progress-count').textContent=count('progress');$('#done-count').textContent=count('done')}
function renderActionList(){const filter=$('#action-filter').value,list=$('#action-list');list.innerHTML='';actions.filter(a=>filter==='all'||a.status===filter).forEach(a=>{const b=document.createElement('button');b.className=`action-card${a.id===state.action?' active':''}`;b.innerHTML=`<div><b>${a.id} · ${a.priority}</b><span>${statusName(a.status)}</span></div><p>${a.title}</p><small>${a.kind}</small>`;b.addEventListener('click',()=>selectAction(a.id));list.appendChild(b)});updateActionCounts()}
function selectAction(id){const a=actions.find(x=>x.id===id);if(!a)return;state.action=id;renderActionList();$('#action-priority').textContent=`Priority ${a.priority}`;$('#action-title').textContent=a.title;$('#action-id').textContent=`Action ${a.id} · ${a.kind}`;$('#action-description').textContent=a.description;$('#action-target').textContent=a.target;$('#action-evidence').innerHTML=a.evidence.map(x=>`<li>${x}</li>`).join('');$('#action-status').value=a.status;$('#action-notes').value=a.notes;$('#prov-event').textContent=a.event;$('#action-source').textContent=`Source: ${a.origin||a.event} · ${a.node||a.target}`;const provenance=[a.event,a.origin||'current replay time','Historical residual correction + conditional correction','Empirical Risk-Confidence Space','60 min'];document.querySelectorAll('.action-provenance .kv b').forEach((b,i)=>b.textContent=provenance[i]??'—');$('#action-history').innerHTML=a.history.map(h=>`<div class="history-item"><time>${h.time}</time><span>${h.text}</span></div>`).join('')}
$('#action-filter').addEventListener('change',renderActionList);$('#action-status').addEventListener('change',e=>{const a=actions.find(x=>x.id===state.action);a.status=e.target.value;a.history.unshift({time:'Current session',text:`Status updated to ${statusName(a.status)}`});saveActions();selectAction(a.id);toast('Action status updated')});
$('#save-note').addEventListener('click',()=>{const a=actions.find(x=>x.id===state.action);a.notes=$('#action-notes').value.trim();a.history.unshift({time:'Current session',text:a.notes?'Inspection note saved':'Inspection note cleared'});saveActions();selectAction(a.id);toast('Inspection note saved locally')});
$('#complete-action').addEventListener('click',()=>{const a=actions.find(x=>x.id===state.action);if(!a)return;a.status='done';a.history.unshift({time:'Current session',text:'Action marked as completed'});saveActions();selectAction(a.id);toast('Action completed and audit trail retained')});$('#back-to-event').addEventListener('click',()=>navigate('events'));

$$('.camera-controls button').forEach(button=>button.addEventListener('click',()=>{const viewport=$('#room-viewport');$$('.camera-controls button').forEach(x=>x.classList.remove('active'));button.classList.add('active');viewport.classList.remove('camera-iso','camera-front','camera-top');viewport.classList.add(`camera-${button.dataset.camera}`);toast(`3D view changed to ${button.textContent}`)}));

function updateAssistantContext(){const layerName={node:'Node Evidence',edge:'Edge Evidence',subgraph:'Subgraph Evidence'}[state.layer];$('#assistant-context-rack').textContent=state.rackName||`Rack ${String(state.rack).padStart(2,'0')}`;$('#assistant-context-horizon').textContent=`${state.horizon} min`;$('#assistant-context-layer').textContent=layerName}
function currentRisk(){if(window.thermalTwin){const r=window.thermalTwin.getSelection().risk;return r==null?null:Math.round(r);}return null}
function consultAssistant(question){if(state.view==='spatial'&&window.thermalTwin){const n=window.thermalTwin.getSelection();return spatialConsult(question,n);}const q=question.toLowerCase(),rack=racks[state.rack-1],rackName=`R${String(state.rack).padStart(2,'0')}`,risk=currentRisk(),diag=diagnoses[state.layer];
  if(/why|risk|probability|deviation/i.test(q))return `${rackName} has an empirical t+60 min thermal-deviation probability of ${risk??'—'}%. It is inferred from the frozen temperature trajectory and archived forecast residuals. The four observation references remain independent evidence and do not replace the frozen labels.`;
  if(/inspect|action|handle|next|recommend/i.test(q)){const candidate=actions.find(a=>a.status!=='done')||actions[0];return `Prioritize ${candidate.id}: ${candidate.title}. The inspection target is ${candidate.target}. The operational boundary is observation, verification, and recording only; control changes must follow the existing approval process.`}
  if(/correction|pipeline|configuration|model|forecast|prediction/i.test(q))return `The forecast pipeline processes a 60 min thermal-state history, RC graph dynamics, 1–60 min full-horizon responses, historical residual correction, and conditional correction. On the fixed test set, the complete pipeline achieves MAE 0.088884 °C and RMSE 0.180158 °C.`;
  if(/boundary|reliable|limitation|root cause|fault/i.test(q))return `The system provides probabilistic warning and node, edge, and subgraph localization. Because TDC2.0 has no human-verified anomaly labels, localization is inspectable evidence rather than a verified root cause; auxiliary variables are supporting evidence only.`;
  if(/edge|coupling|path/i.test(q))return `Edge-level evidence describes deviations in effective thermal coupling between two temperature nodes. The current selection is ${diag.target}. A high edge score does not prove that physical thermal resistance has changed; it may also reflect airflow, load, or unmodeled exchange.`;
  if(/subgraph|spatial|topology|3d/i.test(q))return `The 3D spatial graph represents two rows of twelve racks, three height levels on both front and back, and candidate thermal-coupling paths. Subgraph risk identifies contiguous regions where adjacent nodes or edges deviate together.`;
  return `The current context is ${rackName}, the t+60 min risk-confidence space, and ${{node:'node',edge:'edge',subgraph:'subgraph'}[state.layer]} evidence, with an empirical risk probability of ${risk??'—'}%. You can ask about risk formation, the forecast pipeline, spatial localization, or recommended inspections.`}
function appendAssistantMessage(text,role='bot'){const box=document.createElement('div');box.className=`assistant-message ${role}`;box.innerHTML=`<small>${role==='user'?'You':'AI Assistant'}</small><p></p>`;box.querySelector('p').textContent=text;$('#assistant-messages').appendChild(box);$('#assistant-messages').scrollTop=$('#assistant-messages').scrollHeight}
function openAssistant(){updateAssistantContext();$('#assistant-drawer').classList.add('open');$('#assistant-backdrop').classList.add('open');$('#assistant-drawer').setAttribute('aria-hidden','false');setTimeout(()=>$('#assistant-input').focus(),200)}
function closeAssistant(){$('#assistant-drawer').classList.remove('open');$('#assistant-backdrop').classList.remove('open');$('#assistant-drawer').setAttribute('aria-hidden','true')}
function askAssistant(question){const clean=question.trim();if(!clean)return;appendAssistantMessage(clean,'user');setTimeout(()=>appendAssistantMessage(consultAssistant(clean)),180)}
$('#assistant-toggle').addEventListener('click',openAssistant);$('#assistant-close').addEventListener('click',closeAssistant);$('#assistant-backdrop').addEventListener('click',closeAssistant);document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAssistant()});
$('#assistant-form').addEventListener('submit',e=>{e.preventDefault();const input=$('#assistant-input');askAssistant(input.value);input.value=''});$$('#assistant-prompts button').forEach(button=>button.addEventListener('click',()=>askAssistant(button.textContent)));

const actionHeader=$('#view-actions .action-header'),actionLayout=$('#view-actions .action-layout');
if(actionHeader&&actionLayout){const wrap=document.createElement('div');wrap.id='action-workspace';wrap.className='merged-action-workspace';wrap.append(actionHeader,actionLayout);$('#view-audit').append(wrap);$('#view-actions').remove();}
renderRacks();renderEvents();renderActionList();if(!state.action&&actions.length)state.action=actions[0].id;selectAction(state.action);updateAssistantContext();
const initial=location.hash.replace('#','');if(['spatial','events','audit'].includes(initial))navigate(initial);else navigate('spatial');

const modelContext=document.modelContext;
if(modelContext?.registerTool){
  const lifecycle=new AbortController();
  Promise.resolve(modelContext.registerTool({
    name:'get_action_queue',
    title:'Read Inspection Action Queue',
    description:'Read the physics-consistent inspection actions, priorities, and execution states for the current risk event without modifying state.',
    inputSchema:{type:'object',properties:{status:{type:'string',enum:['all','pending','progress','done','na']}},additionalProperties:false},
    annotations:{readOnlyHint:true,untrustedContentHint:false},
    execute(input={}){const filter=input.status||'all';return {actions:actions.filter(a=>filter==='all'||a.status===filter).map(a=>({id:a.id,event:a.event,priority:a.priority,title:a.title,status:a.status,target:a.target}))}}
  },{signal:lifecycle.signal})).catch(()=>{});
  Promise.resolve(modelContext.registerTool({
    name:'update_action_status',
    title:'Update Inspection Action Status',
    description:'Update an existing inspection action to pending, in progress, completed, or not applicable, and synchronize the interface and local audit trail.',
    inputSchema:{type:'object',properties:{actionId:{type:'string'},status:{type:'string',enum:['pending','progress','done','na']},note:{type:'string'}},required:['actionId','status'],additionalProperties:false},
    annotations:{readOnlyHint:false,untrustedContentHint:false},
    execute(input){const a=actions.find(x=>x.id===input.actionId);if(!a)throw new Error('Unknown actionId');a.status=input.status;if(typeof input.note==='string')a.notes=input.note.trim();a.history.unshift({time:'WebMCP',text:`Status updated to ${statusName(a.status)}`});saveActions();if(state.action===a.id)selectAction(a.id);return {id:a.id,status:a.status,updated:true}}
  },{signal:lifecycle.signal})).catch(()=>{});
  Promise.resolve(modelContext.registerTool({
    name:'consult_thermalgraph_assistant',
    title:'Consult the Thermal-Field Risk Assistant',
    description:'Explain risk, spatial diagnosis, inspection recommendations, and conclusion boundaries using the current rack, forecast horizon, and frozen research results.',
    inputSchema:{type:'object',properties:{question:{type:'string'}},required:['question'],additionalProperties:false},
    annotations:{readOnlyHint:true,untrustedContentHint:false},
    execute(input){return {answer:consultAssistant(input.question),context:{rack:state.rack,horizon:state.horizon,layer:state.layer,risk:currentRisk()}}}
  },{signal:lifecycle.signal})).catch(()=>{});
}
function spatialConsult(question,n){
  if(n.mode==='replay'){
    const summary=`At ${n.origin}, ${n.id} has a current temperature of ${n.temperature.toFixed(2)} °C, a t+60 min frozen forecast of ${n.prediction.toFixed(2)} °C, an empirical risk probability of ${Math.round(n.risk??0)}%, and a 90% empirical prediction interval of ${n.intervalLower.toFixed(2)}–${n.intervalUpper.toFixed(2)} °C.`;
    if(/inspect|action|recommend/i.test(question))return summary+' First verify observation quality and time synchronization, then inspect same-height front and rear sensors, airflow obstructions, and adjacent racks. The risk-confidence space prioritizes inspection but cannot by itself confirm a fault or justify a control change.';
    return summary+' Temperatures come from the TDC2.0 one-minute archive, forecasts from the frozen deployment cache, and risk confidence from the empirical distribution of archived forecast residuals. This is a local rule-based explanation and does not call an external language model.';
  }
  const field=n.field==='temperature'?'current temperature distribution':'future risk distribution';
  const summary=`${n.id} (${n.side}) has a displayed current temperature of ${n.temperature.toFixed(1)} °C and a thermal-deviation probability of ${Math.round(n.risk)}% at t+${n.horizon} min.`;
  if(/layer|temperature|risk|probability/i.test(question))return `${summary} The current layer is “${field}”. The temperature layer is fixed at the observation time, whereas the risk layer varies across the 1–60 min horizon.`;
  if(/inspect|action|recommend/i.test(question))return `Inspect the ${n.side} sensor at ${n.rack} and its same-height Front–Back pair. Verify sensor quality and time synchronization before checking airflow obstruction, recirculation, and adjacent-rack temperatures.`;
  if(/edge|subgraph|topology|layout|spatial/i.test(question))return `The archived spatial layout contains two rows of twelve racks, 72 nodes, and 324 directed candidate edges. ${summary} RC connections show Front–Back, vertical, same-row, and cross-row relations; they are candidate thermal couplings, not measured streamlines.`;
  return summary+' The 3D scene maps the research topology at schematic scale. You can ask about the layers, node positions, RC connections, or inspection recommendations.';
}
window.thermalBridge={getState:()=>({...state}),getActions:()=>JSON.parse(JSON.stringify(actions))};
window.addEventListener('thermal:twin-selection',e=>{
  Object.assign(state,{rack:e.detail.rack,rackName:e.detail.rackName,node:e.detail.node,field:e.detail.field});
  updateAssistantContext();
  if(!window.thermalTwin)return;
  const top=window.thermalTwin.getTopRisks(4),origin=window.thermalTwin.getSelection().origin;
  events=top.map((n,i)=>({id:'RISK-'+String(i+1).padStart(2,'0'),name:n.id+' t+60 thermal deviation',prob:Math.round(n.risk??0),time:origin.slice(11),horizon:60,level:'Node',standard:'Empirical Risk-Confidence Space',node:n}));
  if(!actions.length&&events[0]?.node)upsertReplayAction(events[0].node);
  if(!state.event||!events.some(x=>x.id===state.event))state.event=events[0]?.id;
  renderEvents();selectEvent(events.find(x=>x.id===state.event));
});
