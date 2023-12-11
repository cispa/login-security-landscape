# Additional information to CXSS snippet code
The following documents contains the supported sink/source combinations from Foxhound and the exploit generator.
## Supported sink/source combinations by the crawler browser engine (foxhound)
Complete list is present at [https://github.com/SAP/project-foxhound/tree/2916e0188bc95ee6912792df8358aef62e8bfbfe/taint](https://github.com/SAP/project-foxhound/tree/2916e0188bc95ee6912792df8358aef62e8bfbfe/taint)
### Sources
- `location.hash`
- `location.host`
- `location.hostname`
- `location.href`
- `location.origin`
- `location.pathname`
- `location.search`
- `document.baseURI`
- `document.referrer`
- `document.documentURI`
- `document.cookie`
- `window.name`
- `script.innerHTML`
#### Partial taint flows 
Listed at [https://github.com/SAP/project-foxhound/tree/2916e0188bc95ee6912792df8358aef62e8bfbfe/taint#partial-taint-flows](https://github.com/SAP/project-foxhound/tree/2916e0188bc95ee6912792df8358aef62e8bfbfe/taint#partial-taint-flows)
- `XMLHttpRequest.response`
- `WebSocket.MessageEvent.data (for a String payload)`
- `window.postMessage`
#### DOM Elements
Listed at [https://github.com/SAP/project-foxhound/tree/2916e0188bc95ee6912792df8358aef62e8bfbfe/taint#dom-elements](https://github.com/SAP/project-foxhound/tree/2916e0188bc95ee6912792df8358aef62e8bfbfe/taint#dom-elements)
- `input.value`
#### Local and Sesssion Storage
Listed at [https://github.com/SAP/project-foxhound/tree/2916e0188bc95ee6912792df8358aef62e8bfbfe/taint#local-and-sesssion-storage](https://github.com/SAP/project-foxhound/tree/2916e0188bc95ee6912792df8358aef62e8bfbfe/taint#local-and-sesssion-storage))
- `window.localStorage.getItem`
- `window.sesssionStorage.getItem`
### Sinks
Listed at [https://github.com/SAP/project-foxhound/tree/2916e0188bc95ee6912792df8358aef62e8bfbfe/taint#sinks](https://github.com/SAP/project-foxhound/tree/2916e0188bc95ee6912792df8358aef62e8bfbfe/taint#sinks)
- `Event handler`
- `outerHTML`
- `innerHTML`
- `location.hash`
- `location.host`
- `location.hostname`
- `location.href`
- `location.pathname`
- `location.port`
- `location.protocol`
- `location.search`
- `location.assign`
- `document.cookie`
- `document.write`
- `setInterval`
- `setTimeout`
- `script.innerHTML`
- `script.text`
- `script.src`
- `img.src`
- `img.srcset`
- `iframe.src`
- `embed.src`
- `area.href`
- `object.data`
- `track.src`
- `a.href`
- `eval`
- `Function.ctr`
#### Partial taint flows: 
Listed at [https://github.com/SAP/project-foxhound/tree/2916e0188bc95ee6912792df8358aef62e8bfbfe/taint#partial-taint-flows-1](https://github.com/SAP/project-foxhound/tree/2916e0188bc95ee6912792df8358aef62e8bfbfe/taint#partial-taint-flows-1)
- `XMLHttpRequest.open(url)`
- `XMLHttpRequest.open(username)`
- `XMLHttpRequest.open(password)`
- `XMLHttpRequest.send`
- `XMLHttpRequest.setRequestHeader(value)`
- `XMLHttpRequest.setRequestHeader(name)`
- `WebSocket.send (for a String payload)`
- `window.MessageEvent`
#### Local and Session Storage
Listed at [https://github.com/SAP/project-foxhound/tree/2916e0188bc95ee6912792df8358aef62e8bfbfe/taint#local-and-session-storage](https://github.com/SAP/project-foxhound/tree/2916e0188bc95ee6912792df8358aef62e8bfbfe/taint#local-and-session-storage)
- `window.localStorage.setItem`
## Sink/source combinations by the exploit generator
The fork of the generator is hosted at [https://github.com/thelbrecht/persistent-clientside-xss-for-login-security/tree/6ebdac63bf8f39c0abcbeb7cd2ab9ee89175c079](https://github.com/thelbrecht/persistent-clientside-xss-for-login-security/tree/6ebdac63bf8f39c0abcbeb7cd2ab9ee89175c079) and used as a git submodule.

The following files contain sink/source configurations:
- [src/config.py]( [https://github.com/thelbrecht/persistent-clientside-xss-for-login-security/blob/6ebdac63bf8f39c0abcbeb7cd2ab9ee89175c079/src/config.py](https://github.com/thelbrecht/persistent-clientside-xss-for-login-security/blob/6ebdac63bf8f39c0abcbeb7cd2ab9ee89175c079/src/config.py))
- [src/constants/sinks.py](https://github.com/thelbrecht/persistent-clientside-xss-for-login-security/blob/6ebdac63bf8f39c0abcbeb7cd2ab9ee89175c079/src/constants/sinks.py)
- [src/constants/sources.py](https://github.com/thelbrecht/persistent-clientside-xss-for-login-security/blob/6ebdac63bf8f39c0abcbeb7cd2ab9ee89175c079/src/constants/sources.py)

*Note*: Sources that have the `hasEncodingURI` or `hasEncodingURIComponent` are also ignored. 
### Sources
- `SOURCES.SOURCE_LOCATION_HREF`
- `SOURCES.SOURCE_LOCATION_SEARCH`
- `SOURCES.SOURCE_LOCATION_HASH`
- `SOURCES.SOURCE_URL`
- `SOURCES.SOURCE_DOCUMENT_URI`
- `SOURCES.SOURCE_BASE_URI`
- `SOURCES.SOURCE_COOKIE`
- `SOURCES.SOURCE_LOCAL_STORAGE`
- `SOURCES.SOURCE_SESSION_STORAGE`
### Sinks
- `SINKS.SINK_EXEC`
- `SINKS.SINK_SCRIPT_TEXT`
- `SINKS.SINK_DOC_WRITE`
- `SINKS.SINK_INNER_HTML`
- `SINKS.SINK_IFRAME_SRCDOC`
- `SINKS.SINK_SCRIPT_SRC`
- `SINKS.SINK_INNER_HTML`