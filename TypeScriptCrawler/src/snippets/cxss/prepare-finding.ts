/**
 * Convert sink string representation to id for the exploit generator.
 * 
 * @param sink String representation of sink
 * @returns 
 */
const sinkToId = (sink: string) => {
    switch (sink) {
        case "eval": return 1;
        case "document.write": return 2;
        case "innerHTML": return 3;
        case "iframe.src": return 4;
        case "script.src": return 8;
        default: return -1;
    }
}

interface PreparedFinding {
    finding_id: number;
    sink_id: number;
    sources: PreparedSource[];
    url: string;
    storage: any;
    value: string;
    d1: string;
    d2: string;
    d3: string;
}

interface PreparedSource {
    finding_id: number;
    id: number;
    source: number;
    start: number;
    end: number;
    value_part: string;
    source_name: string;
    hasEscaping: number;
    hasEncodingURI: number;
    hasEncodingURIComponent: number;
}

/**
 * Convert finding (taint flow) information for usage by exploit generator.
 * 
 * @param findingId Id of finding
 * @param sinkId Id of sink
 * @param sources Sources of finding
 * @param url Url of finding
 * @param storage Storage related to finding
 * @param value Finding value
 * @param d1 D1 
 * @param d2 D2
 * @param d3 Script location
 * @returns 
 */
const prepareFinding = (findingId: number, sinkId: number, sources: any, url: string, storage: any, value: string, d1: string, d2: string, d3: string) => {
    const modified: PreparedFinding = {
        finding_id: findingId,
        sink_id: sinkId,
        sources: sources,
        url: url,
        storage: storage,
        value: value,
        d1: d1,
        d2: d2,
        d3: d3
    }

    return modified;
}

export { prepareFinding, sinkToId };