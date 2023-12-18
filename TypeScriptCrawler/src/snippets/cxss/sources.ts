/**
 * Convert source string representation to id for consumption 
 * by exploit generator.
 * 
 * @param source Source string representation
 * @returns 
 */
const sourceToId = (source: string) => {
    switch (source) {
        case "location.href": return 1;
        case "location.pathname": return 2;
        case "location.search": return 3;
        case "location.hash": return 4;
        case "document.documentURI": return 6;
        case "document.baseURI": return 7;
        case "document.cookie": return 8;
        case "document.referrer": return 9;
        case "document.domain": return 10;
        case "window.name": return 11;
        case "postMessage": return 12;
        case "localStorage.getItem": return 13;
        case "sessionStorage.getItem": return 14;
        default: return 255;
    }
}

export { sourceToId };