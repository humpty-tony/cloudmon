import type {EvidenceSnapshot, LineageTree} from './types';

export interface FederationMapping {roleArn:string;validFrom:string;validTo:string;verifiedAt:string;note:string}
export interface AttributionConfig {
 awsProfile:string;awsRegions:string[];identityCenterRegion:string;
 entraTenantId:string;entraTokenEnv:string;entraMappings:FederationMapping[];
 vaultAddress:string;vaultTokenEnv:string;vaultAuditPath:string;vaultAuditDevice:string;
}
export const defaultAttributionConfig:AttributionConfig={awsProfile:'',awsRegions:[],identityCenterRegion:'',entraTenantId:'',entraTokenEnv:'CLOUDMON_ENTRA_TOKEN',entraMappings:[],vaultAddress:'',vaultTokenEnv:'VAULT_TOKEN',vaultAuditPath:'',vaultAuditDevice:''};
export interface Initiator {ip:string;userAgent:string;time:string;eventId:string;region:string;mfa:string}
export interface AttributionEvidence {source:string;method:string;nodeKey:string;subjectId:string;displayName:string;userName:string;email:string;description:string;observedAt:string;initiator?:Initiator}
export interface AttributionSource {source:string;status:string;detail:string;accountId:string;region:string;from:string;to:string;events:number;pages:number}
export interface AttributionRecord {id:string;raw:string;source:string;accountId:string;region:string;fetchedAt:string}
export interface AttributionResult {fetchedAt:string;sources:AttributionSource[];evidence:AttributionEvidence[];records:AttributionRecord[]}
export interface LineageAttribution {result:AttributionResult;graph:LineageTree;raw:Record<string,string>;cached:boolean}
export interface AttributionBackend {
 getAttributionSettings():Promise<AttributionConfig>;
 saveAttributionSettings(config:AttributionConfig):Promise<void>;
 getLineageAttribution(seq:number,snapshot:EvidenceSnapshot):Promise<LineageAttribution|null>;
 resolveLineageAttribution(seq:number,snapshot:EvidenceSnapshot,signal?:AbortSignal):Promise<LineageAttribution>;
}
export const sourceName=(source:string)=>({'cloudtrail':'CloudTrail','identity-center':'Identity Center','identitystore':'Identity Center','entra':'Entra ID','vault':'Vault audit','source-identity':'Recorded source identity'}[source]??source);
