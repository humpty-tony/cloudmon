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
	    queueArn: string;
	    ruleName: string;
	    ruleArn: string;
	    region: string;
	    account: string;
	    allManagement: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Infra(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.queueUrl = source["queueUrl"];
	        this.queueArn = source["queueArn"];
	        this.ruleName = source["ruleName"];
	        this.ruleArn = source["ruleArn"];
	        this.region = source["region"];
	        this.account = source["account"];
	        this.allManagement = source["allManagement"];
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
	    summary: string;
	
	    static createFrom(source: any = {}) {
	        return new TrailStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hasLoggingTrail = source["hasLoggingTrail"];
	        this.trailCount = source["trailCount"];
	        this.globalCovered = source["globalCovered"];
	        this.summary = source["summary"];
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
	    total: number;
	    stats: Stats;
	    facets: Record<string, Array<FacetValue>>;
	    histogram: Bucket[];
	    histStep: number;
	    histFrom: number;
	    histTo: number;
	
	    static createFrom(source: any = {}) {
	        return new Aggregates(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.stats = this.convertValues(source["stats"], Stats);
	        this.facets = this.convertValues(source["facets"], Array<FacetValue>, true);
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
	export class Filter {
	    includes: Record<string, Array<string>>;
	    excludes: Record<string, Array<string>>;
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
	export class GraphEdge {
	    parent: string;
	    child: string;
	    viaSeq: number;
	    viaEvent: string;
	    viaTime: string;
	    viaIP: string;
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
	    }
	}
	export class Lineage {
	    applicable: boolean;
	    sourceIdentity: string;
	    complete: boolean;
	    nodes: LineageNode[];
	
	    static createFrom(source: any = {}) {
	        return new Lineage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.applicable = source["applicable"];
	        this.sourceIdentity = source["sourceIdentity"];
	        this.complete = source["complete"];
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

