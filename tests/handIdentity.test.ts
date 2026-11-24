import { describe, it, expect } from 'vitest';
import { createHandAssociator } from '../src/ml/handIdentity';
import { wristRecoveryRegion,restoreCropLandmarks,acceptRecoveredHand } from '../src/ml/handRecovery';
const hand = (x:number,y=.5) => Array.from({length:21},(_,i)=>({x:x+i*.001,y:y+i*.002,z:0}));
const pose = (left:number,right:number) => [
  {x:.5,y:.1,z:0},{x:.3,y:.25,z:0},{x:.7,y:.25,z:0},
  {x:left,y:.35,z:0},{x:right,y:.35,z:0},{x:left,y:.5,z:0},{x:right,y:.5,z:0},
];
describe('observed hand identity',()=>{
  it('keeps identities through crossing wrists and a reversed detector output order',()=>{
    const tracker=createHandAssociator();
    tracker.update([hand(.3),hand(.7)],[{label:'Left'},{label:'Right'}],pose(.3,.7),[1,1],0);
    tracker.update([hand(.42),hand(.58)],[{label:'Left'},{label:'Right'}],pose(.42,.58),[1,1],80);
    const left=hand(.52),right=hand(.48);
    const result=tracker.update([right,left],[{label:'Left'},{label:'Right'}],pose(.5,.5),[.4,.4],160);
    expect(result.left).toBe(left);expect(result.right).toBe(right);
  });
  it('keeps short-dropout identity without emitting a missing hand',()=>{
    const tracker=createHandAssociator(),left=hand(.3),right=hand(.7);
    tracker.update([left,right],[{label:'Left'},{label:'Right'}],pose(.3,.7),[1,1],0);
    expect(tracker.update([],[],null,[0,0],80)).toEqual({left:null,right:null});
    const result=tracker.update([left],[{label:'Right',score:.6}],null,[0,0],160);
    expect(result.left).toBe(left);expect(result.right).toBeNull();
  });
  it('expires old identity and clears it between independent streams',()=>{
    const tracker=createHandAssociator(),first=hand(.3);
    tracker.update([first],[{label:'Left'}],null,[0,0],0);
    expect(tracker.update([first],[{label:'Right'}],null,[0,0],500).right).toBe(first);
    tracker.reset();expect(tracker.update([first],[{label:'Left'}],null,[0,0],501).left).toBe(first);
  });
  it('uses an individually visible pose wrist even when the other wrist is occluded',()=>{
    const tracker=createHandAssociator(),left=hand(.3);
    expect(tracker.update([left],[{label:'Right'}],pose(.3,.8),[1,0],0).left).toBe(left);
  });
});
describe('recovery observations',()=>{
  it('keeps crops inside the image and maps x/y/z back to the original aspect',()=>{
    const region=wristRecoveryRegion(pose(.05,.8),0,640,480)!;
    expect(region.x).toBeGreaterThanOrEqual(0);expect(region.y).toBeGreaterThanOrEqual(0);
    const restored=restoreCropLandmarks(hand(.5),region,640,480)!;
    expect(restored[0].x).toBeCloseTo((region.x+.5*region.size)/640);
    expect(restored[0].y).toBeCloseTo((region.y+.5*region.size)/480);
    const depth=hand(.5).map(p=>({...p,z:.1}));
    expect(restoreCropLandmarks(depth,region,640,480)![0].z).toBeCloseTo(.1*region.size/640);
  });
  it('rejects duplicates, off-target detections, invalid points and invisible wrists',()=>{
    const region=wristRecoveryRegion(pose(.3,.8),0,640,480)!,points=hand(.3);
    expect(acceptRecoveredHand(points,region,[points],640,480)).toBe(false);
    expect(acceptRecoveredHand(hand(.95),region,[],640,480)).toBe(false);
    expect(restoreCropLandmarks([{x:NaN,y:0,z:0}],region,640,480)).toBeNull();
    expect(wristRecoveryRegion(pose(-.1,.8),0,640,480)).toBeNull();
  });
});
