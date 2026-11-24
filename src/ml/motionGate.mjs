/** Robust body-relative hand-centroid excursion. Missing hands remain unobserved. */
export function motionSpan(input) {
  return Math.max(...[0,64].map(offset=>{
    const centers=input.vectors.filter(v=>v[offset]).map(v=>[0,1].map(k=>{
      let sum=0;for(let j=0;j<21;j++)sum+=v[offset+1+3*j+k];return sum/21;
    }));
    if(centers.length<4)return 0;
    return Math.hypot(...[0,1].map(k=>{
      const sorted=centers.map(c=>c[k]).sort((a,b)=>a-b);
      return sorted[Math.floor((sorted.length-1)*.9)]-sorted[Math.floor((sorted.length-1)*.1)];
    }));
  }));
}

export function referenceMotionFloor(references) {
  return references.length ? Math.max(0,Math.min(...references.map(motionSpan))*.5) : 0;
}
