export namespace awsflow {
	
	export class Identity {
	    account: string;
	    arn: string;
	    userId: string;
	    profile: string;
	    region: string;
	
	    static createFrom(source: any = {}) {
	        return new Identity(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.account = source["account"];
	        this.arn = source["arn"];
	        this.userId = source["userId"];
	        this.profile = source["profile"];
	        this.region = source["region"];
	    }
	}
	export class Infra {
	    queueUrl: string;
	    queueName: string;
	    queueArn: string;
	    ruleName: string;
	    ruleArn: string;
	    region: string;
	    account: string;
	    allManagement: boolean;
	    owned: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Infra(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.queueUrl = source["queueUrl"];
	        this.queueName = source["queueName"];
	        this.queueArn = source["queueArn"];
	        this.ruleName = source["ruleName"];
	        this.ruleArn = source["ruleArn"];
	        this.region = source["region"];
	        this.account = source["account"];
	        this.allManagement = source["allManagement"];
	        this.owned = source["owned"];
	    }
	}
	export class Profile {
	    name: string;
	    kind: string;
	    region: string;
	
	    static createFrom(source: any = {}) {
	        return new Profile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.region = source["region"];
	    }
	}
	export class TrailStatus {
	    hasLoggingTrail: boolean;
	    trailCount: number;
	    globalCovered: boolean;
	    readManagement: boolean;
	    writeManagement: boolean;
	    coverageKnown: boolean;
	    coverageComplete: boolean;
	    summary: string;
	
	    static createFrom(source: any = {}) {
	        return new TrailStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hasLoggingTrail = source["hasLoggingTrail"];
	        this.trailCount = source["trailCount"];
	        this.globalCovered = source["globalCovered"];
	        this.readManagement = source["readManagement"];
	        this.writeManagement = source["writeManagement"];
	        this.coverageKnown = source["coverageKnown"];
	        this.coverageComplete = source["coverageComplete"];
	        this.summary = source["summary"];
	    }
	}

}

export namespace capture {
	
	export class Session {
	    version: number;
	    phase: string;
	    config: config.ConnectionConfig;
	    infra: awsflow.Infra;
	
	    static createFrom(source: any = {}) {
	        return new Session(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.phase = source["phase"];
	        this.config = this.convertValues(source["config"], config.ConnectionConfig);
	        this.infra = this.convertValues(source["infra"], awsflow.Infra);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace config {
	
	export class ConnectionConfig {
	    mode: string;
	    region: string;
	    profile: string;
	    queueUrl: string;
	    ruleArn: string;
	    dumpPath: string;
	    capturePattern: string;
	    writeOnly: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.region = source["region"];
	        this.profile = source["profile"];
	        this.queueUrl = source["queueUrl"];
	        this.ruleArn = source["ruleArn"];
	        this.dumpPath = source["dumpPath"];
	        this.capturePattern = source["capturePattern"];
	        this.writeOnly = source["writeOnly"];
	    }
	}
	export class RequiredPermission {
	    action: string;
	    reason: string;
	
	    static createFrom(source: any = {}) {
	        return new RequiredPermission(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.action = source["action"];
	        this.reason = source["reason"];
	    }
	}

}

export namespace main {
	
	export class FilteredExport {
	    path: string;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new FilteredExport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.count = source["count"];
	    }
	}
	export class InvestigationExport {
	    path: string;
	    eventCount: number;
	    totalMatches: number;
	    observationCount: number;
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new InvestigationExport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.eventCount = source["eventCount"];
	        this.totalMatches = source["totalMatches"];
	        this.observationCount = source["observationCount"];
	        this.truncated = source["truncated"];
	    }
	}
	export class RecoveryState {
	    evidence: store.EvidenceStats;
	    capture?: capture.Session;
	    captureError: string;
	    active: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RecoveryState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.evidence = this.convertValues(source["evidence"], store.EvidenceStats);
	        this.capture = this.convertValues(source["capture"], capture.Session);
	        this.captureError = source["captureError"];
	        this.active = source["active"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace model {
	
	export class UserIdentity {
	    type: string;
	    principalId: string;
	    arn: string;
	    accountId: string;
	    userName: string;
	
	    static createFrom(source: any = {}) {
	        return new UserIdentity(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.principalId = source["principalId"];
	        this.arn = source["arn"];
	        this.accountId = source["accountId"];
	        this.userName = source["userName"];
	    }
	}
	export class CloudTrailEvent {
	    seq: number;
	    eventID: string;
	    eventTime: string;
	    eventName: string;
	    eventSource: string;
	    awsRegion: string;
	    sourceIPAddress: string;
	    userAgent: string;
	    userIdentity: UserIdentity;
	    readOnly: boolean;
	    managementEvent: boolean;
	    errorCode?: string;
	    errorMessage?: string;
	    recipientAccountId: string;
	    rawJSON: string;
	
	    static createFrom(source: any = {}) {
	        return new CloudTrailEvent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.seq = source["seq"];
	        this.eventID = source["eventID"];
	        this.eventTime = source["eventTime"];
	        this.eventName = source["eventName"];
	        this.eventSource = source["eventSource"];
	        this.awsRegion = source["awsRegion"];
	        this.sourceIPAddress = source["sourceIPAddress"];
	        this.userAgent = source["userAgent"];
	        this.userIdentity = this.convertValues(source["userIdentity"], UserIdentity);
	        this.readOnly = source["readOnly"];
	        this.managementEvent = source["managementEvent"];
	        this.errorCode = source["errorCode"];
	        this.errorMessage = source["errorMessage"];
	        this.recipientAccountId = source["recipientAccountId"];
	        this.rawJSON = source["rawJSON"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace store {
	
	export class Row {
	    seq: number;
	    eventID: string;
	    eventTime: string;
	    eventName: string;
	    eventSource: string;
	    awsRegion: string;
	    sourceIPAddress: string;
	    userAgent: string;
	    identityType: string;
	    identityArn: string;
	    userName: string;
	    accountId: string;
	    principalId: string;
	    roleArn: string;
	    sessionName: string;
	    errorCode: string;
	    errorMessage: string;
	    recipientAccountId: string;
	    readOnly: boolean;
	    managementEvent: boolean;
	    rawJSON: string;
	    target: string;
	
	    static createFrom(source: any = {}) {
	        return new Row(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.seq = source["seq"];
	        this.eventID = source["eventID"];
	        this.eventTime = source["eventTime"];
	        this.eventName = source["eventName"];
	        this.eventSource = source["eventSource"];
	        this.awsRegion = source["awsRegion"];
	        this.sourceIPAddress = source["sourceIPAddress"];
	        this.userAgent = source["userAgent"];
	        this.identityType = source["identityType"];
	        this.identityArn = source["identityArn"];
	        this.userName = source["userName"];
	        this.accountId = source["accountId"];
	        this.principalId = source["principalId"];
	        this.roleArn = source["roleArn"];
	        this.sessionName = source["sessionName"];
	        this.errorCode = source["errorCode"];
	        this.errorMessage = source["errorMessage"];
	        this.recipientAccountId = source["recipientAccountId"];
	        this.readOnly = source["readOnly"];
	        this.managementEvent = source["managementEvent"];
	        this.rawJSON = source["rawJSON"];
	        this.target = source["target"];
	    }
	}
	export class ActivityGroup {
	    value: string;
	    current: number;
	    previous: number;
	    errors: number;
	    writes: number;
	    totalGroups: number;
	
	    static createFrom(source: any = {}) {
	        return new ActivityGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.value = source["value"];
	        this.current = source["current"];
	        this.previous = source["previous"];
	        this.errors = source["errors"];
	        this.writes = source["writes"];
	        this.totalGroups = source["totalGroups"];
	    }
	}
	export class ActivityStats {
	    events: number;
	    errors: number;
	    writes: number;
	    unknownReadOnly: number;
	    credentialIDs: number;
	    invalidTimes: number;
	    firstMs?: number;
	    lastMs?: number;
	
	    static createFrom(source: any = {}) {
	        return new ActivityStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.events = source["events"];
	        this.errors = source["errors"];
	        this.writes = source["writes"];
	        this.unknownReadOnly = source["unknownReadOnly"];
	        this.credentialIDs = source["credentialIDs"];
	        this.invalidTimes = source["invalidTimes"];
	        this.firstMs = source["firstMs"];
	        this.lastMs = source["lastMs"];
	    }
	}
	export class Snapshot {
	    generation: string;
	    maxSeq: number;
	    capturedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Snapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.generation = source["generation"];
	        this.maxSeq = source["maxSeq"];
	        this.capturedAt = source["capturedAt"];
	    }
	}
	export class ActivityAnalysis {
	    snapshot: Snapshot;
	    scope: ActivityStats;
	    current: ActivityStats;
	    previous: ActivityStats;
	    groups: ActivityGroup[];
	    totalGroups: number;
	    limit: number;
	    fromMs: number;
	    toMs: number;
	    previousFromMs: number;
	    hasWindow: boolean;
	    breakdowns: Record<string, Array<ActivityGroup>>;
	    events: Row[];
	    notes: string[];
	
	    static createFrom(source: any = {}) {
	        return new ActivityAnalysis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.snapshot = this.convertValues(source["snapshot"], Snapshot);
	        this.scope = this.convertValues(source["scope"], ActivityStats);
	        this.current = this.convertValues(source["current"], ActivityStats);
	        this.previous = this.convertValues(source["previous"], ActivityStats);
	        this.groups = this.convertValues(source["groups"], ActivityGroup);
	        this.totalGroups = source["totalGroups"];
	        this.limit = source["limit"];
	        this.fromMs = source["fromMs"];
	        this.toMs = source["toMs"];
	        this.previousFromMs = source["previousFromMs"];
	        this.hasWindow = source["hasWindow"];
	        this.breakdowns = this.convertValues(source["breakdowns"], Array<ActivityGroup>, true);
	        this.events = this.convertValues(source["events"], Row);
	        this.notes = source["notes"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class Bucket {
	    t: number;
	    n: number;
	    e: number;
	
	    static createFrom(source: any = {}) {
	        return new Bucket(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.t = source["t"];
	        this.n = source["n"];
	        this.e = source["e"];
	    }
	}
	export class FacetMetadata {
	    totalEvents: number;
	    presentEvents: number;
	    missingEvents: number;
	    distinctValues: number;
	    returnedValues: number;
	    limit: number;
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FacetMetadata(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.totalEvents = source["totalEvents"];
	        this.presentEvents = source["presentEvents"];
	        this.missingEvents = source["missingEvents"];
	        this.distinctValues = source["distinctValues"];
	        this.returnedValues = source["returnedValues"];
	        this.limit = source["limit"];
	        this.truncated = source["truncated"];
	    }
	}
	export class Stats {
	    errors: number;
	    principals: number;
	    sources: number;
	    regions: number;
	    minMs: number;
	    maxMs: number;
	
	    static createFrom(source: any = {}) {
	        return new Stats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.errors = source["errors"];
	        this.principals = source["principals"];
	        this.sources = source["sources"];
	        this.regions = source["regions"];
	        this.minMs = source["minMs"];
	        this.maxMs = source["maxMs"];
	    }
	}
	export class Aggregates {
	    snapshot?: Snapshot;
	    total: number;
	    stats: Stats;
	    facets: Record<string, Array<FacetValue>>;
	    facetMetadata: Record<string, FacetMetadata>;
	    histogram: Bucket[];
	    histStep: number;
	    histFrom: number;
	    histTo: number;
	
	    static createFrom(source: any = {}) {
	        return new Aggregates(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.snapshot = this.convertValues(source["snapshot"], Snapshot);
	        this.total = source["total"];
	        this.stats = this.convertValues(source["stats"], Stats);
	        this.facets = this.convertValues(source["facets"], Array<FacetValue>, true);
	        this.facetMetadata = this.convertValues(source["facetMetadata"], FacetMetadata, true);
	        this.histogram = this.convertValues(source["histogram"], Bucket);
	        this.histStep = source["histStep"];
	        this.histFrom = source["histFrom"];
	        this.histTo = source["histTo"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AnalysisEntity {
	    dimension: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new AnalysisEntity(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dimension = source["dimension"];
	        this.value = source["value"];
	    }
	}
	export class Expr {
	    t: string;
	    nodes?: Expr[];
	    node?: Expr;
	    field?: string;
	    op?: string;
	    value?: string;
	    regex?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Expr(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.t = source["t"];
	        this.nodes = this.convertValues(source["nodes"], Expr);
	        this.node = this.convertValues(source["node"], Expr);
	        this.field = source["field"];
	        this.op = source["op"];
	        this.value = source["value"];
	        this.regex = source["regex"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Filter {
	    includes: Record<string, Array<string>>;
	    excludes: Record<string, Array<string>>;
	    exists: string[];
	    matchNone: boolean;
	    errorsOnly: boolean;
	    hideReadOnly: boolean;
	    fromMs: number;
	    toMs: number;
	    text: string;
	    expr?: Expr;
	
	    static createFrom(source: any = {}) {
	        return new Filter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.includes = source["includes"];
	        this.excludes = source["excludes"];
	        this.exists = source["exists"];
	        this.matchNone = source["matchNone"];
	        this.errorsOnly = source["errorsOnly"];
	        this.hideReadOnly = source["hideReadOnly"];
	        this.fromMs = source["fromMs"];
	        this.toMs = source["toMs"];
	        this.text = source["text"];
	        this.expr = this.convertValues(source["expr"], Expr);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AnalysisOptions {
	    filter: Filter;
	    dimension: string;
	    compare: boolean;
	    windowHours: number;
	    entity?: AnalysisEntity;
	    snapshot?: Snapshot;
	
	    static createFrom(source: any = {}) {
	        return new AnalysisOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filter = this.convertValues(source["filter"], Filter);
	        this.dimension = source["dimension"];
	        this.compare = source["compare"];
	        this.windowHours = source["windowHours"];
	        this.entity = this.convertValues(source["entity"], AnalysisEntity);
	        this.snapshot = this.convertValues(source["snapshot"], Snapshot);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class CorrelationReason {
	    kind: string;
	    label: string;
	    value?: string;
	
	    static createFrom(source: any = {}) {
	        return new CorrelationReason(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.label = source["label"];
	        this.value = source["value"];
	    }
	}
	export class SourceEvidence {
	    id: number;
	    sha256: string;
	    source: string;
	    ordinal: number;
	    format: string;
	    lossy: boolean;
	    observedAt: string;
	    displayed: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SourceEvidence(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sha256 = source["sha256"];
	        this.source = source["source"];
	        this.ordinal = source["ordinal"];
	        this.format = source["format"];
	        this.lossy = source["lossy"];
	        this.observedAt = source["observedAt"];
	        this.displayed = source["displayed"];
	    }
	}
	export class EvidencePage {
	    total: number;
	    variants: number;
	    observations: SourceEvidence[];
	
	    static createFrom(source: any = {}) {
	        return new EvidencePage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.variants = source["variants"];
	        this.observations = this.convertValues(source["observations"], SourceEvidence);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class EvidenceStats {
	    events: number;
	    observations: number;
	    variantEvents: number;
	    lossy: number;
	
	    static createFrom(source: any = {}) {
	        return new EvidenceStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.events = source["events"];
	        this.observations = source["observations"];
	        this.variantEvents = source["variantEvents"];
	        this.lossy = source["lossy"];
	    }
	}
	
	
	export class FacetValue {
	    value: string;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new FacetValue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.value = source["value"];
	        this.count = source["count"];
	    }
	}
	
	export class GraphEdge {
	    parent: string;
	    child: string;
	    viaSeq: number;
	    viaEvent: string;
	    viaTime: string;
	    viaIP: string;
	    evidence?: string;
	    evidenceSeqs?: number[];
	    crossAccount?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new GraphEdge(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.parent = source["parent"];
	        this.child = source["child"];
	        this.viaSeq = source["viaSeq"];
	        this.viaEvent = source["viaEvent"];
	        this.viaTime = source["viaTime"];
	        this.viaIP = source["viaIP"];
	        this.evidence = source["evidence"];
	        this.evidenceSeqs = source["evidenceSeqs"];
	        this.crossAccount = source["crossAccount"];
	    }
	}
	export class GraphNode {
	    id: string;
	    kind: string;
	    identityType: string;
	    arn: string;
	    roleArn: string;
	    roleName: string;
	    userName: string;
	    sessionName: string;
	    accountId: string;
	    accessKeyId: string;
	    invokedBy: string;
	    identityNote?: string;
	    originKind?: string;
	    events: number;
	    childCount: number;
	    roleEvents?: number;
	    roleSessions?: number;
	    seq?: number;
	    eventName?: string;
	    eventSource?: string;
	    eventTime?: string;
	    errorCode?: string;
	    readOnly?: boolean;
	    resource?: string;
	
	    static createFrom(source: any = {}) {
	        return new GraphNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.kind = source["kind"];
	        this.identityType = source["identityType"];
	        this.arn = source["arn"];
	        this.roleArn = source["roleArn"];
	        this.roleName = source["roleName"];
	        this.userName = source["userName"];
	        this.sessionName = source["sessionName"];
	        this.accountId = source["accountId"];
	        this.accessKeyId = source["accessKeyId"];
	        this.invokedBy = source["invokedBy"];
	        this.identityNote = source["identityNote"];
	        this.originKind = source["originKind"];
	        this.events = source["events"];
	        this.childCount = source["childCount"];
	        this.roleEvents = source["roleEvents"];
	        this.roleSessions = source["roleSessions"];
	        this.seq = source["seq"];
	        this.eventName = source["eventName"];
	        this.eventSource = source["eventSource"];
	        this.eventTime = source["eventTime"];
	        this.errorCode = source["errorCode"];
	        this.readOnly = source["readOnly"];
	        this.resource = source["resource"];
	    }
	}
	export class HuntMatch {
	    event: Row;
	    indicators: number[];
	
	    static createFrom(source: any = {}) {
	        return new HuntMatch(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.event = this.convertValues(source["event"], Row);
	        this.indicators = source["indicators"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Indicator {
	    kind: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new Indicator(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.value = source["value"];
	    }
	}
	export class HuntOptions {
	    mode: string;
	    filter: Filter;
	    indicators: Indicator[];
	    first?: Expr;
	    second?: Expr;
	    steps: Expr[];
	    group: string;
	    minutes: number;
	    snapshot?: Snapshot;
	
	    static createFrom(source: any = {}) {
	        return new HuntOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.filter = this.convertValues(source["filter"], Filter);
	        this.indicators = this.convertValues(source["indicators"], Indicator);
	        this.first = this.convertValues(source["first"], Expr);
	        this.second = this.convertValues(source["second"], Expr);
	        this.steps = this.convertValues(source["steps"], Expr);
	        this.group = source["group"];
	        this.minutes = source["minutes"];
	        this.snapshot = this.convertValues(source["snapshot"], Snapshot);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SequenceMatch {
	    events: Row[];
	    deltaMs: number;
	    tiedCandidates: number[];
	
	    static createFrom(source: any = {}) {
	        return new SequenceMatch(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.events = this.convertValues(source["events"], Row);
	        this.deltaMs = source["deltaMs"];
	        this.tiedCandidates = source["tiedCandidates"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SequencePair {
	    first: Row;
	    second: Row;
	    deltaMs: number;
	    tiedFirst: number;
	
	    static createFrom(source: any = {}) {
	        return new SequencePair(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.first = this.convertValues(source["first"], Row);
	        this.second = this.convertValues(source["second"], Row);
	        this.deltaMs = source["deltaMs"];
	        this.tiedFirst = source["tiedFirst"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class IndicatorCount {
	    kind: string;
	    value: string;
	    matches: number;
	
	    static createFrom(source: any = {}) {
	        return new IndicatorCount(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.value = source["value"];
	        this.matches = source["matches"];
	    }
	}
	export class HuntResult {
	    snapshot: Snapshot;
	    scanned: number;
	    total: number;
	    limit: number;
	    invalidTimes: number;
	    missingPrincipal: number;
	    missingCredential: number;
	    indicators: IndicatorCount[];
	    matches: HuntMatch[];
	    pairs: SequencePair[];
	    sequences: SequenceMatch[];
	    notes: string[];
	
	    static createFrom(source: any = {}) {
	        return new HuntResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.snapshot = this.convertValues(source["snapshot"], Snapshot);
	        this.scanned = source["scanned"];
	        this.total = source["total"];
	        this.limit = source["limit"];
	        this.invalidTimes = source["invalidTimes"];
	        this.missingPrincipal = source["missingPrincipal"];
	        this.missingCredential = source["missingCredential"];
	        this.indicators = this.convertValues(source["indicators"], IndicatorCount);
	        this.matches = this.convertValues(source["matches"], HuntMatch);
	        this.pairs = this.convertValues(source["pairs"], SequencePair);
	        this.sequences = this.convertValues(source["sequences"], SequenceMatch);
	        this.notes = source["notes"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class InvestigationEvent {
	    event: Row;
	    reasons: CorrelationReason[];
	    deltaMs: number;
	
	    static createFrom(source: any = {}) {
	        return new InvestigationEvent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.event = this.convertValues(source["event"], Row);
	        this.reasons = this.convertValues(source["reasons"], CorrelationReason);
	        this.deltaMs = source["deltaMs"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ResourceReference {
	    arn: string;
	    kind: string;
	    source: string;
	
	    static createFrom(source: any = {}) {
	        return new ResourceReference(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.arn = source["arn"];
	        this.kind = source["kind"];
	        this.source = source["source"];
	    }
	}
	export class Investigation {
	    snapshot: Snapshot;
	    anchor: Row;
	    resources: ResourceReference[];
	    resourcesTruncated: boolean;
	    events: InvestigationEvent[];
	    total: number;
	    limit: number;
	    fromMs: number;
	    toMs: number;
	    notes: string[];
	
	    static createFrom(source: any = {}) {
	        return new Investigation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.snapshot = this.convertValues(source["snapshot"], Snapshot);
	        this.anchor = this.convertValues(source["anchor"], Row);
	        this.resources = this.convertValues(source["resources"], ResourceReference);
	        this.resourcesTruncated = source["resourcesTruncated"];
	        this.events = this.convertValues(source["events"], InvestigationEvent);
	        this.total = source["total"];
	        this.limit = source["limit"];
	        this.fromMs = source["fromMs"];
	        this.toMs = source["toMs"];
	        this.notes = source["notes"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class InvestigationOptions {
	    seq: number;
	    eventID: string;
	    minutes: number;
	    relation: string;
	    snapshot?: Snapshot;
	
	    static createFrom(source: any = {}) {
	        return new InvestigationOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.seq = source["seq"];
	        this.eventID = source["eventID"];
	        this.minutes = source["minutes"];
	        this.relation = source["relation"];
	        this.snapshot = this.convertValues(source["snapshot"], Snapshot);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LineageNode {
	    identityType: string;
	    arn: string;
	    userName: string;
	    accountId: string;
	    roleArn: string;
	    sessionName: string;
	    invokedBy: string;
	    viaSeq: number;
	    viaEvent: string;
	    viaTime: string;
	    viaSourceIP: string;
	    evidence: string;
	    evidenceSeqs: number[];
	
	    static createFrom(source: any = {}) {
	        return new LineageNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.identityType = source["identityType"];
	        this.arn = source["arn"];
	        this.userName = source["userName"];
	        this.accountId = source["accountId"];
	        this.roleArn = source["roleArn"];
	        this.sessionName = source["sessionName"];
	        this.invokedBy = source["invokedBy"];
	        this.viaSeq = source["viaSeq"];
	        this.viaEvent = source["viaEvent"];
	        this.viaTime = source["viaTime"];
	        this.viaSourceIP = source["viaSourceIP"];
	        this.evidence = source["evidence"];
	        this.evidenceSeqs = source["evidenceSeqs"];
	    }
	}
	export class Lineage {
	    applicable: boolean;
	    sourceIdentity: string;
	    complete: boolean;
	    status: string;
	    reason: string;
	    nodes: LineageNode[];
	
	    static createFrom(source: any = {}) {
	        return new Lineage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.applicable = source["applicable"];
	        this.sourceIdentity = source["sourceIdentity"];
	        this.complete = source["complete"];
	        this.status = source["status"];
	        this.reason = source["reason"];
	        this.nodes = this.convertValues(source["nodes"], LineageNode);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class LineageTree {
	    snapshot?: Snapshot;
	    applicable: boolean;
	    currentId: string;
	    rootId: string;
	    nodes: GraphNode[];
	    edges: GraphEdge[];
	    notes: string[];
	
	    static createFrom(source: any = {}) {
	        return new LineageTree(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.snapshot = this.convertValues(source["snapshot"], Snapshot);
	        this.applicable = source["applicable"];
	        this.currentId = source["currentId"];
	        this.rootId = source["rootId"];
	        this.nodes = this.convertValues(source["nodes"], GraphNode);
	        this.edges = this.convertValues(source["edges"], GraphEdge);
	        this.notes = source["notes"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class SearchResult {
	    aggregates: Aggregates;
	    events: Row[];
	
	    static createFrom(source: any = {}) {
	        return new SearchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.aggregates = this.convertValues(source["aggregates"], Aggregates);
	        this.events = this.convertValues(source["events"], Row);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class SigmaDiag {
	    severity: string;
	    message: string;
	    line?: number;
	
	    static createFrom(source: any = {}) {
	        return new SigmaDiag(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.severity = source["severity"];
	        this.message = source["message"];
	        this.line = source["line"];
	    }
	}
	export class SigmaResult {
	    parsed: boolean;
	    supported: boolean;
	    title: string;
	    diagnostics: SigmaDiag[];
	    sql: string;
	    matches: number;
	    scanned: number;
	    rows: Row[];
	    snapshot?: Snapshot;
	    explanations: Record<number, Array<SigmaSelection>>;
	
	    static createFrom(source: any = {}) {
	        return new SigmaResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.parsed = source["parsed"];
	        this.supported = source["supported"];
	        this.title = source["title"];
	        this.diagnostics = this.convertValues(source["diagnostics"], SigmaDiag);
	        this.sql = source["sql"];
	        this.matches = source["matches"];
	        this.scanned = source["scanned"];
	        this.rows = this.convertValues(source["rows"], Row);
	        this.snapshot = this.convertValues(source["snapshot"], Snapshot);
	        this.explanations = this.convertValues(source["explanations"], Array<SigmaSelection>, true);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SigmaRuleInput {
	    name: string;
	    yaml: string;
	
	    static createFrom(source: any = {}) {
	        return new SigmaRuleInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.yaml = source["yaml"];
	    }
	}
	export class SigmaSelection {
	    name: string;
	    matched: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SigmaSelection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.matched = source["matched"];
	    }
	}
	export class SigmaSuiteEntry {
	    name: string;
	    result: SigmaResult;
	
	    static createFrom(source: any = {}) {
	        return new SigmaSuiteEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.result = this.convertValues(source["result"], SigmaResult);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SigmaSuiteResult {
	    snapshot: Snapshot;
	    results: SigmaSuiteEntry[];
	
	    static createFrom(source: any = {}) {
	        return new SigmaSuiteResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.snapshot = this.convertValues(source["snapshot"], Snapshot);
	        this.results = this.convertValues(source["results"], SigmaSuiteEntry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	

}

