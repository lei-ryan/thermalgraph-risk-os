const state={view:'spatial',rack:7,horizon:15,layer:'node',event:'E-023',action:'A-001'};
const racks=Array.from({length:12},(_,i)=>({id:i+1,power:4.8+(i%4)*.55,risk:38+((i*17)%47),rise:1.1+(i%5)*.24}));
const events=[
  {id:'E-023',name:'R07 后侧局部热偏离',prob:78,time:'10:00',horizon:18,level:'节点',standard:'图空间标准'},
  {id:'E-021',name:'R03–R04 热传播路径偏移',prob:64,time:'09:42',horizon:27,level:'边',standard:'非图多变量标准'},
  {id:'E-019',name:'Row B 协同升温',prob:59,time:'09:18',horizon:33,level:'子图',standard:'节点序列标准'},
  {id:'E-017',name:'R11 上部点异常',prob:52,time:'08:55',horizon:11,level:'节点',standard:'经典统计标准'}
];
const defaultActions=[
  {id:'A-001',event:'E-023',priority:'P1',kind:'节点证据',title:'核查R07后侧局部排风与遮挡',description:'检查R07后侧中部排风路径、线缆遮挡和局部回流，记录是否存在显著气流阻塞。',target:'Rack 07 · Mid Back · Front→Back路径',evidence:['未来18 min热偏离概率78%','R07 Mid Back节点定位置信度0.91','Front→Back有效耦合变化显著'],status:'pending',notes:'',history:[{time:'10:00',text:'由E-023空间诊断结果生成'}]},
  {id:'A-002',event:'E-023',priority:'P1',kind:'边证据',title:'复核R07前后侧温升及风扇状态',description:'现场复核前后侧温升方向、服务器风扇运行状态以及监测点附近气流组织。',target:'Rack 07 · Front→Back edge',evidence:['边定位置信度0.84','预测温升保持为正但幅值上升','机架功率变化不足以单独解释偏移'],status:'progress',notes:'已通知值守人员进行观察。',history:[{time:'10:02',text:'动作进入执行中'},{time:'10:00',text:'由E-023边级证据生成'}]},
  {id:'A-003',event:'E-023',priority:'P2',kind:'子图证据',title:'对比R07与R08后侧共同气流路径',description:'比较R07、R08后侧温度轨迹和共享回风路径，排查局部回流或共同风道影响。',target:'R07–R08 back-side subgraph',evidence:['子图定位置信度0.76','两个相邻机架后侧风险同步上升','跨排证据较弱'],status:'pending',notes:'',history:[{time:'10:00',text:'由E-023子图证据生成'}]},
  {id:'A-004',event:'E-023',priority:'P2',kind:'观测质量',title:'复核R07温度传感器观测质量',description:'检查R07中部前后侧传感器有效掩码、陈旧度和同期相邻高度读数。',target:'R07 Mid Front / Mid Back sensors',evidence:['排除失真异常后再解释热偏离','相邻高度节点提供独立佐证'],status:'pending',notes:'',history:[{time:'10:00',text:'由观测质量规则生成'}]}
];
let actions=JSON.parse(localStorage.getItem('thermalgraph-actions')||'null')||defaultActions;

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
function toast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),1800)}
function navigate(view){state.view=view;$$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));const panel=$(`#view-${view}`);$('#page-title').textContent=panel.dataset.title;$('#page-kicker').textContent=panel.dataset.kicker;history.replaceState(null,'',`#${view}`)}
$$('.nav-item').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.view)));
$('#theme-toggle').addEventListener('click',()=>document.documentElement.classList.toggle('dark'));

function rackButton(r){const b=document.createElement('button');b.className=`rack${r.id===state.rack?' active':''}${r.risk>70?' hot':''}`;b.dataset.rack=r.id;b.setAttribute('aria-label',`Rack ${String(r.id).padStart(2,'0')}，风险${r.risk}%`);b.innerHTML=`<div class="rack-cube"><span class="cube-face cube-front"><span class="cube-label"><b>R${String(r.id).padStart(2,'0')} · F</b><span>INLET</span></span><span class="sensor-stack"><i></i><i></i><i></i></span></span><span class="cube-face cube-back"><span class="cube-label"><b>R${String(r.id).padStart(2,'0')} · B</b><span>OUTLET</span></span><span class="sensor-stack"><i class="${r.risk>66?'alert':''}"></i><i class="${r.risk>58?'alert':''}"></i><i></i></span></span><span class="cube-face cube-side"></span><span class="cube-face cube-top"></span><span class="rack-base" style="width:${Math.min(92,45+r.power*6)}%"></span><span class="rack-risk">${r.risk}%</span></div>`;b.addEventListener('click',()=>selectRack(r));return b}
function renderRacks(){}
function selectRack(r){state.rack=r.id;renderRacks();$('#selected-rack').textContent=`Rack ${String(r.id).padStart(2,'0')}`;$('#trajectory-title').textContent=`Rack ${String(r.id).padStart(2,'0')} · Mid Front`;$('#rack-power').textContent=`${r.power.toFixed(1)} kW`;const front=23.9+r.id*.055;$('#front-temp').textContent=`${front.toFixed(1)} °C`;$('#back-temp').textContent=`${(front+r.rise).toFixed(1)} °C`;$('#temp-rise').textContent=`+${r.rise.toFixed(1)} °C`;updateRisk(r.risk);updateAssistantContext()}
function updateRisk(base=racks[state.rack-1].risk){const r=Math.max(20,Math.min(94,Math.round(base+(state.horizon-15)*.34)));$('#risk-value').textContent=`${r}%`;$('#stat-risk').textContent=`${r}%`;$('#risk-fill').style.width=`${r}%`;$('#risk-label').textContent=`${state.horizon} min内热偏离概率`;const x=390+state.horizon/60*346,y=Math.max(78,116-state.horizon*.52);$('#horizon-point').setAttribute('cx',x);$('#horizon-point').setAttribute('cy',y)}
$('#horizon').addEventListener('input',e=>{state.horizon=+e.target.value;$('#horizon-label').textContent=`${state.horizon} min`;$('#stat-horizon').textContent=state.horizon;updateRisk();updateAssistantContext()});
const diagnoses={node:{target:'R07 Mid Back',note:'后侧中部预测轨迹偏离观测参考。'},edge:{target:'R07 Front → Back',note:'有效耦合率偏离近期稳定区间。'},subgraph:{target:'R07–R08 后侧子图',note:'相邻机架形成连续空间风险区域。'}};
$$('.context-panel .segmented button').forEach(b=>b.addEventListener('click',()=>{$$('.context-panel .segmented button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.layer=b.dataset.layer;$('#diagnosis-target').textContent=diagnoses[state.layer].target;$('#diagnosis-note').textContent=diagnoses[state.layer].note;updateAssistantContext()}));
$('#spatial-to-actions').addEventListener('click',()=>{
  const n=window.thermalTwin?.getSelection();
  if(n?.mode==='replay'){
    const id='OBS-'+n.origin.replace(/\D/g,'')+'-'+n.id;
    if(!actions.some(a=>a.id===id))actions.unshift({id,event:'观测核查 / '+n.origin,priority:'待研判',kind:'真实回放观测',title:'复核 '+n.id+' 的温度及气流条件',description:'首先检查传感器和时间同步，再观察同高度前后侧温差、相邻机架读数和局部遮挡。本条由用户从空间页发起，不表示模型已确认异常。',target:n.rack+' · '+n.side+' · '+n.id,evidence:['观测时间 '+n.origin,'当前温度 '+n.temperature.toFixed(2)+' °C','Main +'+n.horizon+' min冻结预测 '+n.prediction.toFixed(2)+' °C','节点风险概率与定位置信度尚未接入'],status:'pending',notes:'',origin:n.origin,node:n.id,source:'TDC2.0 archive; user-requested inspection',history:[{time:new Date().toISOString(),text:'用户根据真实归档观测建立核查条目'}]});
    saveActions();selectAction(id);$('#action-source').textContent='来源：'+n.origin+' · '+n.id;
    document.querySelectorAll('.action-provenance .kv b').forEach((b,i)=>b.textContent=[n.id,n.origin,'Main V74.1','观测核查 / 非异常判定',n.horizon+' min'][i]);
  }
  navigate('actions');toast('已打开核查动作；不会发送设备控制指令');
});

function renderEvents(){const list=$('#event-list');list.innerHTML='';events.forEach(e=>{const b=document.createElement('button');b.className=`event-card${e.id===state.event?' active':''}`;b.innerHTML=`<div><b>${e.id}</b><span>${e.prob}%</span></div><p>${e.name}</p><small>${e.level} · ${e.time}</small>`;b.addEventListener('click',()=>selectEvent(e));list.appendChild(b)})}
function selectEvent(e){state.event=e.id;renderEvents();$('#event-title').textContent=e.name;$('#event-subtitle').textContent=`当前修订${e.time} · ${e.standard}`;$('#event-prob').textContent=`${e.prob}%`;$('#event-horizon').textContent=`${e.horizon} min`;$('#event-level').textContent=e.level}
$('#event-to-actions').addEventListener('click',()=>{navigate('actions');$('#action-source').textContent=`来源：${state.event} · ${events.find(e=>e.id===state.event).name}`;toast('已生成物理一致的核查动作清单')});

function drawMatrix(mode='node'){const matrix=$('#error-matrix');matrix.innerHTML='';const n=mode==='node'?72:mode==='edge'?48:36;for(let i=0;i<n;i++){const c=document.createElement('span');c.className='matrix-cell';const v=12+((i*29+(mode==='edge'?13:0))%78);c.style.setProperty('--intensity',`${v}%`);c.dataset.tip=`${mode} ${i+1} · score ${(v/100).toFixed(2)}`;matrix.appendChild(c)}}
$$('.matrix-tabs button').forEach(b=>b.addEventListener('click',()=>{$$('.matrix-tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');drawMatrix(b.dataset.mode)}));
$('#audit-standard').addEventListener('change',e=>$('#ranking-standard').textContent=e.target.value);$('#run-audit').addEventListener('click',()=>{toast('分析视图已按统一口径刷新')});

function statusName(status){return {pending:'待核查',progress:'执行中',done:'已完成',na:'不适用'}[status]}
function saveActions(){localStorage.setItem('thermalgraph-actions',JSON.stringify(actions));updateActionCounts()}
function updateActionCounts(){const count=s=>actions.filter(a=>a.status===s).length;$('#pending-count').textContent=count('pending');$('#progress-count').textContent=count('progress');$('#done-count').textContent=count('done')}
function renderActionList(){const filter=$('#action-filter').value,list=$('#action-list');list.innerHTML='';actions.filter(a=>filter==='all'||a.status===filter).forEach(a=>{const b=document.createElement('button');b.className=`action-card${a.id===state.action?' active':''}`;b.innerHTML=`<div><b>${a.id} · ${a.priority}</b><span>${statusName(a.status)}</span></div><p>${a.title}</p><small>${a.kind}</small>`;b.addEventListener('click',()=>selectAction(a.id));list.appendChild(b)});updateActionCounts()}
function selectAction(id){state.action=id;renderActionList();const a=actions.find(x=>x.id===id);$('#action-priority').textContent=`优先级 ${a.priority}`;$('#action-title').textContent=a.title;$('#action-id').textContent=`Action ${a.id} · ${a.kind}`;$('#action-description').textContent=a.description;$('#action-target').textContent=a.target;$('#action-evidence').innerHTML=a.evidence.map(x=>`<li>${x}</li>`).join('');$('#action-status').value=a.status;$('#action-notes').value=a.notes;$('#prov-event').textContent=a.event;$('#action-history').innerHTML=a.history.map(h=>`<div class="history-item"><time>${h.time}</time><span>${h.text}</span></div>`).join('')}
$('#action-filter').addEventListener('change',renderActionList);$('#action-status').addEventListener('change',e=>{const a=actions.find(x=>x.id===state.action);a.status=e.target.value;a.history.unshift({time:'当前会话',text:`状态更新为${statusName(a.status)}`});saveActions();selectAction(a.id);toast('动作状态已更新')});
$('#save-note').addEventListener('click',()=>{const a=actions.find(x=>x.id===state.action);a.notes=$('#action-notes').value.trim();a.history.unshift({time:'当前会话',text:a.notes?'已保存核查记录':'清空核查记录'});saveActions();selectAction(a.id);toast('核查记录已保存到本机')});
$('#complete-action').addEventListener('click',()=>{const a=actions.find(x=>x.id===state.action);a.status='done';a.history.unshift({time:'当前会话',text:'动作标记为已完成'});saveActions();selectAction(a.id);toast('动作已完成并保留审计轨迹')});$('#back-to-event').addEventListener('click',()=>navigate('events'));

$$('.camera-controls button').forEach(button=>button.addEventListener('click',()=>{const viewport=$('#room-viewport');$$('.camera-controls button').forEach(x=>x.classList.remove('active'));button.classList.add('active');viewport.classList.remove('camera-iso','camera-front','camera-top');viewport.classList.add(`camera-${button.dataset.camera}`);toast(`三维视角已切换为${button.textContent}`)}));

function updateAssistantContext(){const layerName={node:'节点证据',edge:'边证据',subgraph:'子图证据'}[state.layer];$('#assistant-context-rack').textContent=state.rackName||`Rack ${String(state.rack).padStart(2,'0')}`;$('#assistant-context-horizon').textContent=`${state.horizon} min`;$('#assistant-context-layer').textContent=layerName}
function currentRisk(){if(window.thermalTwin){const r=window.thermalTwin.getSelection().risk;return r==null?null:Math.round(r);}const base=racks[state.rack-1].risk;return Math.max(20,Math.min(94,Math.round(base+(state.horizon-15)*.34)))}
function consultAssistant(question){if(state.view==='spatial'&&window.thermalTwin){const n=window.thermalTwin.getSelection();return spatialConsult(question,n);}const q=question.toLowerCase(),rack=racks[state.rack-1],rackName=`R${String(state.rack).padStart(2,'0')}`,risk=currentRisk(),diag=diagnoses[state.layer];
  if(/为什么|风险|概率|偏离/.test(q)&&!/基线|persistence|优势|模型/.test(q))return `${rackName}在当前${state.horizon} min视野下的热偏离概率为${risk}%。主要证据来自${diag.target}：${diag.note} 当前Front→Back温升约为${rack.rise.toFixed(1)} °C。该结果表示未来偏离风险，而不是已经确认的设备故障。`;
  if(/核查|动作|处理|怎么办|下一步/.test(q)){const candidate=actions.find(a=>a.status!=='done')||actions[0];return `建议优先执行${candidate.id}：${candidate.title}。核查对象为${candidate.target}。操作边界是仅观察、复核和记录；控制参数变更仍需进入既有运维审批流程。`}
  if(/persistence|持续性|基线|优势|main|模型/.test(q))return `Main在完整部署链路上的MAE为0.0889 °C，相对Persistence的1–60 min整体技能为28.1%。其增量信息来自RC图热耦合、多视野温度轨迹和因果在线残差修正；短视野事件决策仍可能主要受当前状态影响，因此应结合研究审计页判断模型优势是否真正传递到预警层。`;
  if(/边界|可信|局限|根因|故障/.test(q))return `当前系统能够给出概率预警以及节点、边、子图定位，但TDC2.0缺少人工确认的真实异常标签。空间定位属于可核查证据，不能直接表述为已验证根因；辅助变量也只作为佐证。建议通过现场核查动作和审计记录形成后验验证。`;
  if(/边|耦合|路径/.test(q))return `边级证据描述两个温度节点之间的有效热耦合偏离。当前选择为${diag.target}，它可对应Front→Back热输运或相邻机架传播路径。边分数升高并不等价于物理热阻真实改变，还可能综合反映气流、负荷及未建模交换。`;
  if(/子图|空间|拓扑|3d/.test(q))return `三维空间图同时表达两排十二机架、前后侧三高度节点和候选热耦合路径。子图风险用于识别相邻节点或边共同偏离的连续区域，从而把单点提示提升为可执行的空间核查范围。`;
  return `当前上下文为${rackName}、${state.horizon} min视野和${{node:'节点',edge:'边',subgraph:'子图'}[state.layer]}级证据，风险概率为${risk}%。你可以继续询问风险形成原因、Main与基线差异、空间定位含义或建议核查动作。`}
function appendAssistantMessage(text,role='bot'){const box=document.createElement('div');box.className=`assistant-message ${role}`;box.innerHTML=`<small>${role==='user'?'您':'AI 助手'}</small><p></p>`;box.querySelector('p').textContent=text;$('#assistant-messages').appendChild(box);$('#assistant-messages').scrollTop=$('#assistant-messages').scrollHeight}
function openAssistant(){updateAssistantContext();$('#assistant-drawer').classList.add('open');$('#assistant-backdrop').classList.add('open');$('#assistant-drawer').setAttribute('aria-hidden','false');setTimeout(()=>$('#assistant-input').focus(),200)}
function closeAssistant(){$('#assistant-drawer').classList.remove('open');$('#assistant-backdrop').classList.remove('open');$('#assistant-drawer').setAttribute('aria-hidden','true')}
function askAssistant(question){const clean=question.trim();if(!clean)return;appendAssistantMessage(clean,'user');setTimeout(()=>appendAssistantMessage(consultAssistant(clean)),180)}
$('#assistant-toggle').addEventListener('click',openAssistant);$('#assistant-close').addEventListener('click',closeAssistant);$('#assistant-backdrop').addEventListener('click',closeAssistant);document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAssistant()});
$('#assistant-form').addEventListener('submit',e=>{e.preventDefault();const input=$('#assistant-input');askAssistant(input.value);input.value=''});$$('#assistant-prompts button').forEach(button=>button.addEventListener('click',()=>askAssistant(button.textContent)));

renderRacks();renderEvents();drawMatrix();renderActionList();selectAction(state.action);updateRisk();updateAssistantContext();
const initial=location.hash.replace('#','');if(['spatial','events','audit','actions'].includes(initial))navigate(initial);

const modelContext=document.modelContext;
if(modelContext?.registerTool){
  const lifecycle=new AbortController();
  Promise.resolve(modelContext.registerTool({
    name:'get_action_queue',
    title:'读取核查动作清单',
    description:'读取当前风险事件对应的物理一致核查动作、优先级和执行状态，不修改任何状态。',
    inputSchema:{type:'object',properties:{status:{type:'string',enum:['all','pending','progress','done','na']}},additionalProperties:false},
    annotations:{readOnlyHint:true,untrustedContentHint:false},
    execute(input={}){const filter=input.status||'all';return {actions:actions.filter(a=>filter==='all'||a.status===filter).map(a=>({id:a.id,event:a.event,priority:a.priority,title:a.title,status:a.status,target:a.target}))}}
  },{signal:lifecycle.signal})).catch(()=>{});
  Promise.resolve(modelContext.registerTool({
    name:'update_action_status',
    title:'更新核查动作状态',
    description:'将一个已存在的核查动作更新为待核查、执行中、已完成或不适用，并同步可视界面与本机审计轨迹。',
    inputSchema:{type:'object',properties:{actionId:{type:'string'},status:{type:'string',enum:['pending','progress','done','na']},note:{type:'string'}},required:['actionId','status'],additionalProperties:false},
    annotations:{readOnlyHint:false,untrustedContentHint:false},
    execute(input){const a=actions.find(x=>x.id===input.actionId);if(!a)throw new Error('Unknown actionId');a.status=input.status;if(typeof input.note==='string')a.notes=input.note.trim();a.history.unshift({time:'WebMCP',text:`状态更新为${statusName(a.status)}`});saveActions();if(state.action===a.id)selectAction(a.id);return {id:a.id,status:a.status,updated:true}}
  },{signal:lifecycle.signal})).catch(()=>{});
  Promise.resolve(modelContext.registerTool({
    name:'consult_thermalgraph_assistant',
    title:'咨询温度场风险助手',
    description:'基于当前机架、预测视野、空间诊断和冻结研究结果，解释风险、模型比较、核查建议及结论边界。',
    inputSchema:{type:'object',properties:{question:{type:'string'}},required:['question'],additionalProperties:false},
    annotations:{readOnlyHint:true,untrustedContentHint:false},
    execute(input){return {answer:consultAssistant(input.question),context:{rack:state.rack,horizon:state.horizon,layer:state.layer,risk:currentRisk()}}}
  },{signal:lifecycle.signal})).catch(()=>{});
}
function spatialConsult(question,n){
  if(n.mode==='replay'){
    const summary=n.origin+'，'+n.id+'当前温度为'+n.temperature.toFixed(2)+' °C，Main在该起点发布的未来第'+n.horizon+'分钟冻结预测为'+n.prediction.toFixed(2)+' °C。';
    if(/核查|动作|建议/.test(question))return summary+' 建议先复核观测质量与时间同步，再观察同高度前后侧测点、风道遮挡和相邻机架。尚未接入同版本节点风险及定位置信度，不能据此认定故障或改变控制参数。';
    return summary+' 温度来自TDC2.0一分钟归档，预测来自冻结部署缓存。风险概率和校准区间未接入，不以示例值替代。当前咨询是本地规则式解释，不调用外部大模型。';
  }
  const field=n.field==='temperature'?'当前温度分布':'未来风险分布';
  const summary=n.id+'（'+n.side+'），当前温度演示值为'+n.temperature.toFixed(1)+' °C，未来第'+n.horizon+'分钟的热偏离概率演示值为'+Math.round(n.risk)+'%。';
  if(/图层|温度|风险|概率/.test(question))return summary+' 当前显示“'+field+'”。温度层固定在观测时刻；风险层随1–60分钟视野变化。数值尚未连接真实观测或模型服务，不能作为运行结论。';
  if(/核查|动作|建议/.test(question))return '建议核查对象为'+n.rack+'的'+n.side+'测点及相同高度的前后侧配对节点。先复核传感器与时间同步，再观察气流遮挡、回流和邻架温度。当前为演示，尚无已验证故障或实际控制建议。';
  if(/边|子图|拓扑|布局|空间/.test(question))return '空间布局来自已归档的两排十二机架、72节点、324条有向候选边。'+summary+' 启用RC连接可查看前后侧、垂向、同排及跨排关系；这些连接表示候选热耦合，不能等同于实测流线。';
  return summary+' 该页面按研究拓扑映射三维场景，尺寸为示意。可咨询图层含义、节点位置、RC连接或核查建议。';
}
window.thermalBridge={getState:()=>({...state}),getActions:()=>JSON.parse(JSON.stringify(actions))};
window.addEventListener('thermal:twin-selection',e=>{
  Object.assign(state,{rack:e.detail.rack,rackName:e.detail.rackName,node:e.detail.node,field:e.detail.field});
  updateAssistantContext();
});
