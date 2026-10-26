/* Archive clock, transparent exports, and evidence provenance. No model fitting. */
(() => {
  const $=s=>document.querySelector(s);
  let packet=null, metrics=null, index=60, mode='replay', timer=null;
  const fmt=v=>Number.isFinite(v)?v.toFixed(2):'—';
  const log=[];
  const ready=Promise.all([fetch('./data/replay.json').then(r=>{if(!r.ok)throw Error('观测归档加载失败');return r.json();}),fetch('./data/metrics.json').then(r=>{if(!r.ok)throw Error('指标归档加载失败');return r.json();})]).then(([p,m])=>{
    packet=p;metrics=m;
    if(p.schema!=='thermalgraph-replay-v1'||p.nodeOrder.length!==72||p.origins.length!==p.prediction.length)throw Error('归档结构不一致');
    updateClock();renderAudit();return p;
  }).catch(e=>{ $('#replay-position').textContent=e.message;$('#replay-play').disabled=true;throw e;});
  function record(type,detail){log.push({at:new Date().toISOString(),type,detail,mode,origin:packet?.origins[index]});}
  function updateClock(){
    if(!packet)return;
    $('#replay-slider').value=index;$('#replay-time').value=packet.origins[index].slice(11);
    $('#replay-position').textContent=packet.origins[index]+' · '+(index+1)+' / '+packet.origins.length+' · 1 min采样';
    document.querySelector('.top-meta b').textContent=mode==='replay'?packet.origins[index]:'2023-02-18 10:00';
    document.querySelector('.top-meta>span').textContent=mode==='replay'?'历史回放 · 非实时':'功能示例 · 合成';
    document.querySelector('.sidebar-foot b').textContent=mode==='replay'?'真实归档已接入':'功能示例';
    document.querySelector('.sidebar-foot small').textContent=mode==='replay'?'181时刻 / 72节点 / 60视野':'合成风险值，不用于研究结论';
    document.querySelector('.twin-data-badge').textContent=mode==='replay'?'真实观测 + 冻结预测':'合成数值示例';
    $('#model-source option').textContent=mode==='replay'?'Main V74.1 · 冻结部署输出':'Main · 轨迹示例';
    $('#risk-source option').textContent=mode==='replay'?'节点风险概率未接入':'图空间标准 · 示例';
    $('#replay-deck').classList.toggle('demo-mode',mode==='demo');
    window.dispatchEvent(new CustomEvent('thermal:replay-frame'));
  }
  function seek(i){index=Math.max(0,Math.min(packet.origins.length-1,Math.round(i)));updateClock();}
  function stop(){clearInterval(timer);timer=null;$('#replay-play').textContent='播放';}
  function play(){if(timer){stop();return;}if(index===packet.origins.length-1)index=0;$('#replay-play').textContent='暂停';timer=setInterval(()=>{seek(index+1);if(index===packet.origins.length-1)stop();},+$('#replay-speed').value);}
  $('#replay-slider').addEventListener('input',e=>{stop();seek(+e.target.value);});
  $('#replay-prev').onclick=()=>{stop();seek(index-1);};$('#replay-next').onclick=()=>{stop();seek(index+1);};$('#replay-play').onclick=play;
  $('#replay-speed').onchange=()=>{if(timer){stop();play();}};
  $('#replay-time').onchange=e=>{const i=packet.origins.findIndex(t=>t.endsWith(e.target.value));if(i<0){$('#replay-position').textContent='请选择09:00–12:00内的整分钟';return;}stop();seek(i);};
  $('#data-mode').onchange=e=>{stop();mode=e.target.value;record('mode',mode);updateClock();};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  function download(content,name,type){const u=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}
  function cell(v){let s=v==null?'':String(v);if(/^[=+@\t\r]/.test(s)||(/^\s*-/.test(s)&&!Number.isFinite(Number(s))))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
  function csv(rows){return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');}
  function range(){const start=$('#export-start').value,end=$('#export-end').value;const a=packet.origins.findIndex(x=>x.endsWith(start)),b=packet.origins.findIndex(x=>x.endsWith(end));if(a<0||b<a)throw Error('请选择09:00–12:00之间的有效起止时间，结束不得早于开始。');return [a,b];}
  $('#open-export').onclick=()=>$('#export-dialog').showModal();
  const headerButton=document.createElement('button');headerButton.className='secondary';headerButton.textContent='导出';headerButton.onclick=()=>$('#export-dialog').showModal();document.querySelector('.top-meta').insertBefore(headerButton,$('#theme-toggle'));
  document.querySelectorAll('[data-export]').forEach(button=>button.onclick=async()=>{
    try{
      await ready;const kind=button.dataset.export;const [a,b]=range();let rows=[];
      $('#export-status').textContent='正在准备…';
      if(kind==='observations'){
        rows=[['timestamp','node_id','temperature_c','observed_mask','staleness_min','rh_percent','power_pa_kw','power_pb_kw','source']];
        for(let i=a;i<=b;i++){const o=packet.originOffsets[i];packet.nodeOrder.forEach((id,n)=>rows.push([packet.origins[i],id,packet.temperature[o][n],packet.observedMask[o][n],packet.stalenessMinutes[o][n],packet.rh[o][n],packet.powerPA[o][Math.floor(n/6)],packet.powerPB[o][Math.floor(n/6)],'TDC2.0 minute-last + causal LOCF']));}
      } else if(kind==='predictions'){
        rows=[['origin','target','horizon_min','node_id','prediction_c','risk_probability','model','output_stage']];
        for(let i=a;i<=b;i++)for(let h=0;h<60;h++)packet.nodeOrder.forEach((id,n)=>rows.push([packet.origins[i],packet.observationTimes[packet.originOffsets[i]+h+1],h+1,id,packet.prediction[i][h][n],null,'Main V74.1','frozen deployment output']));
      } else if(kind==='metrics')rows=[Object.keys(metrics.models[0]),...metrics.models.map(Object.values)];
      if(rows.length)download(csv(rows),'thermalgraph-'+kind+'-'+$('#export-start').value.replace(':','')+'-'+$('#export-end').value.replace(':','')+'.csv','text/csv;charset=utf-8');
      if(kind==='actions')download(JSON.stringify({exportedAt:new Date().toISOString(),storage:'this browser only',records:window.thermalBridge.getActions(),sessionLog:log},null,2),'thermalgraph-actions.json','application/json');
      if(kind==='manifest')download(JSON.stringify({schema:packet.schema,selection:{from:packet.origins[a],to:packet.origins[b]},timezone:packet.timezone,provenance:packet.provenance,metricsSource:metrics.source},null,2),'thermalgraph-provenance.json','application/json');
      if(kind==='image')window.thermalTwin.exportImage();
      record('export',{kind,from:packet.origins[a],to:packet.origins[b]});$('#export-status').textContent='已导出。CSV始终来自真实归档，功能示例数值不混入研究数据。';
    }catch(e){$('#export-status').textContent=e.message;}
  });
  function renderAudit(){
    const tbody=$('#view-audit table tbody');tbody.innerHTML='';
    metrics.models.forEach(row=>{const tr=document.createElement('tr');if(row['模型']==='主模型')tr.className='best';[row['模型']==='主模型'?'Main':row['模型'],row['MAE/℃'],row['相对Persistence技能分数']].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.appendChild(td);});tbody.appendChild(tr);});
    $('#ranking-standard').textContent='固定2月测试集 · 完整部署链路';
    $('#audit-standard').disabled=true;$('#view-audit .audit-controls').querySelectorAll('select').forEach(e=>e.disabled=true);
    $('#run-audit').textContent='归档结果';$('#run-audit').disabled=true;
    $('#view-audit .audit-grid>div').innerHTML='<div class="panel-block source-panel"><p class="eyebrow">VERIFIED ARCHIVE</p><h2>结果来源与口径</h2><p>右侧8模型指标读取第三章归档表，描述完整部署预测链路，而非所有网络的原始输出。当前回放仅展示Main真实温度轨迹，不重新训练、不改动指标。</p><div class="source-kpis"><div><b>72</b><span>温度节点</span></div><div><b>60</b><span>预测视野 / min</span></div><div><b>181</b><span>回放起点</span></div></div><h3>已连接</h3><p>一分钟观测、PA/PB功率、相对湿度、质量掩码、Main冻结部署预测、8模型汇总结果。</p><h3>尚未连接</h3><p>同版本节点风险概率、校准区间以及节点/边/子图定位置信度。因此本页不再展示手绘误差曲线或合成误差矩阵。</p><h3>完整性复核</h3><p>72节点顺序一致；回放当前温度与预测缓存当前温度最大差为0 °C；历史误差成熟条件违规数为0。来源文件SHA-256可通过“导出”查看。</p></div>';
  }
  // Legacy case studies remain explicitly isolated examples, never archive facts.
  ['events','actions'].forEach(v=>{const n=document.createElement('div');n.className='evidence-notice';n.textContent=v==='events'?'流程示例：本页候选事件、概率和定位置信度为合成数据，并非当前归档时段的研究结果。':'本机核查工作区：初始条目为流程示例；从空间页新建的条目携带真实回放时间与观测证据。状态不表示已在机房执行。';$('#view-'+v).prepend(n);});
  $('#view-events .case-title .secondary').onclick=()=>document.querySelector('[data-view="spatial"]').click();
  $('#assistant-prompts button').textContent='当前测点的数据来源是什么？';
  $('.assistant-disclaimer').textContent='当前为本地规则式上下文咨询，未连接外部大语言模型。仅解释已接入数据与核查边界，不发送控制指令。';
  window.thermalReplay={ready,get:()=>({packet,metrics,index,mode}),seek,record,fmt};
})();
