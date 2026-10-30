/* Archive clock, transparent exports, and evidence provenance. No model fitting. */
(() => {
  const $=s=>document.querySelector(s);
  let packet=null, metrics=null, index=60, mode='replay', timer=null;
  const fmt=v=>Number.isFinite(v)?v.toFixed(2):'—';
  const log=[];
  const ready=Promise.all([fetch('./data/replay.json').then(r=>{if(!r.ok)throw Error('Failed to load the observation archive');return r.json();}),fetch('./data/metrics.json').then(r=>{if(!r.ok)throw Error('Failed to load the metrics archive');return r.json();})]).then(([p,m])=>{
    packet=p;metrics=m;
    if(p.schema!=='thermalgraph-replay-v1'||p.nodeOrder.length!==72||p.origins.length!==p.prediction.length)throw Error('Archive structure mismatch');
    updateClock();renderAudit();return p;
  }).catch(e=>{ $('#replay-position').textContent=e.message;$('#replay-play').disabled=true;throw e;});
  function record(type,detail){log.push({at:new Date().toISOString(),type,detail,mode,origin:packet?.origins[index]});}
  function updateClock(){
    if(!packet)return;
    $('#replay-slider').value=index;$('#replay-time').value=packet.origins[index].slice(11);
    $('#replay-position').textContent=packet.origins[index]+' · '+(index+1)+' / '+packet.origins.length+' · 1 min sampling';
    document.querySelector('.top-meta b').textContent=packet.origins[index];
    document.querySelector('.top-meta>span').textContent='Archived Research Data · Historical Replay';
    document.querySelector('.sidebar-foot b').textContent='Archived research data connected';
    document.querySelector('.sidebar-foot small').textContent='181 time points / 72 nodes / 60 horizons';
    window.dispatchEvent(new CustomEvent('thermal:replay-frame'));
  }
  function seek(i){index=Math.max(0,Math.min(packet.origins.length-1,Math.round(i)));updateClock();}
  function stop(){clearInterval(timer);timer=null;$('#replay-play').textContent='Play';}
  function play(){if(timer){stop();return;}if(index===packet.origins.length-1)index=0;$('#replay-play').textContent='Pause';timer=setInterval(()=>{seek(index+1);if(index===packet.origins.length-1)stop();},+$('#replay-speed').value);}
  $('#replay-slider').addEventListener('input',e=>{stop();seek(+e.target.value);});
  $('#replay-prev').onclick=()=>{stop();seek(index-1);};$('#replay-next').onclick=()=>{stop();seek(index+1);};$('#replay-play').onclick=play;
  $('#replay-speed').onchange=()=>{if(timer){stop();play();}};
  $('#replay-time').onchange=e=>{const i=packet.origins.findIndex(t=>t.endsWith(e.target.value));if(i<0){$('#replay-position').textContent='Select a whole minute between 09:00 and 12:00';return;}stop();seek(i);};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  function download(content,name,type){const u=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}
  function cell(v){let s=v==null?'':String(v);if(/^[=+@\t\r]/.test(s)||(/^\s*-/.test(s)&&!Number.isFinite(Number(s))))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
  function csv(rows){return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');}
  function range(){const start=$('#export-start').value,end=$('#export-end').value;const a=packet.origins.findIndex(x=>x.endsWith(start)),b=packet.origins.findIndex(x=>x.endsWith(end));if(a<0||b<a)throw Error('Select a valid range between 09:00 and 12:00; the end time cannot precede the start time.');return [a,b];}
  $('#open-export').onclick=()=>$('#export-dialog').showModal();
  const headerButton=document.createElement('button');headerButton.className='secondary';headerButton.textContent='Export';headerButton.onclick=()=>$('#export-dialog').showModal();document.querySelector('.top-meta').appendChild(headerButton);
  document.querySelectorAll('[data-export]').forEach(button=>button.onclick=async()=>{
    try{
      await ready;const kind=button.dataset.export;const [a,b]=range();let rows=[];
      $('#export-status').textContent='Preparing…';
      if(kind==='observations'){
        rows=[['timestamp','node_id','temperature_c','observed_mask','staleness_min','rh_percent','power_pa_kw','power_pb_kw','source']];
        for(let i=a;i<=b;i++){const o=packet.originOffsets[i];packet.nodeOrder.forEach((id,n)=>rows.push([packet.origins[i],id,packet.temperature[o][n],packet.observedMask[o][n],packet.stalenessMinutes[o][n],packet.rh[o][n],packet.powerPA[o][Math.floor(n/6)],packet.powerPB[o][Math.floor(n/6)],'TDC2.0 minute-last + causal LOCF']));}
      } else if(kind==='predictions'){
        rows=[['origin','target','horizon_min','node_id','prediction_c','risk_probability','model','output_stage']];
        for(let i=a;i<=b;i++)for(let h=0;h<60;h++)packet.nodeOrder.forEach((id,n)=>rows.push([packet.origins[i],packet.observationTimes[packet.originOffsets[i]+h+1],h+1,id,packet.prediction[i][h][n],null,'frozen deployment trajectory','historical residual correction + conditional correction']));
      } else if(kind==='metrics'){const selected=metrics.models.find(row=>row['模型']==='主模型');rows=[Object.keys(selected),Object.values(selected)];}
      if(rows.length)download(csv(rows),'thermalgraph-'+kind+'-'+$('#export-start').value.replace(':','')+'-'+$('#export-end').value.replace(':','')+'.csv','text/csv;charset=utf-8');
      if(kind==='actions')download(JSON.stringify({exportedAt:new Date().toISOString(),storage:'this browser only',records:window.thermalBridge.getActions(),sessionLog:log},null,2),'thermalgraph-actions.json','application/json');
      if(kind==='manifest')download(JSON.stringify({schema:packet.schema,selection:{from:packet.origins[a],to:packet.origins[b]},timezone:packet.timezone,provenance:packet.provenance,metricsSource:metrics.source},null,2),'thermalgraph-provenance.json','application/json');
      if(kind==='image')window.thermalTwin.exportImage();
      record('export',{kind,from:packet.origins[a],to:packet.origins[b]});$('#export-status').textContent='Export complete. CSV files always use archived research data; illustrative values are not mixed into research data.';
    }catch(e){$('#export-status').textContent=e.message;}
  });
  function renderAudit(){
    const auditContent=$('#view-audit .audit-content');
    if(auditContent)auditContent.innerHTML='';
    return;
  }
  const notice=document.createElement('div');notice.className='evidence-notice';notice.textContent='Risk candidates on this page are generated from the t+60 frozen forecast and empirical risk-confidence space at the current replay time. They demonstrate rolling risk inference and are not ground-truth anomaly labels; probabilities below 50% do not trigger a warning notification.';$('#view-events').prepend(notice);
  $('#view-events .case-title .secondary').onclick=()=>document.querySelector('[data-view="spatial"]').click();
  $('#assistant-prompts button').textContent='How is the current risk calculated?';
  $('.assistant-disclaimer').textContent='This is a local rule-based contextual assistant and is not connected to an external language model. It explains available data and inspection boundaries but sends no control commands.';
  window.thermalReplay={ready,get:()=>({packet,metrics,index,mode}),seek,record,fmt};
})();
