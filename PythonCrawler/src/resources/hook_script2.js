/*SMURF*/(function () {
    const ON_HANDLERS = ["onabort", "onafterprint", "onbeforeprint", "onbeforeunload", "onblur", "oncanplay", "oncanplaythrough", "onchange", "onclick", "oncontextmenu", "oncopy", "oncuechange", "oncut", "ondblclick", "ondrag", "ondragend", "ondragenter", "ondragleave", "ondragover", "ondragstart", "ondrop", "ondurationchange", "onemptied", "onended", "onerror", "onfocus", "onhashchange", "oninput", "oninvalid", "onkeydown", "onkeypress", "onkeyup", "onload", "onloadeddata", "onloadedmetadata", "onloadstart", "onmousedown", "onmousemove", "onmouseout", "onmouseover", "onmouseup", "onmousewheel", "onoffline", "ononline", "onpagehide", "onpageshow", "onpaste", "onpause", "onplay", "onplaying", "onpopstate", "onprogress", "onratechange", "onreset", "onresize", "onscroll", "onsearch", "onseeked", "onseeking", "onselect", "onstalled", "onstorage", "onsubmit", "onsuspend", "ontimeupdate", "ontoggle", "onunload", "onvolumechange", "onwaiting", "onwheel"]
    
    // get a reference to the unmodified console log
    let ourLog = console.log;
    
    // report script the following way:
    // hash of script, parser inserted (true or false), type of hook that was triggered
    function reportScript(source, parser_inserted, hook) {
        ourLog("[SMURF][S]" + JSON.stringify({"source_or_url": source, "parser_inserted": parser_inserted, "hook": hook}));
    }
    
    // report script with src url the following way:
    // url, parser inserted (true or false), type of hook that was triggered
    function reportInclusion(url, parser_inserted, hook){
        ourLog("[SMURF][I]" + JSON.stringify({"source_or_url": url, "parser_inserted": parser_inserted, "hook": hook}));
    }
    
    // intercept html parsing of script stuff
    function __interceptHTML(code, parser_inserted=false, doesNotExecuteInlineScripts=false) {
        let parser = new DOMParser();
        let fake = parser.parseFromString(code, "text/html");

        //On* events
        for (let ele of fake.getElementsByTagName("*")) {
            for (let attr of ele.getAttributeNames()) {
                if (attr.startsWith("on")) {
                    let source_code = ele[attr] === null ? ele.getAttribute(attr) : ele[attr].toString();
                    reportScript(source_code, parser_inserted, "intercept_html_" + attr);
                }
            }
        }

        //Inline scripts
        // innerHTML does not execute inline script -> doesNotExecuteInlineScript will be true
        if (!doesNotExecuteInlineScripts) {
            for (let script of fake.getElementsByTagName("script")) {
                if (!script.src && script.innerText) {
                    reportScript(script.innerText, parser_inserted, "intercept_html_inline_script");
                }
                if (script.src) {
                    reportInclusion(script.src, parser_inserted, "intercept_html_included_script");
                }
            }
        }
        return code;
    }
    
    function _hookArbitratyNodeInsertions(object, property, tag) {
        try {
            let old_fun = object[property];

            function _hookedNodeInsertion() {
                for (let arg of arguments) {
                    if (typeof arg === 'object' && arg.tagName !== undefined && arg.tagName !== null) {
                        if (arg.tagName.toLowerCase() === 'script' && arg.text) {
                            reportScript(arg.text, null, "arbitrary_node_insertions_" + property)
                        }
                        for (let attr of ON_HANDLERS) {
                            if (arg[attr] !== undefined && arg[attr] !== null) {
                                reportScript(arg[attr].toString(), null, "arbitrary_node_insertions_" + attr);
                            }
                        }
                    }
                }
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
                        reportScript(arguments[nodeIndex].text, null, "call_node_insertion_" + property);
                    } else if(arguments[nodeIndex].src){
                        reportInclusion(arguments[nodeIndex].src, null, "call_node_insertion_" + property);
                    }
                }
                if (arguments.length > nodeIndex) {
                    let node = arguments[nodeIndex];
                    for (let attr of ON_HANDLERS) {
                        if (node[attr] !== undefined && node[attr] !== null) {
                            reportScript(node[attr].toString(), null, "call_node_insertion_" + attr);
                        }
                    }
                }
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
                    reportScript(arguments[0], null, "code_to_string_" + property);
                return old_fun.apply(this, arguments)
            }

            object[property] = _hooked_eval;
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
        wrap(HTMLIFrameElement, "srcdoc", false);
    })();

    (function () {
        let old = {};

        function wrap(name) {
            old[name] = document[name];
            document[name] = function () {
                for (let i = 0; i < arguments.length; i++) {
                    arguments[i] = __interceptHTML(arguments[i], true, false);
                }
                old[name].call(document, ...arguments);
            };
        }

        wrap("write");
        wrap("writeln");
    })();
    
    // Calls Element prototype
    _hookArbitratyNodeInsertions(Element.prototype, 'after', 'after');
    _hookArbitratyNodeInsertions(Element.prototype, 'before', 'before');
    _hookArbitratyNodeInsertions(Element.prototype, 'append', 'append');
    _hookArbitratyNodeInsertions(Element.prototype, 'prepend', 'prepend');

    _hookAdjacentHTML(Element.prototype, 'insertAdjacentHTML', 'insertAdjacentHTML');
    _hookCallNodeInsertion(Element.prototype, 'insertAdjacentElement', 'insertAdjacentElement');

    // Calls Node
    _hookCallNodeInsertion(Node.prototype, 'appendChild', 'appendChild');
    _hookCallNodeInsertion(Node.prototype, 'insertBefore', 'insertBefore');

    _hookCodeToString(window, 'setTimeout', 'eval');
    _hookCodeToString(window, 'setInterval', 'eval');
    
}) ();
