import type {Env} from './env';
import {BUILD_VERSION} from './build-version';
export async function versionInfo(env:Env){
 const metadata=env.CF_VERSION_METADATA,id=metadata?.id??null;
 const receipt=id?await env.LP_CACHE.get<{versionId:string;sourceSha:string;deployedAt:string}>('deploy:version:'+id,'json'):null;
 const deployedAt=receipt&&receipt.versionId===id&&receipt.sourceSha===BUILD_VERSION.sourceSha&&Number.isFinite(Date.parse(receipt.deployedAt))?receipt.deployedAt:null;
 return {...BUILD_VERSION,sourceHash:BUILD_VERSION.sourceSha,workerVersionId:id,versionCreatedAt:metadata?.timestamp??null,deployedAt,deployTime:deployedAt,identitySource:BUILD_VERSION.gitSha?'git-and-source':'source-hash',deploymentTimeNote:deployedAt?'Recorded after successful deployment.':'Deployment activation time is not recorded; versionCreatedAt is Cloudflare version creation time.'};
}
