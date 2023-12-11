/*SMURF*/(function () {
    let reports = [];
    const ON_HANDLERS = ["onabort", "onafterprint", "onbeforeprint", "onbeforeunload", "onblur", "oncanplay", "oncanplaythrough", "onchange", "onclick", "oncontextmenu", "oncopy", "oncuechange", "oncut", "ondblclick", "ondrag", "ondragend", "ondragenter", "ondragleave", "ondragover", "ondragstart", "ondrop", "ondurationchange", "onemptied", "onended", "onerror", "onfocus", "onhashchange", "oninput", "oninvalid", "onkeydown", "onkeypress", "onkeyup", "onload", "onloadeddata", "onloadedmetadata", "onloadstart", "onmousedown", "onmousemove", "onmouseout", "onmouseover", "onmouseup", "onmousewheel", "onoffline", "ononline", "onpagehide", "onpageshow", "onpaste", "onpause", "onplay", "onplaying", "onpopstate", "onprogress", "onratechange", "onreset", "onresize", "onscroll", "onsearch", "onseeked", "onseeking", "onselect", "onstalled", "onstorage", "onsubmit", "onsuspend", "ontimeupdate", "ontoggle", "onunload", "onvolumechange", "onwaiting", "onwheel"]

    // get a reference to the unmodified console log
    let ourLog = console.log;
    // global map storing tags to already encountered partial stacktraces
    window.__tag_to_stack_traces = {};

    async function reportScript(script) {
        let hashed = await window.__MD5(script);
        ourLog('[Script]' + hashed);
    }

    function __interceptHTML(code, parser_inserted=false, doesNotExecuteInlineScripts=false) {
        let parser = new DOMParser();
        let fake = parser.parseFromString(code, "text/html");

        //On* events
        for (let ele of fake.getElementsByTagName("*")) {
            for (let attr of ele.getAttributeNames()) {
                if (attr.startsWith("on")) {
                    let sc = ele[attr] === null ? ele.getAttribute(attr) : ele[attr].toString();
                    reportScript(sc);
                    report("inline_handler", ele[attr] === null ? ele.getAttribute(attr) : ele[attr].toString());

                    if(parser_inserted){
                        // event handler always execute
                        reportParserInsertion(sc);
                    }
                }
            }
        }

        //Inline scripts
        // innerHTML does not execute inline script -> doesNotExecuteInlineScript will be true
        if (!doesNotExecuteInlineScripts) {
            for (let script of fake.getElementsByTagName("script")) {
                if (!script.src && script.innerText) {
                    report("inline_script", script.innerText);
                    reportScript(script.innerText);
                    if (parser_inserted) {
                        reportParserInsertion(script.innerText);
                    }
                }
                if (script.src && parser_inserted) {
                    // only report parser insertion, as external scripts will be handled elsewhere.
                    reportParserInsertion(script.src);
                }
            }
        }
        return code;
    }


    function report(tag, addInfo) {
        let stack = (new Error()).stack;
        let hashed = window.__MD5(stack + '\n' + (addInfo && addInfo.arguments ? addInfo.arguments.toString() : ''));
        if (window.__tag_to_stack_traces[tag] !== undefined) {
            if (window.__tag_to_stack_traces[tag].has(hashed))
                return;
            window.__tag_to_stack_traces[tag].add(hashed);
        } else {
            window.__tag_to_stack_traces[tag] = new Set();
            window.__tag_to_stack_traces[tag].add(hashed);
        }

        let serialized;
        try {
            serialized = JSON.stringify({tag: tag, addInfo: addInfo, st_hash: hashed});

        }
        catch (e) {
            serialized = JSON.stringify({tag: tag, addInfo: addInfo.toString(), st_hash: hashed});
        }
        ourLog('[SMURF]' + serialized);
    }

    function hexString(buffer) {
        const byteArray = new Uint8Array(buffer);

        const hexCodes = [...byteArray].map(value => {
            const hexCode = value.toString(16);
            const paddedHexCode = hexCode.padStart(2, '0');
            return paddedHexCode;
        });

        return hexCodes.join('');
    }

    async function reportParserInsertion(identifier) {
        let hashed = window.__MD5(identifier);
        ourLog('[ParserInserted]' + hashed);
    }

    function _hookCall(object, property, tag) {
        try {
            let old_fun = object[property];

            function _hooked() {
                report(tag, {arguments: Array(...arguments)});
                return old_fun.apply(this, arguments)
            }

            object[property] = _hooked;
        }
        catch (e) {
            console.error(e)
        }
    }

    function _hookArbitratyNodeInsertions(object, property, tag) {
        try {
            let old_fun = object[property];

            function _hookedNodeInsertion() {
                for (let arg of arguments) {
                    if (typeof arg === 'object' && arg.tagName !== undefined && arg.tagName !== null) {
                        if (arg.tagName.toLowerCase() === 'script' && arg.text) {
                            report('inline_script', {source: arg.text});
                            reportScript(arg.text)
                        }
                        for (let attr of ON_HANDLERS) {
                            if (arg[attr] !== undefined && arg[attr] !== null) {
                                report("inline_handler", arg[attr].toString());
                                reportScript(arg[attr].toString());

                            }
                        }
                    }
                }
                report(tag, {arguments: Array(...arguments)});
                return old_fun.apply(this, arguments)
            }

            object[property] = _hookedNodeInsertion;
        }
        catch (e) {
            console.error(e)
        }
    }

    function _hookCallNodeInsertion(object, property, tag) {
        try {
            let old_fun = object[property];
            let nodeIndex;
            if (tag === 'appendChild') {
                nodeIndex = 0;
            }
            else if (tag === 'insertBefore') {
                nodeIndex = 0;
            }
            else if (tag === 'insertAdjacentElement') {
                nodeIndex = 1;
            }

            function _hookedNodeInsertion() {
                if (arguments.length > nodeIndex && arguments[nodeIndex].tagName && arguments[nodeIndex].tagName.toLowerCase() === 'script') {
                    if (!arguments[nodeIndex].src && arguments[nodeIndex].text) {
                        report('inline_script', {source: arguments[nodeIndex].text});
                        reportScript(arguments[nodeIndex].text);
                    }
                }
                if (arguments.length > nodeIndex) {
                    let node = arguments[nodeIndex];
                    for (let attr of ON_HANDLERS) {
                        if (node[attr] !== undefined && node[attr] !== null) {
                            report("inline_handler", node[attr].toString());
                            reportScript(node[attr].toString());
                        }
                    }
                }
                report(tag, {arguments: Array(...arguments)});
                return old_fun.apply(this, arguments)
            }

            object[property] = _hookedNodeInsertion;
        }
        catch (e) {
            console.error(e)
        }
    }

    function _hookAdjacentHTML(object, property, tag) {
        try {
            let old_fun = object[property];

            function _hookedNodeInsertion() {
                if (arguments.length > 1) {
                    __interceptHTML(arguments[1], true, true)
                }
                report(tag, {arguments: Array(...arguments)});
                return old_fun.apply(this, arguments)
            }

            object[property] = _hookedNodeInsertion;
        }
        catch (e) {
            console.error(e)
        }
    }


    function _hookCodeToString(object, property, tag) {
        try {
            let old_fun = object[property];

            function _hooked_eval() {
                if (arguments.length > 0 && typeof arguments[0] === 'string')
                    report(tag, {arguments: Array(...arguments)});
                return old_fun.apply(this, arguments)
            }

            object[property] = _hooked_eval;
        }
        catch (e) {
            console.error(e)
        }
    }

    function _hookAssignement(object, property, tag) {
        try {
            let desc = Object.getOwnPropertyDescriptor(object, property);

            function _hookedSetter(value) {
                report(tag, {value: value});
                return desc.set.apply(this, arguments);
            }

            Object.defineProperty(object, property, {
                get: desc.get,
                set: _hookedSetter
            })
        }
        catch (e) {
            console.error(e)
        }
    }

    function _hookAccess(object, property, tag) {
        try {
            let desc = Object.getOwnPropertyDescriptor(object, property);

            function _hookedSetter(value) {
                report(tag + '_set', {value: value});
                return desc.set.apply(this, arguments);
            }

            function _hookedGetter() {
                report(tag + '_get');
                return desc.get.apply(this, arguments);
            }

            Object.defineProperty(object, property, {
                get: _hookedGetter,
                set: _hookedSetter
            })
        }
        catch (e) {
            console.error(e)
        }

    }

    function _proxyStorage(obj_name, tag) {
        try {
            let old = window[obj_name];
            let old_set = old.setItem;
            let old_del = old.removeItem;
            // functions to return which capture important actions on storage elements
            let hooked_assignment = function (prop, value) {
                report(tag + '_set', {'key': prop, 'value': value});
                return old_set.apply(old, arguments);
            };
            let hooked_get = function (prop) {
                report(tag + '_get', {'key': prop});
                return old.getItem(prop);
            };
            let hooked_delete = function (prop) {
                report(tag + '_del', {'key': prop});
                return old_del.apply(old, arguments)
            };
            // proxy handler, intercepting gets and sets
            const handler = {
                get: function (obj, prop) {
                    if (prop === 'setItem')
                        return hooked_assignment;
                    if (prop === 'getItem')
                        return hooked_get;
                    if (prop === 'removeItem')
                        return hooked_delete;


                    let accessed = obj[prop];
                    // native functions needs to be binded to the real object
                    if (accessed !== undefined && typeof accessed === 'function') {
                        accessed = accessed.bind(old);
                    }

                    report(tag + '_get', {'key': prop});
                    return accessed;
                },
                set: function (obj, prop, value) {
                    if (prop === 'setItem' || prop === 'getItem' || prop === 'removeItem')
                        return;
                    report(tag + '_set', {'key': prop, 'value': value});
                    return obj[prop] = value;
                }
            };
            let proxy = new Proxy(old, handler);

            // assign the proxy to the respective getter
            Object.defineProperty(window, obj_name, {
                get: () => {
                    return proxy
                },
            })
        }
        catch (e) {
            console.error(e)
        }

    }

    function _hookAddEventListener() {
        try {
            let oldAddEventListener = window.addEventListener;

            function _hooked() {
                let event = arguments[0];

                // hook sensitive handlers, we only care about PM here
                let handlers = ['message'];

                for (let handler of handlers) {
                    if (handler === event) {
                        report(handler, {function: arguments[1].toString()});
                        break;
                    }
                }

                return oldAddEventListener.apply(window, arguments);
            }

            window.addEventListener = _hooked;
        }
        catch (e) {
            console.error(e)
        }
    }

    function _hookObject(obj, prop, tag) {
        try {
            let elem = obj[prop];
            const handler = {
                get: function (obj, prop) {
                    report(tag + '_get_' + prop);
                    let accessed = obj[prop];
                    if (accessed !== undefined && typeof accessed === 'function') {
                        return accessed.bind(elem);
                    }
                    return accessed;
                }
            };
            let proxy = new Proxy(elem, handler);
            Object.defineProperty(obj, prop, {
                get: () => {
                    return proxy
                },
            })
        }
        catch (e) {
            console.error(e)
        }

    }

    function _hookPostMessages() {
        try {
            let getter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get;
            let source_getter = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'source').get;


            Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
                get: function () {
                    let w = this;
                    let cw = getter.apply(w);
                    const handler = {
                        get: function (target, key, receiver) {
                            let accessed = target[key];

                            if (key === 'postMessage') {
                                let pm_hook = function (message, origin, transfer) {
                                    report('postMessage', {message: message, targetOrigin: origin});
                                    return cw.postMessage(message, origin, transfer);
                                };
                                return pm_hook;
                            }

                            if (accessed !== undefined && typeof accessed === 'function') {
                                accessed = accessed.bind(w);
                            }

                            return accessed;
                        }
                    };
                    return new Proxy(cw, handler);
                },
            });

            Object.defineProperty(MessageEvent.prototype, 'source', {
                get: function () {
                    let w = this;
                    let cw = source_getter.apply(w);
                    const handler = {
                        get: function (target, key, receiver) {
                            let accessed = target[key];

                            if (key === 'postMessage') {
                                let pm_hook = function (message, origin, transfer) {
                                    report('postMessage', {message: message, targetOrigin: origin});
                                    return cw.postMessage(message, origin, transfer);
                                };
                                return pm_hook;
                            }

                            if (accessed !== undefined && typeof accessed === 'function') {
                                accessed = accessed.bind(w);
                            }

                            return accessed;
                        }
                    };
                    return new Proxy(cw, handler);
                },
            })


        }
        catch (e) {
            console.error(e)
        }
    }

    (function () {
        function wrap(ele, attr, doesNotExecuteInlineScripts) {
            let old_fun = Object.getOwnPropertyDescriptor(ele.prototype, attr).set;
            Object.defineProperty(ele.prototype, attr, {
                set: function () {
                    report(attr);
                    __interceptHTML(arguments[0], true, doesNotExecuteInlineScripts);
                    return old_fun.apply(this, arguments);
                }
            });
        }

        wrap(Element, "innerHTML", true);
        wrap(Element, "outerHTML", true);
        wrap(HTMLIFrameElement, "srcdoc",false);
    })();

    (function () {
        let old = {};

        function wrap(name) {
            old[name] = document[name];
            document[name] = function () {
                report(name);
                for (let i = 0; i < arguments.length; i++) {
                    arguments[i] = __interceptHTML(arguments[i], true, false);
                }
                old[name].call(document, ...arguments);
            };
        }

        wrap("write");
        wrap("writeln");
    })();

    // PM
    _hookAddEventListener();
    _hookPostMessages();

    _hookAssignement(document.__proto__.__proto__, 'domain', 'document.domain');
    _hookAccess(document.__proto__.__proto__, 'cookie', 'document.cookie');

    // Calls Element prototype
    _hookArbitratyNodeInsertions(Element.prototype, 'after', 'after');
    _hookArbitratyNodeInsertions(Element.prototype, 'before', 'before');
    _hookArbitratyNodeInsertions(Element.prototype, 'append', 'append');
    _hookArbitratyNodeInsertions(Element.prototype, 'prepend', 'prepend');

    _hookAdjacentHTML(Element.prototype, 'insertAdjacentHTML', 'insertAdjacentHTML');
    _hookCallNodeInsertion(Element.prototype, 'insertAdjacentElement', 'insertAdjacentElement');

    _hookCall(Element.prototype, 'insertAdjacentText', 'insertAdjacentText');
    _hookCall(Element.prototype, 'remove', 'remove');
    _hookCall(Element.prototype, 'replaceWith', 'replaceWith');


    // Assignments HTMLElement
    _hookAssignement(HTMLElement.prototype, 'innerText', 'innerText');
    _hookAssignement(HTMLElement.prototype, 'outerText', 'outerText');


    // Calls Node
    _hookCallNodeInsertion(Node.prototype, 'appendChild', 'appendChild');
    _hookCallNodeInsertion(Node.prototype, 'insertBefore', 'insertBefore');

    _hookCall(Node.prototype, 'removeChild', 'removeChild');
    _hookCall(Node.prototype, 'replaceChild', 'replaceChild');


    // Calls document
    _hookCall(document, 'createElement', 'document.createElement');
    _hookCall(document, 'createTextNode', 'document.createTextNode');

    _hookCall(document, 'getElementById', 'document.getElementById');
    _hookCall(document, 'getElementsByName', 'document.getElementsByName');
    _hookCall(document, 'getElementsByClassName', 'document.getElementsByClassName');
    _hookCall(document, 'getElementsByTagName', 'document.getElementsByTagName');

    _hookCall(document, 'importNode', 'document.importNode');
    _hookCall(document, 'adoptNode', 'document.adoptNode');

    _hookCodeToString(window, 'setTimeout', 'eval');
    _hookCodeToString(window, 'setInterval', 'eval');

    // Access to document information
    _hookAccess(document.__proto__.__proto__, 'referrer', 'document.referrer');
    _hookAccess(document.__proto__.__proto__, 'URL', 'document.URL');


    // client-side Storages
    _proxyStorage('localStorage', 'localStorage');
    _proxyStorage('sessionStorage', 'sessionStorage');
    _hookCall(window.indexedDB, 'open', 'openedIndexDB');

    _hookObject(window, 'navigator', 'navigator');
    _hookObject(window, 'screen', 'screen');

    _hookCall(navigator.serviceWorker, 'register', 'ServiceWorkerRegister')

}) ();
