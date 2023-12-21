# --- imports ---


# third party stuff
from peewee import TextField, ForeignKeyField
import tld
import hashlib
import json
import retirejs
import re

# our code
from database import BaseModel, Task, URL, database
from modules.login import Login
from utils import get_url_full_with_query_fragment

# --- database ---

# a script
class Script(BaseModel):
    # md5 hash of script source
    source_hash = TextField(unique = True)
    # (Truncated) content of the script source
    source = TextField()
    # sha1 hash
    sha1 = TextField(unique = True)
    # results from retirejs
    retire_js = TextField(null = True)

# url of a website that included a script (requires own table because of one to many relation)
class ScriptInclusion(BaseModel):
    # script that was seen at the url
    script = ForeignKeyField(Script)
    # currently crawled url
    url = TextField()
    # can be one of: eval (from eval call), inline (inline script or event handler), included (script with source url), dynamic (created by another script)
    inclusion_type = TextField()
    # url of script source
    # only present if script_type == 'included'
    source_url = TextField(null = True)
    # stack trace of inclusion (json)
    trace = TextField(null = True)
    # task associated with this finding
    task = ForeignKeyField(Task)
    # context (like trace but basically for parent)
    context = TextField(null = True)

# --- experiment code ---

def abc_md5(self, x):
    shash = hashlib.md5(x.encode()).hexdigest()
    return shash

def abc_sha1(self, x):
    return hashlib.sha1(x.encode()).hexdigest()

# Runtime.ExecutionContextDescription - description of an execution context
class CDBExecutionContextDescription:
    
    # constructor. initialize from dict
    def __init__(self, cdb_data):
        self.id = cdb_data["id"]
        self.origin = cdb_data["origin"]
        self.name = cdb_data["name"]
        self.unique_id = cdb_data["uniqueId"]

    def __str__(self):
        return str(self.__dict__)

class InclusionIssues(Login):
    
    # --- hooks for CDB events ---
     
    # Runtime.executionContextCreated - called when a new execution context is created (e.g., a new iframe) 
    def cdb_runtime__execution_context_created(self, cdb_data):
        # store reference to newly created execution context by id
        execution_context = CDBExecutionContextDescription(cdb_data["context"])
        self.cdb_execution_context_mapping[execution_context.id] = execution_context
        
    def cdb_runtime__console_api_called(self, cdb_data):
        # ignore messages not by our api thingy
        if cdb_data["type"] != "log" or (cdb_data["args"] == []) or (cdb_data["args"][0]["type"] != "string") or (not cdb_data["args"][0]["value"].startswith("[SMURF]")):
            return
        
        # extract relevant information
        message_data = json.loads(cdb_data["args"][0]["value"][10:])
        header = cdb_data["args"][0]["value"][:10]
        source_or_url, parser_inserted, hook = message_data["source_or_url"], message_data["parser_inserted"], message_data["hook"]
        shash = abc_md5(None, source_or_url)
        
        if "I" in header:
            # script with src
            self.hooked_script_inclusions[source_or_url] = (parser_inserted, hook, cdb_data["stackTrace"] if "stackTrace" in cdb_data else None)
        else:
            # script with text
            self.hooked_script_generations[shash] = (parser_inserted, hook, cdb_data["stackTrace"] if "stackTrace" in cdb_data else None)
        
        
    # Network.requestWillBeSent() - called before a request is made by the browser
    def cdb_network__request_will_be_sent(self, cdb_data):
        pass
        
    # resolve stack trace
    def resolve_trace(self, trace):
        while trace and "parentId" in trace:
            try:
                parent_trace = self.client.send("Debugger.getStackTrace", {"stackTraceId": trace['parentId']})
                if "parentId" in parent_trace:
                    trace["parentId"] = parent_trace["parentId"]
                else:
                    del trace["parentId"]
                if "callFrames" in parent_trace:
                    if "callFrames" not in trace:
                        trace["callFrames"] = list()
                    trace["callFrames"] += parent_trace["callFrames"]
            except:
                self.crawler.log.warn(f"could not get stack trace")
        
        if trace and "callFrames" in trace:
            for frame in trace["callFrames"]:
                if "scriptId" not in frame:
                    continue
                if frame["scriptId"] in self.script_id_map:
                    frame["script_id"] = self.script_id_map[frame["scriptId"]].id
                else:
                    frame["script_id"] = "-1"
                del frame["scriptId"]

    # Debugger.scriptParsed() - called whenever a script is parsed (JavaScript or WebAsm)
    def cdb_debugger__script_parsed(self, cdb_data):
        # we only care about JavaScript (ignore WebAsm)
        if cdb_data["scriptLanguage"] != "JavaScript":
            return
        
        # get execution context
        execution_context = self.cdb_execution_context_mapping[cdb_data["executionContextId"]]
        
        # ignore if execution context is for playwright stuff
        if execution_context.name == "__playwright_utility_world__":
            return
        
        # ignore if execution context is different etld+1 than currently crawled url (e.g. iframe)
        try:
            if tld.get_fld(self.crawler.currenturl) != tld.get_fld(execution_context.origin):
                return
        except:
            # one url is weird
            self.crawler.log.warning(f"failed to parse fld of {self.crawler.currenturl} or {execution_context.origin}")
            return
        
        # get source code and hash of script
        try:
            source = self.client.send("Debugger.getScriptSource", {"scriptId": cdb_data["scriptId"]})["scriptSource"]
        except:
            self.crawler.log.warning(f"failed to get script source for script with id {cdb_data['scriptId']}")
            source = ""
            
        shash = abc_md5(None, source)
        
        # exclude SMURF script
        if "SMURF" in source:
            return
        
        # scan for library
        retire_js_result = json.dumps(retirejs.scan_file_content(source))
        
        # create script (if necessary)
        script = Script.get_or_create(
            source_hash = shash,
            sha1 = abc_sha1(None, source),
            # Save first 5000 chars of the script
            source = source[:5000],
            retire_js = retire_js_result
        )[0]
        self.script_id_map[cdb_data["scriptId"]] = script
        
        context = None
        if shash in self.hooked_script_generations:
            context = self.hooked_script_generations[shash]
        elif cdb_data["url"] in self.hooked_script_inclusions:
            context = self.hooked_script_inclusions[cdb_data["url"]]
        
        inclusion_type = None
        source_url = ""
        trace = None
        
        if not trace and "stackTrace" in cdb_data:
            trace = cdb_data["stackTrace"]
        
        self.resolve_trace(trace)
        if context and context[2]:
            self.resolve_trace(context[2])
        
        # get inclusion kind
        if cdb_data["startLine"] != 0 or cdb_data["startColumn"] != 0:
            # only inline scripts have some sort of location
            inclusion_type = "inline-script"
        elif "stackTrace" in cdb_data:
            # cannot be an included script since they don't have a stack trace. So either eval or dynamic
            if not context:
                inclusion_type = "eval"
            else:
                inclusion_type = "dynamic/parser"
        else:
            # must be included script / dynamically included script
            source_url = cdb_data["url"]
            if not context:
                inclusion_type = "inclusion"
            else:
                inclusion_type = "dynamic/inclusion"
        
        # create script inclusion
        ScriptInclusion.create(
            script = script,
            url = self.crawler.currenturl,
            inclusion_type = inclusion_type,
            source_url = source_url,
            trace = json.dumps(trace),
            task = self.crawler.task,
            context = json.dumps(context) if context else None
        )
    

# --- module implementation ---

    # constructor. Called once per visited site (NOT crawled url. There is multiple crawled urls.)
    def __init__(self, crawler):
        super().__init__(crawler)
        # store reference to crawler
        self.crawler = crawler
        # id -> CDBExecutionContextDescription
        self.cdb_execution_context_mapping = None
        # script hash -> (parser_inserted, hook, stack trace)
        self.hooked_script_generations = None
        # script url -> (parser_inserted, hook, stack trace)
        self.hooked_script_inclusions = None
        # mapping from cdb script ids to scripts
        self.script_id_map = None

    # called once per crawled url (before visiting).
    def add_handlers(self, url: URL) -> None:
        super().add_handlers(url)
        
        # initialize mappings used to handle cdb stuff
        # id -> CDBExecutionContextDescription
        self.cdb_execution_context_mapping = dict()
        
        # script hash -> (parser_inserted, hook, stack trace)
        self.hooked_script_generations = dict()
        # script url -> (parser_inserted, hook, stack trace)
        self.hooked_script_inclusions = dict()
        # mapping from cdb script ids to scripts
        self.script_id_map = dict()
        
        # inject script that will be executed before anything
        self.crawler.page.add_init_script(path="./resources/hook_script2.js")
        
        # setup debug session
        self.client = self.crawler.page.context.new_cdp_session(self.crawler.page)
        self.client.send("Debugger.enable")
        self.client.send("Network.enable")
        self.client.send("Runtime.enable")
        # limit stack depth
        self.client.send('Runtime.setAsyncCallStackDepth', {"maxDepth": 50})
        # hook console
        self.client.on("Runtime.consoleAPICalled", self.cdb_runtime__console_api_called)
        # hook network requests
        self.client.on("Network.requestWillBeSent", self.cdb_network__request_will_be_sent)
        # hook execution context creation
        self.client.on("Runtime.executionContextCreated", self.cdb_runtime__execution_context_created)
        # hook script parser
        self.client.on("Debugger.scriptParsed", self.cdb_debugger__script_parsed)
        
    # called once per crawled url (after visiting, loading, and waiting)
    def receive_response(self, responses, url, final_url, start, repetition):
        super().receive_response(responses, url, final_url, start, repetition)
    
    
    # --- taken from headersexperimenttwo.py ---

    @staticmethod
    def register_job(log) -> None:
        Login.register_job(log)
        with database:
            database.create_tables([Script, ScriptInclusion])
    
    def add_url_filter_out(self, filters):
        # Ignore URLs which could lead to logout
        def filt(url):
            return re.search(Login.LOGOUTKEYWORDS, get_url_full_with_query_fragment(url), flags=re.I) is not None
        filters.append(filt)
