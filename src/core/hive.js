import { isInactive } from './players.js';
import { APP } from './state.js';

// ====== HIVE-AUFSTELLUNG ======
// Aus allen aktiven Spielern entsteht ein geschlossenes Rechteck um das Allianzzentrum:
// MG in der Mitte, R5/R4 im Innenring, nach außen absteigende Heldenkraft.
// Eingabe ist nur die Koordinate des Zentrums — der Rest ergibt sich aus den Spielerdaten.
export const HIVE_STEP=3;                       // Kantenlänge einer Basis auf der Weltkarte
export const HIVE_C={MG:'#e8722a',R5:'#d452c8',R4:'#a8e08a',R3:'#e5d3f2',free:'#cfe9f8'};
export function hivePower(p){return p.hero_power||0;}
export function hiveIsLead(p){return p.role==='R4'||p.role==='R5';}

// Zellen eines Rings, am Rechteck beschnitten und nach Himmelsrichtung gruppiert.
// Die Beschneidung ist genau das, was aus den Ringen am Ende eine gerade Kante macht:
// der äußerste Ring passt nicht mehr ringsum ins Rechteck, sondern nur noch auf die
// Seiten, die noch Platz haben. Ecken zählen zu N bzw. S.
export function hiveRing(r,box){
  const s={N:[],O:[],S:[],W:[]};
  for(let dy=r;dy>=-r;dy--)for(let dx=-r;dx<=r;dx++){
    if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
    if(dx<-box.left||dx>box.right||dy<-box.down||dy>box.up)continue;
    const c={dx,dy};
    if(dy===r)s.N.push(c);else if(dy===-r)s.S.push(c);
    else if(dx===r)s.O.push(c);else s.W.push(c);
  }
  // Von der Seitenmitte nach außen sortieren, damit die Verteilung mittig beginnt.
  ['N','O','S','W'].forEach(k=>s[k].sort((a,b)=>
    (k==='N'||k==='S')?Math.abs(a.dx)-Math.abs(b.dx):Math.abs(a.dy)-Math.abs(b.dy)));
  return s;
}
// Reihenfolge, in der die Plätze vergeben werden: R5, dann R4 nach Kraft — die Führung
// sitzt geschlossen um das Zentrum —, danach alle übrigen absteigend nach Heldenkraft.
export function hiveQueue(){
  const act=APP.data.players.filter(p=>!isInactive(p.name));
  const leaders=act.filter(hiveIsLead).sort((a,b)=>
    (a.role==='R5'?0:1)-(b.role==='R5'?0:1)||hivePower(b)-hivePower(a));
  return leaders.concat(act.filter(p=>!hiveIsLead(p)).sort((a,b)=>hivePower(b)-hivePower(a)));
}
// Aus Spaltenzahl/Reihenzahl die Ausdehnung um das Zentrum. Bei gerader Anzahl lässt sich
// das Zentrum nicht exakt mittig setzen — dann liegt die überzählige Spalte rechts und
// die überzählige Reihe oben.
export function hiveBox(cols,rows){
  const box={left:Math.floor((cols-1)/2),up:Math.ceil((rows-1)/2)};
  box.right=cols-1-box.left;box.down=rows-1-box.up;
  return box;
}
// Baut den Hive in ein *vorgegebenes* Rechteck. Passen nicht alle Spieler hinein,
// bleiben die schwächsten übrig — sie werden gezählt, nicht heimlich verworfen.
export function hiveBuildBox(box,cx,cy){
  const queue=hiveQueue();
  const cols=box.left+box.right+1,rows=box.up+box.down+1;
  const key=(dx,dy)=>dx+'|'+dy;
  const grid={};
  grid[key(0,0)]={name:'MG',role:'MG',power:null,ring:0};
  let i=0;
  const maxR=Math.max(box.left,box.right,box.up,box.down);
  for(let r=1;r<=maxR&&i<queue.length;r++){
    const s=hiveRing(r,box),order=['N','O','S','W'],idx={N:0,O:0,S:0,W:0};
    const cap=s.N.length+s.O.length+s.S.length+s.W.length;
    let turn=0;
    for(let n=0;n<cap&&i<queue.length;n++){
      // Reihum auf die vier Flanken: sonst bekäme jeder Ring eine starke und eine
      // schwache Seite, weil die Liste absteigend abgearbeitet wird.
      let k=null;
      for(let t=0;t<4;t++){const cand=order[turn++%4];if(idx[cand]<s[cand].length){k=cand;break;}}
      if(!k)break;
      const c=s[k][idx[k]++],p=queue[i++];
      grid[key(c.dx,c.dy)]={name:p.name,role:p.role||'R3',power:p.hero_power||null,ring:r};
    }
  }
  const cells=[];
  for(let dy=box.up;dy>=-box.down;dy--)for(let dx=-box.left;dx<=box.right;dx++){
    const g=grid[key(dx,dy)];
    cells.push({x:cx+HIVE_STEP*dx,y:cy+HIVE_STEP*dy,...(g||{name:'',role:'free',power:null,ring:null})});
  }
  return {cells,cols,rows,cx,cy,placed:i,free:cols*rows-1-i,
    rest:queue.slice(i),                                   // passten nicht mehr hinein
    x1:cx-HIVE_STEP*box.left,x2:cx+HIVE_STEP*box.right,
    y1:cy-HIVE_STEP*box.down,y2:cy+HIVE_STEP*box.up};
}
// Modus „Zentrum": nur die Mitte ist vorgegeben, das Rechteck wächst nach Spielerzahl.
export function hiveBuild(cx,cy){
  const need=hiveQueue().length+1;                          // +1 für das Zentrum selbst
  const cols=Math.max(1,Math.ceil(Math.sqrt(need)));
  const rows=Math.max(1,Math.ceil(need/cols));
  return hiveBuildBox(hiveBox(cols,rows),cx,cy);
}
// Modus „Bereich": zwei gegenüberliegende Ecken geben das Rechteck vor, das Zentrum
// setzt sich in dessen Mitte. Die Ecken dürfen in beliebiger Reihenfolge kommen.
// Nicht durch HIVE_STEP teilbare Kantenlängen werden abgerundet — eine angefangene
// Zelle gibt es auf der Weltkarte nicht.
export function hiveBuildArea(ax,ay,bx,by){
  const cols=Math.floor(Math.abs(bx-ax)/HIVE_STEP)+1;
  const rows=Math.floor(Math.abs(by-ay)/HIVE_STEP)+1;
  const box=hiveBox(cols,rows);
  return hiveBuildBox(box,Math.min(ax,bx)+HIVE_STEP*box.left,Math.min(ay,by)+HIVE_STEP*box.down);
}
// Canvas wird aus dem Modell gezeichnet, nicht aus dem DOM — so sieht das PNG auf
// jedem Gerät gleich aus, unabhängig von der Breite der Vorschau.
