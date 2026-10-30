import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

// Topology comes from the frozen 72-node / 324-edge research graph.
// Dimensions and displayed scalar fields are explicitly illustrative, not surveyed/live.
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const heights = [0.42, 1.17, 1.92];
const levels = ['Lower', 'Middle', 'Upper'];
const view = { field: 'temperature', horizon: 60, selected: 40, edges: false, shell: true };
const thermalStops = ['#2879d5', '#30b8c2', '#edd879', '#ec7653', '#c83b59'];
const riskStops = ['#53b9bd', '#a8cd9a', '#f4da78', '#ef9853', '#db495a'];
const sceneLabels = [], pickables = [], shells = [], panelMeshes = [], sensorMeshes = [];
let topology, nodes, scene, camera, renderer, controls, outline, graphGroup, selectedEdges;
let poseTarget = null, lastPointer = null, rendered = false;
const archive=()=>window.thermalReplay?.get();
const isArchive=()=>archive()?.mode==='replay';
const percent=p=>p==null?'Unavailable':Math.round(p*100)+'%';
const number=(v,d=1)=>v==null?'—':Number(v).toFixed(d);
const quantile=(values,q)=>{const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const p=(a.length-1)*q,lo=Math.floor(p),hi=Math.ceil(p);return a[lo]+(a[hi]-a[lo])*(p-lo)};
const riskBasis=new Map();
const observationBasis={nodes:null,dynamic:null};
const median=a=>quantile(a,.5);
const percentileRank=(values,x)=>{const a=values.filter(Number.isFinite);if(!a.length||!Number.isFinite(x))return null;return a.filter(v=>v<=x).length/a.length;};
function prepareObservationBasis(){
  if(observationBasis.nodes||!isArchive())return;
  const p=archive().packet,rows=p.temperature;
  observationBasis.nodes=nodes.map((n,i)=>{
    const values=rows.map(r=>r[i]).filter(Number.isFinite),center=median(values);
    const scale=Math.max(.02,1.4826022185*median(values.map(v=>Math.abs(v-center))));
    const zSeries=rows.map(r=>Number.isFinite(r[i])?Math.abs(r[i]-center)/scale:null);
    const d5=rows.map((r,t)=>t>=5&&Number.isFinite(r[i])&&Number.isFinite(rows[t-5][i])?r[i]-rows[t-5][i]:null);
    const d15=rows.map((r,t)=>t>=15&&Number.isFinite(r[i])&&Number.isFinite(rows[t-15][i])?r[i]-rows[t-15][i]:null);
    const d5Scale=Math.max(.02,1.4826022185*median(d5.filter(Number.isFinite).map(v=>Math.abs(v-median(d5.filter(Number.isFinite))))));
    return {center,scale,zSeries,d5,d15,d5Scale};
  });
  observationBasis.dynamic=rows.map((r,t)=>{
    if(t<5)return null;let sum=0,count=0;
    observationBasis.nodes.forEach((b,i)=>{const d=b.d5[t];if(Number.isFinite(d)){sum+=(d/b.d5Scale)**2;count++;}});
    return count?Math.sqrt(sum/count):null;
  });
}
function observationEvidence(node){
  if(!isArchive())return null;prepareObservationBasis();
  const p=archive().packet,o=p.originOffsets[archive().index],basis=observationBasis.nodes[node.index];
  const statRaw=basis.zSeries[o],stat=percentileRank(basis.zSeries,statRaw);
  const neighbourIds=[...new Set(topology.directed_edges.filter(e=>e.source_index===node.index||e.target_index===node.index).flatMap(e=>[e.source_index,e.target_index]).filter(i=>i!==node.index))];
  const graphSeries=p.temperature.map((_,t)=>{
    const own=basis.zSeries[t],near=neighbourIds.map(i=>observationBasis.nodes[i].zSeries[t]).filter(Number.isFinite);
    return Number.isFinite(own)&&near.length?Math.sqrt(.1*own*own+.9*own*(near.reduce((a,b)=>a+b,0)/near.length)):null;
  });
  const graphRaw=graphSeries[o],graph=percentileRank(graphSeries,graphRaw);
  const dynamicRaw=observationBasis.dynamic[o],dynamic=percentileRank(observationBasis.dynamic,dynamicRaw);
  const d5=basis.d5[o],d15=basis.d15[o],positive5=basis.d5.filter(v=>Number.isFinite(v)&&v>0),positive15=basis.d15.filter(v=>Number.isFinite(v)&&v>0);
  const sequence=(d5>0&&d15>0)?Math.sqrt((percentileRank(positive5,d5)||0)*(percentileRank(positive15,d15)||0)):0;
  return {stat,graph,dynamic,sequence,raw:{stat:statRaw,graph:graphRaw,dynamic:dynamicRaw,d5,d15},neighbourCount:neighbourIds.length,note:'Support computed from the current archived replay window; formal inference still uses the frozen training references.'};
}
function riskSummary(node,horizon=60){
  if(!isArchive())return null;
  const p=archive().packet,key=node.index+':'+horizon;
  let basis=riskBasis.get(key);
  if(!basis){
    const history=p.temperature.map(row=>row[node.index]).filter(Number.isFinite);
    const center=quantile(history,.5);
    const deviation=history.map(v=>Math.abs(v-center));
    const radius=Math.max(.05,quantile(deviation,.95));
    const residuals=[];
    for(let j=0;j<p.origins.length;j++){
      const target=p.originOffsets[j]+horizon;
      const actual=p.temperature[target]?.[node.index],pred=p.prediction[j]?.[horizon-1]?.[node.index];
      if(Number.isFinite(actual)&&Number.isFinite(pred))residuals.push(actual-pred);
    }
    basis={center,radius,residuals};riskBasis.set(key,basis);
  }
  const pred=p.prediction[archive().index]?.[horizon-1]?.[node.index];
  if(!Number.isFinite(pred)||!basis.residuals.length)return null;
  const samples=basis.residuals.map(e=>pred+e);
  const probability=samples.filter(v=>Math.abs(v-basis.center)>basis.radius).length/samples.length;
  return {probability,lower:quantile(samples,.05),upper:quantile(samples,.95),prediction:pred,referenceLower:basis.center-basis.radius,referenceUpper:basis.center+basis.radius,sampleCount:samples.length};
}
function applyFrame(){
  const a=archive();if(!a?.packet)return;
  if(isArchive()){
    const o=a.packet.originOffsets[a.index];
    nodes.forEach((n,i)=>{n.temperature=a.packet.temperature[o][i];n.observed=a.packet.observedMask[o][i];n.staleness=a.packet.stalenessMinutes[o][i];n.rh=a.packet.rh[o][i];n.powerPA=a.packet.powerPA[o][n.rackIndex];n.powerPB=a.packet.powerPB[o][n.rackIndex];});
  }else{const demo=buildNodeData(topology.node_order);nodes.forEach((n,i)=>{n.temperature=demo[i].temperature;});}
  const values=nodes.map(n=>n.temperature).filter(Number.isFinite);$('#twin-temp-range').textContent=Math.min(...values).toFixed(1)+'–'+Math.max(...values).toFixed(1)+' °C';
  $('#twin-temp-range').nextElementSibling.textContent=isArchive()?'Archived one-minute observations':'Synthetic snapshot';
  refreshField();
}

function scalarColor(value, min, max, stops) {
  const t = THREE.MathUtils.clamp((value-min)/(max-min),0,1)*(stops.length-1);
  const lo=Math.min(stops.length-2,Math.floor(t));
  return new THREE.Color(stops[lo]).lerp(new THREE.Color(stops[lo+1]), t-lo);
}
function probability(node, horizon) {
  if(isArchive())return riskSummary(node,horizon)?.probability??null;
  const rack=node.rackIndex, row=Math.floor(rack/6), col=rack%6;
  const cluster=Math.exp(-((col-1.4)**2)/2.8)*(row ? 1 : .45);
  const susceptibility=(node.side==='Back' ? .9 : .30)*(0.78+node.heightIndex*.13);
  const base=.05+.03*(col%3)+.09*(node.side==='Back');
  const pulse=Math.exp(-(((horizon-37)/27)**2));
  return THREE.MathUtils.clamp(base + cluster*susceptibility*(.24+.65*(1-Math.exp(-horizon/23))) + .10*pulse, .01,.96);
}
function buildNodeData(order) {
  return order.map((id,index)=>{
    const rackIndex=Math.floor(index/6), slot=index%6, row=Math.floor(rackIndex/6), col=rackIndex%6;
    const heightIndex=slot%3, side=slot<3?'Front':'Back', rack=id.split('_')[0];
    const z=row===0?-1.55:1.55, frontSign=row===0?1:-1;
    const planeSign=side==='Front'?frontSign:-frontSign;
    const front=24.2+col*.24+row*.35+heightIndex*.28+.15*Math.sin(col*1.7);
    const rise=2.5+heightIndex*.24+.9*Math.exp(-((col-1.4)**2)/2.8)*row;
    return {id,index,rackIndex,rack,side,heightIndex,planeSign,
      temperature:Math.round((front+(side==='Back'?rise:0))*10)/10,
      position:new THREE.Vector3((col-2.5)*1.2,heights[heightIndex],z+planeSign*.565)};
  });
}
function material(color, options={}) {return new THREE.MeshStandardMaterial({color,roughness:.66,metalness:.25,...options});}
function box(w,h,d,x,y,z,mat,parent=scene) {
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function line(points,color,opacity=1,parent=scene) {
  const geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>Array.isArray(p)?new THREE.Vector3(...p):p));
  const obj=new THREE.Line(geometry,new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity}));
  parent.add(obj);return obj;
}
function label(text,position,className='',rackIndex=null) {
  const element=document.createElement('div');element.className='twin-label '+className;element.textContent=text;
  $('#twin-labels').appendChild(element);sceneLabels.push({element,position:new THREE.Vector3(...position),rackIndex});
}
function floorText(text,position,width=3,color='#72cdbf') {
  const canvas=document.createElement('canvas');canvas.width=768;canvas.height=128;
  const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.font='600 40px Arial';ctx.textAlign='center';ctx.fillText(text,384,78);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,width/6),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));
  mesh.rotation.x=-Math.PI/2;mesh.position.set(...position);scene.add(mesh);
}
function addRoom() {
  scene.background=new THREE.Color('#101d30');
  scene.fog=new THREE.Fog('#101d30',24,50);
  scene.add(new THREE.HemisphereLight('#d8ecff','#203448',2.4));
  const light=new THREE.DirectionalLight('#ffffff',3.0);light.position.set(-3,9,4);light.castShadow=true;
  light.shadow.mapSize.set(1024,1024);Object.assign(light.shadow.camera,{left:-9,right:9,top:9,bottom:-9,near:.1,far:30});
  light.shadow.bias=-.001;scene.add(light);
  const fill=new THREE.DirectionalLight('#7fc7ee',1.4);fill.position.set(4,4,-6);scene.add(fill);
  box(12,.24,8.3,.35,-.20,0,material('#1b2b41',{metalness:.55,roughness:.38}));
  box(11.85,.08,8.15,.35,-.045,0,material('#415166',{metalness:.15,roughness:.8}));
  // Raised-floor grid and perimeter strips establish scale without implying CFD.
  for(const z of [-4.04,4.04])box(11.7,.015,.025,.35,.003,z,new THREE.MeshBasicMaterial({color:'#7797b9'}));
  const grid=new THREE.GridHelper(12,24,'#4e687a','#354d60');grid.position.set(.35,-.025,0);scene.add(grid);
  box(9,.018,1.94,0,.005,0,material('#1b5360',{metalness:.1}));
  [-2.9,2.9].forEach(z=>box(9,.015,1.25,0,.002,z,material('#453d36')));
  box(12,.5,.10,.35,.13,-4.12,material('#4b6277',{transparent:true,opacity:.65}));
  box(.10,.5,8.3,-5.6,.13,0,material('#4b6277',{transparent:true,opacity:.65}));
  floorText('COLD AISLE  /  FRONT → RACK ← FRONT',[0,.025,0],6.8);
  floorText('EXHAUST  /  ROW 05',[0,.025,-3.15],4,'#bf917c');
  floorText('EXHAUST  /  ROW 06',[0,.025,3.15],4,'#bf917c');
  const ahu=box(1.05,1.62,1.7,5.12,.81,0,material('#9eabb8',{roughness:.4,metalness:.45}));
  for(const z of [-.43,.43]){
    const fan=new THREE.Mesh(new THREE.CylinderGeometry(.30,.30,.06,28),material('#22374c'));fan.rotation.z=Math.PI/2;fan.position.set(4.56,.94,z);scene.add(fan);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.08,16),material('#9eafbd'));hub.rotation.z=Math.PI/2;hub.position.set(4.52,.94,z);scene.add(hub);
  }
  for(let i=0;i<9;i++)box(.015,.043,1.3,4.584,.25+i*.14,0,material('#244456'));
  box(.05,.05,1.3,4.54,.04,0,material('#54cbb7'));
  label('Supply-air equipment · schematic location',[5.12,2.05,0],'equipment');
  label('Central cold aisle',[0,.12,0],'aisle');
  label('Hot-air zone',[-.1,.1,-3.45],'hot');label('Hot-air zone',[-.1,.1,3.45],'hot');
  for(let col=0;col<6;col++){
    const x=(col-2.5)*1.2;
    for(const direction of [-1,1]){
      const arrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,direction),new THREE.Vector3(x,.085,direction*.17),.72,0x4bcbb9,.13,.085);
      scene.add(arrow);
      const exhaust=new THREE.ArrowHelper(new THREE.Vector3(0,0,direction),new THREE.Vector3(x,.085,direction*2.22),.72,0xd08d67,.13,.085);scene.add(exhaust);
    }
  }
}
function addRacks() {
  const shellMaterial=material('#202d3e',{metalness:.55,roughness:.42}),metal=material('#8091a5',{metalness:.75,roughness:.35});
  const ventMat=material('#10283a'),panelGeo=new THREE.BoxGeometry(.77,.63,.024);
  const sphereGeo=new THREE.SphereGeometry(.075,14,10);
  for(let r=0;r<12;r++){
    const x=(r%6-2.5)*1.2,z=r<6?-1.55:1.55;
    const chassis=box(.94,2.32,1.05,x,1.17,z,shellMaterial);chassis.userData.rackIndex=r;
    pickables.push(chassis);shells.push(chassis);
    for(const dx of [-.43,.43])for(const dz of [-.48,.48])box(.045,2.32,.045,x+dx,1.17,z+dz,metal);
    box(1.0,.08,1.12,x,.055,z,material('#142533'));
    box(1.0,.06,1.12,x,2.35,z,metal);
    const edges=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(.94,2.32,1.05)),new THREE.LineBasicMaterial({color:'#729bb2',transparent:true,opacity:.4}));
    edges.position.set(x,1.17,z);scene.add(edges);
    label(nodes[r*6].rack,[x,2.65,z],'',r);
    // All six monitoring positions share one physical rack coordinate system.
    nodes.slice(r*6,r*6+6).forEach(n=>{
      const panel=new THREE.Mesh(panelGeo,material(scalarColor(n.temperature,28,43,thermalStops),{metalness:.25,roughness:.60}));
      panel.position.copy(n.position);panel.position.z-=n.planeSign*.025;panel.userData.nodeIndex=n.index;scene.add(panel);pickables.push(panel);panelMeshes.push(panel);
      for(let k=0;k<6;k++){
        const vent=box(.58,.022,.012,x,n.position.y-.23+k*.088,n.position.z-.006*n.planeSign,ventMat);
        vent.userData.nodeIndex=n.index;pickables.push(vent);
        box(.025,.019,.013,x+.31,n.position.y-.23+k*.088,n.position.z-.001*n.planeSign,new THREE.MeshBasicMaterial({color:k%2?'#8ecfd4':'#c1dfe5'}));
      }
      const sensor=new THREE.Mesh(sphereGeo,new THREE.MeshBasicMaterial({color:scalarColor(n.temperature,22,34,thermalStops)}));
      sensor.position.copy(n.position);sensor.position.x-=.34;sensor.position.z+=n.planeSign*.10;
      sensor.userData.nodeIndex=n.index;scene.add(sensor);sensorMeshes.push(sensor);pickables.push(sensor);
      const rim=new THREE.Mesh(new THREE.TorusGeometry(.09,.013,7,18),new THREE.MeshBasicMaterial({color:'#d6efff'}));
      rim.position.copy(sensor.position);scene.add(rim);
    });
    // F/B captions are actual 3D face decals and therefore rotate with the scene.
    for(const side of ['Front','Back']){
      const n=nodes[r*6+(side==='Front'?0:3)];
      const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#d8e9f3';ctx.font='bold 26px Arial';ctx.textAlign='center';ctx.fillText(side.toUpperCase(),128,40);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      const face=new THREE.Mesh(new THREE.PlaneGeometry(.7,.175),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));
      face.position.set(x,2.21,z+n.planeSign*.543);if(n.planeSign<0)face.rotation.y=Math.PI;scene.add(face);
    }
  }
  outline=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.07,2.49,1.22)),new THREE.LineBasicMaterial({color:'#81f3e5',depthTest:false,transparent:true,opacity:.85}));
  outline.renderOrder=10;scene.add(outline);
}
function addGraph() {
  graphGroup=new THREE.Group();scene.add(graphGroup);
  selectedEdges=new THREE.Group();scene.add(selectedEdges);
  const colors={front_to_back:0x5fe2f0,vertical:0xc49ff7,same_row_adjacent:0xfac073,cross_row_matched:0x71cc9d};
  for(const [type,color] of Object.entries(colors)){
    const positions=[];
    topology.directed_edges.filter(e=>e.edge_type===type).forEach(e=>positions.push(...nodes[e.source_index].position.toArray(),...nodes[e.target_index].position.toArray()));
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    const mesh=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color,transparent:true,opacity:.35,depthTest:false}));
    mesh.renderOrder=4;graphGroup.add(mesh);
  }
  graphGroup.visible=false;
  const legend=document.createElement('div');legend.className='twin-edge-legend';legend.id='twin-edge-legend';legend.hidden=true;
  legend.innerHTML='<span><i style="background:#5abed0"></i>Front→Back 36</span><span><i style="background:#b385dc"></i>Vertical 96</span><span><i style="background:#d79b43"></i>Same row 120</span><span><i style="background:#62b590"></i>Cross row 72</span><br>Candidate thermal-coupling topology; not measured airflow paths.';
  $('.twin-footer').after(legend);
}
function selectNode(index,updateMenus=true) {
  view.selected=index;const n=nodes[index],base=n.rackIndex*6,front=nodes[base+n.heightIndex],back=nodes[base+3+n.heightIndex];
  outline.position.set(n.position.x,1.17,n.rackIndex<6?-1.55:1.55);
  sceneLabels.forEach(l=>l.element.classList.toggle('selected',l.rackIndex===n.rackIndex));
  if(updateMenus){$('#twin-rack-select').value=n.rackIndex;$('#twin-node-select').value=index%6;}
  $('#selected-rack').textContent=n.rack;
  $('#front-temp').textContent=front.temperature.toFixed(1)+' °C';$('#back-temp').textContent=back.temperature.toFixed(1)+' °C';
  $('#temp-rise').textContent='+'+(back.temperature-front.temperature).toFixed(1)+' °C';
  $('#temp-rise').textContent=(back.temperature-front.temperature>=0?'+':'')+(back.temperature-front.temperature).toFixed(1)+' °C';
  $('#front-temp').previousElementSibling.textContent=levels[n.heightIndex]+' Front';$('#back-temp').previousElementSibling.textContent=levels[n.heightIndex]+' Back';
  $('#rack-power').textContent=isArchive()?(n.powerPA==null||n.powerPB==null?'—':(n.powerPA+n.powerPB).toFixed(3)+' kW'):(4.8+(n.rackIndex%4)*.55).toFixed(1)+' kW';
  $('#rack-power').previousElementSibling.textContent='Rack load · PA + PB';
  let card=$('#twin-node-card');
  if(!card){card=document.createElement('div');card.className='twin-node-card';card.id='twin-node-card';$('#selected-rack').after(card);}
  card.innerHTML='<small>Selected monitoring node · '+(isArchive()?(n.observed?'valid archived observation':'LOCF-filled · stale '+n.staleness+' min'):'synthetic example')+'</small><b>'+n.id+'</b><span>'+n.side+' · '+levels[n.heightIndex]+' · '+number(n.temperature)+' °C'+(isArchive()?' · RH '+number(n.rh)+'%':'')+'</span>';
  let table=$('#twin-sensor-table');
  if(!table){table=document.createElement('table');table.id='twin-sensor-table';table.className='twin-sensor-table';$('.context-panel .segmented').before(table);}
  table.innerHTML='<thead><tr><th>Position</th><th>Current °C</th><th>t+60 °C</th><th>Risk</th></tr></thead><tbody>'+nodes.slice(base,base+6).map(v=>'<tr class="'+(v.index===index?'selected':'')+'"><td><button data-node-index="'+v.index+'">'+(v.side==='Front'?'F':'B')+' · '+levels[v.heightIndex]+'</button></td><td>'+number(v.temperature)+'</td><td>'+number(archive().packet.prediction[archive().index][59][v.index],2)+'</td><td>'+percent(probability(v,60))+'</td></tr>').join('')+'</tbody>';
  table.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>selectNode(+b.dataset.nodeIndex)));
  const risk=riskSummary(n,60),riskCurve=Array.from({length:60},(_,h)=>probability(n,h+1));
  $('#risk-value').textContent=percent(probability(n,60));
  const evolution=$('#risk-evolution');
  evolution.innerHTML=riskCurve.map((p,h)=>{
    const v=Number.isFinite(p)?Math.max(0,Math.min(1,p)):0;
    const hue=120*(1-v);
    return '<span title="t+'+(h+1)+' min · '+Math.round(v*100)+'%" style="background:hsl('+hue.toFixed(1)+' 72% 43%)"></span>';
  }).join('');
  evolution.setAttribute('aria-label','Risk evolution over the next 60 minutes; t+60 risk is '+percent(probability(n,60))+'; color transitions from green for lower risk to red for higher risk');
  $('#risk-label').textContent='t + 60 min Node Thermal-Deviation Probability';
  $('#risk-interval').textContent=risk?number(risk.lower,2)+'–'+number(risk.upper,2)+' °C':'—';
  const peak=Math.max(...riskCurve.filter(Number.isFinite));
  const crossing=riskCurve.findIndex(v=>Number.isFinite(v)&&v>=.5);
  $('#risk-confidence-note').textContent=risk?'60 min peak risk '+percent(peak)+(crossing>=0?' · first crossing of 50%: t+'+(crossing+1)+' min':' · does not exceed 50% within the forecast period'):'Risk-confidence space unavailable';
  refreshDiagnosis();
  while(selectedEdges.children.length){const obj=selectedEdges.children[0];selectedEdges.remove(obj);obj.geometry?.dispose();obj.material?.dispose();}
  topology.directed_edges.filter(e=>e.source_index===index||e.target_index===index).forEach(e=>{
    const a=nodes[e.source_index].position,b=nodes[e.target_index].position,delta=b.clone().sub(a);
    const arrow=new THREE.ArrowHelper(delta.clone().normalize(),a,delta.length(),0xffffff,.12,.07);
    arrow.line.material.depthTest=false;arrow.cone.material.depthTest=false;arrow.renderOrder=8;selectedEdges.add(arrow);
  });
  selectedEdges.visible=view.edges;
  drawTrajectory(n);
  const selectedRisk=riskSummary(n,60);
  window.dispatchEvent(new CustomEvent('thermal:twin-selection',{detail:{rack:n.rackIndex+1,rackName:n.rack,node:n.id,temperature:n.temperature,risk:selectedRisk?.probability*100,horizon:60,field:view.field}}));
}
function refreshDiagnosis() {
  const n=nodes[view.selected],layer=window.thermalBridge?.getState().layer||'node';
  const neighbour=nodes[(n.rackIndex%6<5?n.rackIndex+1:n.rackIndex-1)*6];
  const base=n.rackIndex*6;
  const pair=nodes[base+(n.side==='Front'?3+n.heightIndex:n.heightIndex)];
  const adjacentRack=n.rackIndex%6<5?n.rackIndex+1:n.rackIndex-1;
  const adjacent=nodes[adjacentRack*6+(n.side==='Front'?n.heightIndex:3+n.heightIndex)];
  const members=layer==='node'?[n]:layer==='edge'?[n,pair]:[n,adjacent];
  const confidence=members.map(v=>probability(v,60)).filter(Number.isFinite).reduce((a,b)=>a+b,0)/members.length;
  $('#diagnosis-target').textContent=layer==='node'?n.id:layer==='edge'?n.rack+' · Front → Back':n.rack+' / '+neighbour.rack;
  $('#diagnosis-confidence').textContent='Localization confidence '+percent(confidence);
  $('#diagnosis-note').textContent=isArchive()?"Confidence is aggregated from the t+60 risks of the spatial object's members. It indicates inspection priority, not a verified fault probability.":layer==='node'?"Example mapping of the selected sensor's current temperature and future probability.":layer==='edge'?'Inspect candidate directed Front–Back thermal coupling at the same rack and height.':'Inspect the candidate local subgraph formed by adjacent racks in the same row.';
}
function drawTrajectory(n) {
  if(isArchive()){drawArchiveTrajectory(n);return;}
  $('#trajectory-title').textContent=n.rack+' · '+n.side+' · '+levels[n.heightIndex];
  $('#trajectory-title').nextElementSibling.textContent='The trajectory and interval are interactive demonstrations and are not connected to frozen forecasts.';
  $('#trajectory-chart .uncertainty-band').style.display='';
  const base=n.temperature,amp=.14+.25*probability(n,60),f=h=>base+amp*(1-Math.exp(-h/26));
  const sy=t=>142-(t-base)*150;
  const observed=Array.from({length:61},(_,i)=>[48+i*342/60,sy(base+.035*Math.sin((i-60)/8)+.018*Math.sin((i-60)/2))]);
  const pred=Array.from({length:61},(_,h)=>[390+h*346/60,sy(f(h))]);
  const path=points=>points.map((p,i)=>(i?'L':'M')+p.map(x=>x.toFixed(2)).join(' ')).join(' ');
  $('#trajectory-chart .observed-line').setAttribute('d',path(observed));
  $('#trajectory-chart .forecast-line').setAttribute('d',path(pred));
  const upper=pred.map((p,h)=>[p[0],p[1]-(.02+.09*Math.sqrt(h/60))*150]);
  const lower=pred.map((p,h)=>[p[0],p[1]+(.02+.09*Math.sqrt(h/60))*150]).reverse();
  $('#trajectory-chart .uncertainty-band').setAttribute('d',path([...upper,...lower])+'Z');
  const axisTexts=$$('#trajectory-chart text');axisTexts[0].textContent=(base+.48).toFixed(1);axisTexts[1].textContent=(base+.09).toFixed(1);
  $('#horizon-point').setAttribute('cx',pred[view.horizon][0]);$('#horizon-point').setAttribute('cy',pred[view.horizon][1]);
}
function drawArchiveTrajectory(n){
  const a=archive(),p=a.packet,o=p.originOffsets[a.index],history=p.temperature.slice(o-60,o+1).map(row=>row[n.index]),pred=[n.temperature,...p.prediction[a.index].map(row=>row[n.index])];
  $('#trajectory-title').textContent=n.id+' · Archived History / Frozen Forecast';
  const bounds=Array.from({length:60},(_,h)=>riskSummary(n,h+1));
  $('#trajectory-title').nextElementSibling.textContent=p.origins[a.index]+' issued · past 60 min on the left · future 60 min on the right · 90% empirical prediction interval';
  const values=[...history,...pred,...bounds.flatMap(b=>b?[b.lower,b.upper]:[])].filter(Number.isFinite),min=Math.min(...values)-.08,max=Math.max(...values)+.08,sy=v=>184-(v-min)/(max-min)*150;
  const path=(v,x,w)=>v.map((t,i)=>(i?'L':'M')+(x+i*w/60).toFixed(2)+' '+sy(t).toFixed(2)).join(' ');
  $('#trajectory-chart .observed-line').setAttribute('d',path(history,48,342));$('#trajectory-chart .forecast-line').setAttribute('d',path(pred,390,346));
  const upper=[n.temperature,...bounds.map(b=>b?.upper??n.temperature)],lower=[n.temperature,...bounds.map(b=>b?.lower??n.temperature)].reverse();
  const upperPoints=upper.map((v,i)=>[390+i*346/60,sy(v)]),lowerPoints=lower.map((v,i)=>[736-i*346/60,sy(v)]);
  const band=[...upperPoints,...lowerPoints].map((q,i)=>(i?'L':'M')+q[0].toFixed(2)+' '+q[1].toFixed(2)).join(' ')+'Z';
  $('#trajectory-chart .uncertainty-band').setAttribute('d',band);$('#trajectory-chart .uncertainty-band').style.display='';
  const labels=$$('#trajectory-chart text');labels[0].textContent=(min+(184-70)/150*(max-min)).toFixed(2);labels[1].textContent=(min+(184-128)/150*(max-min)).toFixed(2);
  $('#horizon-point').setAttribute('cx',390+view.horizon*346/60);$('#horizon-point').setAttribute('cy',sy(pred[view.horizon]));
}
function refreshField() {
  const isTemp=view.field==='temperature';
  nodes.forEach((n,i)=>{
    const color=isTemp?scalarColor(n.temperature,isArchive()?28:22,isArchive()?43:34,thermalStops):scalarColor(probability(n,60)??0,0,1,riskStops);
    panelMeshes[i].material.color.copy(color);sensorMeshes[i].material.color.copy(color);
  });
  $$('.twin-layer-tabs button').forEach(b=>{const selected=b.dataset.field===view.field;b.classList.toggle('active',selected);b.setAttribute('aria-selected',String(selected));});
  $('#twin-stage').setAttribute('aria-labelledby',isTemp?'layer-temperature':'layer-risk');
  $('#twin-field-name').textContent=isTemp?'CURRENT TEMPERATURE':'FUTURE DEVIATION RISK';
  const origin=isArchive()?archive().packet.origins[archive().index]:'2023-02-18 10:00';
  const target=isArchive()?archive().packet.observationTimes[archive().packet.originOffsets[archive().index]+60]:'2023-02-18 11:00';
  $('#twin-field-time').textContent=isTemp?origin+' · archived one-minute observation':target+' · '+origin.slice(11)+' issued · t+60 risk-confidence space';
  if(isArchive()){const a=archive();$('#twin-field-time').textContent=isTemp?a.packet.origins[a.index]+' · archived observation':a.packet.observationTimes[a.packet.originOffsets[a.index]+60]+' · t+60 risk-confidence space';}
  $('#layer-horizon').textContent=view.horizon;$('#twin-color-title').textContent=isTemp?'Temperature / °C':'Thermal-Deviation Probability / %';
  $('#twin-gradient').style.background='linear-gradient(90deg,'+(isTemp?thermalStops:riskStops).join(',')+')';
  $('#twin-color-ticks').innerHTML=(isTemp?(isArchive()?['28','33','38','43']:['22','26','30','34']):['0','25','50','75','100']).map(s=>'<span>'+s+'</span>').join('');
  $('#twin-layer-summary').textContent=isTemp?'Current Temperature':'Future Risk';
  $('#twin-summary-time').textContent=isTemp?'Observation time · archived research data':'Frozen trajectory and archived-residual inference';
  $('#stat-risk').textContent=Math.round(Math.max(...nodes.map(n=>probability(n,60)).filter(Number.isFinite))*100)+'%';
  $('#stat-risk').nextElementSibling.textContent='t+60 empirical risk probability';
  $('#stat-horizon').textContent=view.horizon;
  selectNode(view.selected);
}
function setPose(pose) {
  const aspect=Math.max(.45,renderer.domElement.clientWidth/renderer.domElement.clientHeight);
  const fit=Math.max(1,1.25/aspect);
  const poses={overview:{p:[9*fit,8*fit,10*fit],t:[.5,.5,0]},top:{p:[.4,14*fit,.04],t:[.4,0,0]},aisle:{p:[-7.6,2.5,.0],t:[1,1.1,0]},back:{p:[-8*fit,6*fit,-10*fit],t:[0,.8,0]}};
  poseTarget={position:new THREE.Vector3(...poses[pose].p),target:new THREE.Vector3(...poses[pose].t)};
  $$('.twin-camera-controls button').forEach(b=>b.classList.toggle('active',b.dataset.pose===pose));
}
function updateLabels() {
  const width=renderer.domElement.clientWidth,height=renderer.domElement.clientHeight;
  const projected=new THREE.Vector3();
  const occupied=[];
  const selectedRack=nodes[view.selected].rackIndex;
  const ordered=[...sceneLabels].sort((a,b)=>(b.rackIndex===selectedRack?2:b.rackIndex!==null?1:0)-(a.rackIndex===selectedRack?2:a.rackIndex!==null?1:0));
  for(const l of ordered){
    projected.copy(l.position).project(camera);
    const x=(projected.x*.5+.5)*width,y=(-projected.y*.5+.5)*height;
    let hidden=projected.z>1||projected.z<-1||Math.abs(projected.x)>1||Math.abs(projected.y)>1;
    l.element.hidden=false;
    const w=l.element.offsetWidth+6,h=l.element.offsetHeight+5;
    const rect={l:x-w/2,r:x+w/2,t:y-h/2,b:y+h/2};
    if(y<77||y>height-39||rect.l<2||rect.r>width-2)hidden=true;
    if(x>width-225&&y>height-150)hidden=true;
    if(occupied.some(o=>rect.l<o.r&&rect.r>o.l&&rect.t<o.b&&rect.b>o.t))hidden=true;
    l.element.hidden=hidden;if(!hidden)occupied.push(rect);
    l.element.style.left=x+'px';l.element.style.top=y+'px';
  }
}
function wireInteraction() {
  const dom=renderer.domElement,ray=new THREE.Raycaster(),cursor=new THREE.Vector2(),tooltip=$('#twin-tooltip');
  function hit(e){const rect=dom.getBoundingClientRect();cursor.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(cursor,camera);return ray.intersectObjects(pickables.filter(x=>x.visible),false)[0];}
  dom.addEventListener('pointerdown',e=>{lastPointer={x:e.clientX,y:e.clientY};poseTarget=null;});
  dom.addEventListener('pointerup',e=>{if(!lastPointer||Math.hypot(e.clientX-lastPointer.x,e.clientY-lastPointer.y)>5)return;const target=hit(e);if(!target)return;const data=target.object.userData;selectNode(data.nodeIndex??(data.rackIndex*6+4));});
  dom.addEventListener('pointermove',e=>{
    if(e.buttons){tooltip.hidden=true;return;}const target=hit(e);if(!target){tooltip.hidden=true;dom.style.cursor='grab';return;}
    const d=target.object.userData,n=nodes[d.nodeIndex??(d.rackIndex*6+4)];dom.style.cursor='pointer';
    tooltip.innerHTML='<b>'+n.id+'</b>'+n.side+' · '+levels[n.heightIndex]+'<br>Current Temperature '+number(n.temperature)+' °C<br>+'+view.horizon+' min risk '+percent(probability(n,view.horizon))+'<br><small>'+(isArchive()?'archived observation':'synthetic numerical example')+' · click to select</small>';
    const r=dom.getBoundingClientRect();tooltip.style.left=Math.max(8,Math.min(r.width-238,e.clientX-r.left+15))+'px';tooltip.style.top=Math.max(8,Math.min(r.height-150,e.clientY-r.top+12))+'px';tooltip.hidden=false;
  });
  dom.addEventListener('pointerleave',()=>tooltip.hidden=true);
  dom.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(e.key))return;e.preventDefault();poseTarget=null;
    if(e.key==='Home'){setPose('overview');return;}
    const offset=camera.position.clone().sub(controls.target);
    if(e.key==='+'||e.key==='-')offset.multiplyScalar(e.key==='+'?.9:1.1);
    else {const s=new THREE.Spherical().setFromVector3(offset);s.theta+=(e.key==='ArrowLeft'?.12:e.key==='ArrowRight'?-.12:0);s.phi=THREE.MathUtils.clamp(s.phi+(e.key==='ArrowUp'?-.10:e.key==='ArrowDown'?.10:0),.03,1.52);offset.setFromSpherical(s);}
    camera.position.copy(controls.target).add(offset);controls.update();
  });
  $$('.twin-camera-controls button').forEach(b=>b.addEventListener('click',()=>setPose(b.dataset.pose)));
  $('#twin-reset').addEventListener('click',()=>setPose('overview'));
  $$('.twin-layer-tabs button').forEach(b=>b.addEventListener('click',()=>{view.field=b.dataset.field;refreshField();}));
  $('#twin-edges').addEventListener('change',e=>{view.edges=e.target.checked;graphGroup.visible=view.edges;selectedEdges.visible=view.edges;$('#twin-edge-legend').hidden=!view.edges;});
  $('#twin-shell').addEventListener('change',e=>{view.shell=e.target.checked;shells.forEach(m=>m.visible=view.shell);});
  const rackSelect=$('#twin-rack-select');
  for(let r=0;r<12;r++){const option=document.createElement('option');option.value=r;option.textContent=nodes[r*6].rack+' · '+(r<6?'Row 05':'Row 06');rackSelect.appendChild(option);}
  rackSelect.addEventListener('change',()=>selectNode(+rackSelect.value*6+(view.selected%6)));
  $('#twin-node-select').addEventListener('change',e=>selectNode(Math.floor(view.selected/6)*6+(+e.target.value)));
  $$('.context-panel .segmented button').forEach(b=>b.addEventListener('click',refreshDiagnosis));
}
async function init() {
  await window.thermalReplay.ready;
  const response=await fetch('./data/topology.json');if(!response.ok)throw Error('Failed to load topology file');
  topology=await response.json();nodes=buildNodeData(topology.node_order);
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(43,1,.1,120);camera.position.set(11,9,12);
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
  renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','3D data center. Use arrow keys to rotate, plus/minus to zoom, and Home to reset; use the selectors below to locate any monitoring node.');
  $('#twin-canvas').appendChild(renderer.domElement);
  controls=new OrbitControls(camera,renderer.domElement);controls.target.set(.5,.5,0);controls.enableDamping=true;controls.dampingFactor=.12;
  controls.minDistance=2.2;controls.maxDistance=35;controls.maxPolarAngle=Math.PI*.485;controls.minPolarAngle=.02;controls.update();
  addRoom();addRacks();addGraph();wireInteraction();
  window.addEventListener('thermal:replay-frame',applyFrame);
  const values=nodes.map(n=>n.temperature);$('#twin-temp-range').textContent=Math.min(...values).toFixed(1)+'–'+Math.max(...values).toFixed(1)+' °C';
  const observer=new ResizeObserver(()=>{const w=$('#twin-stage').clientWidth,h=$('#twin-stage').clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);if(!rendered)setPose('overview');});
  observer.observe($('#twin-stage'));
  applyFrame();
  function animate(){
    requestAnimationFrame(animate);
    if(document.hidden||!$('#view-spatial').classList.contains('active'))return;
    if(poseTarget){camera.position.lerp(poseTarget.position,.13);controls.target.lerp(poseTarget.target,.13);if(camera.position.distanceTo(poseTarget.position)<.005)poseTarget=null;}
    controls.update();renderer.render(scene,camera);updateLabels();rendered=true;
  }
  animate();$('#twin-loading').hidden=true;
  // Read-only state enables transparent verification and future real-data integration.
  window.thermalTwin={getSnapshot:()=>({field:view.field,horizon:60,selected:nodes[view.selected].id,nodeCount:nodes.length,rackCount:12,edgeCount:topology.edge_count,edgesVisible:view.edges,shellVisible:view.shell,dataMode:'historical_replay',temperatures:nodes.map(n=>n.temperature),risks:nodes.map(n=>probability(n,60)),colors:panelMeshes.map(m=>m.material.color.getHexString()),positions:nodes.map(n=>n.position.toArray()),camera:camera.position.toArray()}),getSelection:()=>{const n=nodes[view.selected],risk=riskSummary(n,60);return {...n,risk:risk?.probability*100,intervalLower:risk?.lower,intervalUpper:risk?.upper,referenceLower:risk?.referenceLower,referenceUpper:risk?.referenceUpper,riskSampleCount:risk?.sampleCount,riskCurve:Array.from({length:60},(_,h)=>riskSummary(n,h+1)?.probability*100),observationEvidence:observationEvidence(n),field:view.field,horizon:60,mode:'replay',origin:archive().packet.origins[archive().index],targetTime:archive().packet.observationTimes[archive().packet.originOffsets[archive().index]+60],prediction:archive().packet.prediction[archive().index][59][view.selected]}},getTopRisks:(limit=4)=>nodes.map(n=>{const r=riskSummary(n,60);return {...n,risk:r?.probability*100,prediction:r?.prediction,intervalLower:r?.lower,intervalUpper:r?.upper,referenceLower:r?.referenceLower,referenceUpper:r?.referenceUpper,riskSampleCount:r?.sampleCount,riskCurve:Array.from({length:60},(_,h)=>riskSummary(n,h+1)?.probability*100),origin:archive().packet.origins[archive().index],targetTime:archive().packet.observationTimes[archive().packet.originOffsets[archive().index]+60]}}).sort((a,b)=>(b.risk??-1)-(a.risk??-1)).slice(0,limit).map(n=>({...n,observationEvidence:observationEvidence(n)})),exportImage:()=>{
    renderer.render(scene,camera);const canvas=document.createElement('canvas');canvas.width=renderer.domElement.width;canvas.height=renderer.domElement.height+100;const ctx=canvas.getContext('2d');ctx.fillStyle='#101d30';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(renderer.domElement,0,0);ctx.fillStyle='#e1ecfa';ctx.font='20px Arial';ctx.fillText((isArchive()?'TDC2.0 archived data '+archive().packet.origins[archive().index]:'synthetic example')+' · '+(view.field==='temperature'?'Temperature / °C':'Risk layer')+' · h='+view.horizon+' min',24,canvas.height-64);ctx.font='16px Arial';ctx.fillText('Structural mapping, not survey dimensions; '+(isArchive()&&view.field==='risk'?'gray denotes unavailable node probability':'colored blocks represent monitoring nodes, not CFD interpolation'),24,canvas.height-30);const a=document.createElement('a');a.download='thermalgraph-'+view.field+'.png';a.href=canvas.toDataURL('image/png');a.click();
  }};
  setTimeout(()=>selectNode(view.selected,false),0);
}
init().catch(error=>{console.error(error);$('#twin-loading').textContent='The 3D scene could not be loaded. Enable browser hardware acceleration and refresh the page. If the problem persists, verify WebGL 2 support.';});
