window.__getContextFromOpener = function (op) {
    if (op === null) {
        return undefined
    }
    return window.__getContextUrl(op);
};

window.__getContextUrl = function (w) {
    let cur_window = w;
    while (1) {
        if (cur_window.location.href.startsWith('http'))
            return cur_window.location.href;
        if (cur_window === cur_window.parent)
            return window.__getContextFromOpener(cur_window.opener);
        cur_window = cur_window.parent;

    }
};
let old_open = window.open;
window.open = function () {
    let win = old_open.apply(window, arguments);
    win.eval('(function (){let ourLog = window.opener.__our_log;window.' + '__domlog__' + '= function(id){let cur_loc = window.__getContextUrl(window);ourLog("[domlog]"+ JSON.stringify({url:cur_loc, id:id}))}})();');
    win.eval('(function (){let ourLog = window.opener.__our_log;window.' + '___domlog___' + '= function(id){let cur_loc = window.__getContextUrl(window);ourLog("[domlog]"+ JSON.stringify({url:cur_loc, id:id}))}})();');
    win.eval('(function (){let ourLog = window.opener.__our_log;window.' + '__crawly__' + '= function(id){let cur_loc = window.__getContextUrl(window);ourLog("[domlog]"+ JSON.stringify({url:cur_loc, id:id}))}})();');
    win.eval('window.__getContextFromOpener = ' + window.__getContextFromOpener.toString());
    win.eval('window.__getContextUrl = ' + window.__getContextUrl.toString());
    return win;
}