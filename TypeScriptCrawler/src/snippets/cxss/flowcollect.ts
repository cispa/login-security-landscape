import { sourceToId } from "./sources";

const getRandomInt = (max: number) => {
    return Math.floor(Math.random() * max);
}

const flowcollect = (flow: any) => {
    var finding_id = getRandomInt(Number.MAX_SAFE_INTEGER);

    if (!flow.detail) {
        return undefined;
    }

    var finding: Finding = {
        finding_id: finding_id,
        sink: flow.detail.sink,
        sources: [],
        url: flow.detail.loc,
        trace: flow.detail.trace,
        storage: flow.storage,
        value: "",
        d1: "",
        d2: "",
        d3: `${flow.detail.stack.source}:${flow.detail.stack.line}:${flow.detail.stack.column}`,
        taintReportJson: ""
    }

    finding.value = flow.detail.str;

    try {
        if (typeof flow.detail.taint === "string") {
            flow.detail.taint = JSON.parse(flow.detail.taint)
        }
    } catch (err: any) {
        console.log(err);
        return undefined;
    }

    flow.detail.taint.forEach((element: any) => {
        let start = element.begin;
        let end = element.end;

        var taint = element.flow.pop();

        var parentFlow = element.flow.pop();
        var hasEscaping = 0;
        var hasEncodingURI = 0;
        var hasEncodingURIComponent = 0;

        while (parentFlow && parentFlow.operation && (parentFlow.operation !== flow.detail.sink)) {
            if (parentFlow.operation === "encodeURI") {
                hasEncodingURI = 1;
            }
            if (parentFlow.operation === "encodeURIComponent") {
                hasEncodingURIComponent = 1;
            }
            if (parentFlow.operation === "escape") {
                hasEscaping = 1;
            }
            parentFlow = element.flow.pop();
        }

        var source: Source = {
            id: 0,
            finding_id: finding_id,
            start,
            end,
            source: sourceToId(taint.operation),
            source_name: taint.operation,
            value_part: flow.detail.str.slice(start, end),
            hasEscaping: hasEscaping,
            hasEncodingURI: hasEncodingURI,
            hasEncodingURIComponent: hasEncodingURIComponent,
        }

        finding.sources.push(source);
    });

    return finding;
}

interface Finding {
    finding_id: number;
    sink: string;
    sources: Source[];
    url: string;
    storage: any;
    value: string;
    d1: string;
    d2: string;
    d3: string;
    trace: string;
    taintReportJson: string;
}

interface Source {
    finding_id: number;
    end: number;
    hasEncodingURI: number;
    source: number;
    hasEscaping: number;
    start: number;
    value_part: string;
    source_name: string;
    hasEncodingURIComponent: number;
    id: number;
}

export { flowcollect };