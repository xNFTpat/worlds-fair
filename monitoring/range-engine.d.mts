export interface RangeSettings { wallets:string[]; defaultGraceMinutes:number; maxDataAgeMinutes:number; pools?:Record<string,{graceMinutes:number;enabled?:boolean}> }
export interface RangeEvent { kind:string; at:string; wallet:string; pair?:string; positionId?:string; poolAddress?:string; chain?:string; [key:string]:any }
export interface RangeState { version:number; wallets:Record<string,any>; positions:Record<string,any>; episodes?:Record<string,any>; lastCheckedAt?:string }
export function validateSettings(value:unknown):RangeSettings;
export function checkRanges(payload:unknown,previous:RangeState|null|undefined,settings:RangeSettings,now?:number):{state:RangeState;events:RangeEvent[]};
