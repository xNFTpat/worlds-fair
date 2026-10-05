import {LAB_RULES} from './paper-lab';
export function downsideBins(active:number,step:number,down:number,solX:boolean,offset=0){
  if(!Number.isInteger(active)||!Number.isFinite(step)||step<=0||!Number.isFinite(down)||down<=0||down>=1||!Number.isFinite(offset)||offset<0||offset>=down)throw Error('Invalid downside range');
  const steps=Math.ceil(-Math.log(1-down)/Math.log(1+step/10000));
  const near=Math.max(1,Math.ceil(-Math.log(1-offset)/Math.log(1+step/10000)));
  const lower=solX?active+near:active-steps,upper=solX?active+steps:active-near;
  if(upper-lower+1>LAB_RULES.maxBins)throw Error(`Downside range needs ${upper-lower+1} bins; lab read limit is ${LAB_RULES.maxBins}`);
  return {lower,upper};
}
export {transferNet} from './paper-token-math';
