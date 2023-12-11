function collectStorage() {
    var storage = {
        cookies: [],
        storage: []
    }
    if (document.cookie !== "") {
        var keyValuePairs = document.cookie.split(';');
        for (var i = 0; i < keyValuePairs.length; i++) {
            storage.cookies.push([
                keyValuePairs[i].substring(0, keyValuePairs[i].indexOf('=')),
                keyValuePairs[i].substring(keyValuePairs[i].indexOf('=') + 1),
                0
            ])
        }
    }

    // Collect local storage items
    for (var i = 0; i < localStorage.length; i++) {
        storage.storage.push([
            localStorage.key(i),
            localStorage.getItem(localStorage.key(i)),
            0
        ])
    }

    // Collect session storage
    for (var i = 0; i < sessionStorage.length; i++) {
        storage.storage.push([
            sessionStorage.key(i),
            sessionStorage.getItem(sessionStorage.key(i)),
            0
        ])
    }
    return storage;
}

function handleTaintReport(report) {
    var storage = collectStorage();

    var flow = {
        detail: {
            loc: report.detail.loc,
            str: report.detail.str,
            sink: report.detail.sink,
            taint: report.detail.str.taint,
            stack: {
                source: report.detail.stack.source,
                line: report.detail.stack.line,
                column: report.detail.stack.column
            },
            trace: report.detail.stack.toString()
        },
        storage,
        ...report
    }
    console.log("[CXSS]" + JSON.stringify(flow));
}

window.addEventListener("__taintreport", handleTaintReport);