<!-- Automatically generated Documentation -->
## Tables 
### session_status (SessionStatus)

Represents the status of a session.


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| active | bool | Whether or not the Status is active |  |  |
| note | string | Description of the Status |  |  |
| name | string | Short name |  |  |

</details>

### login_result (LoginResult)

Represents the result of a login attempt.


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| success | bool | Whether or not the attempt was successful |  |  |
| note | string | Description of the result |  |  |
| name | string | Short name |  |  |

</details>

### sessions (Session)

Represents a user session.
The session can be broken though (status.active == False).


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| name | string | The name of the session (account\_id-time\_now-domain); same as the file name |  |  |
| actor | string | Who created the session (i.e., who performed the login task) |  |  |
| session\_status | [SessionStatus reference](#session_status-sessionstatus) | Session information |  |  |
| login\_result | [LoginResult reference](#login_result-loginresult) | Login information |  |  |
| experiment | string | Experiment currently using the session or None. |  |  |
| unlock\_time | datetime | Timestamp until the experiment can use the session (after that it automatically gets unlocked) | now() |  |
| locked | bool | Whether the session is currently locked (by an experiment) | False |  |
| verified | bool | Whether the session is verified (success) | False |  |
| verify\_type | string | How this session was verified: no, auto, manual | 'no' |  |
| verified\_browsers | string | List of browsers the session was successfully verified in. | '' |  |
| creation\_time | datetime | Time this entry was created | now() |  |
| update\_time | datetime | Time this entry was last updated | now() |  |
| account | [Account reference](#accounts-account) | Reference to account associated with this session. We do not use a back-reference here, as we keep old sessions. Thus, one account can be referenced by multiple sessions.\<br\>since the Account class is defined further down, we need a deferred reference |  |  |

</details>

### websites (Website)

represents a website we can create accounts for.


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| origin | string | Origin |  |  |
| site | string | Site (etld+1) |  |  |
| landing\_page | string | Full URL of the origin landing page |  |  |
| t\_rank | int | Website rank according to Tranco |  |  |
| c\_bucket | int | Website bucket according to CrUX |  |  |
| tranco\_date | string | Tranco date |  |  |
| crux\_date | string | CrUX date |  |  |
| creation\_time | datetime | Time this entry was created | now() |  |
| update\_time | datetime | Time this entry was last updated | now() |  |

</details>

### identities (Identity)

represents a template of personal information.
Idendities can be "instanciated" into Credentials.


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| username | string | Preferred username |  |  |
| email | string | Preferred email address |  |  |
| password | string | Preferred password |  |  |
| first\_name | string | First name |  |  |
| last\_name | string | Last name |  |  |
| gender | string | Gender |  |  |
| country | string | Country |  |  |
| zip\_code | string | Zip code |  |  |
| city | string | City |  |  |
| address | string | Address |  |  |
| birthday | date | Birthday |  |  |
| phone | string | Phone number |  |  |
| storage\_json | string | Path to the storage\_json of the email account of this identity | '' |  |
| creation\_time | datetime | Time this entry was created | now() |  |
| update\_time | datetime | Time this entry was last updated | now() |  |

</details>

### credentials (Credentials)

represents credentials required to login and additional User information


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| username | string | Username for login | '' |  |
| email | string | Email for login | '' |  |
| password | string | Password for login | '' |  |
| identity | [Identity reference](#identities-identity) | "Blueprint" for personal information |  |  |
| website | [Website reference](#websites-website) | Website the credentials belong to |  |  |
| creation\_time | datetime | Time this entry was created | now() |  |
| update\_time | datetime | Time this entry was last updated | now() |  |

</details>

### account_status (AccountStatus)

Represents the status of an account.


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| active | bool | Whether or not the Status is active |  |  |
| note | string | Description of the Status |  |  |
| name | string | Short name |  |  |

</details>

### registration_result (RegistrationResult)

Represents the result of a register attempt.


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| success | bool | Whether or not the attempt was successful |  |  |
| note | string | Description of the result |  |  |
| name | string | Short name |  |  |

</details>

### accounts (Account)

Represents a single registered account for a website.
Each account has exactly one credentials and exactly one session and belongs to exactly one website.


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| actor | string | Who created the account |  |  |
| website | [Website reference](#websites-website) | Website the account belongs to |  |  |
| credentials | [Credentials reference](#credentials-credentials) | Login credentials (and possibly additional information about registered user) |  |  |
| session | [Session reference](#sessions-session) | Active session (may be None) |  |  |
| account\_status | [AccountStatus reference](#account_status-accountstatus) | Account status |  |  |
| registration\_result | [RegistrationResult reference](#registration_result-registrationresult) | Registration information |  |  |
| registration\_note | string | Note for last registration attempt | '' |  |
| login\_note | string | Note of last login attempt | '' |  |
| validation\_note | string | Note of last validation attempt | '' |  |
| creation\_time | datetime | Time this entry was created | now() |  |
| update\_time | datetime | Time this entry was last updated | now() |  |

</details>

### login_tasks (LoginTask)

Represents a task for someone (or something) to log an account in.
As a result, the account's session will be replaced with a new session and the account status may change.


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| account | [Account reference](#accounts-account) | Account to login (contains everything required to perform the login) |  |  |
| login\_result | [LoginResult reference](#login_result-loginresult) | Outcome of the login task |  |  |
| actor | string | Name of actor handling this task |  |  |
| status | string | Current status of this task ("free", "completed", or "progress") | 'free' |  |
| priority | int | Higher priority means more urgent to be completed | 0 |  |
| task\_type | string | How the task should be processed. Currently only 'manual' or 'auto' exist. | 'manual' |  |
| recording | bool | Whether the task was recorded with codegen or not (no recording is used if bitwarden is used) | False |  |
| note | string | Additional notes for a task. | '' |  |
| creation\_time | datetime | Time this entry was created | now() |  |
| update\_time | datetime | Time this entry was last updated | now() |  |

</details>

### validate_tasks (ValidateTask)

Represents a task for someone (or something) to validate an active session of an account.
As a result, the sessions status may change and the validator will be changed.
If, e.g., the account got suspended, the account status may also be changed.


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| session | [Session reference](#sessions-session) | Session to re-validation |  |  |
| validate\_result | string | Outcome of the validation task | '' |  |
| actor | string | Name of actor handling this task |  |  |
| status | string | Current status of this task ("free", "completed", or "progress") | 'free' |  |
| priority | int | Higher priority means more urgent to be completed | 0 |  |
| task\_type | string | How the task should be processed. Currently only 'manual' or 'auto' exist. | 'manual' |  |
| recording | bool | Whether the task was recorded with codegen or not (no recording is used if bitwarden is used) | False |  |
| note | string | Additional notes for a task. | '' |  |
| creation\_time | datetime | Time this entry was created | now() |  |
| update\_time | datetime | Time this entry was last updated | now() |  |

</details>

### register_tasks (RegisterTask)

Represents a task for someone (or something) to register an account for the given website with the given credentials.
As a result, a new entry in the accounts table should appear, even if creation fails.
This entry should be referenced by :account.


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| website | [Website reference](#websites-website) | Website to create an account on |  |  |
| identity | [Identity reference](#identities-identity) | Identity to use for registration |  |  |
| account | [Account reference](#accounts-account) | Account that was created following this request |  |  |
| registration\_result | [RegistrationResult reference](#registration_result-registrationresult) | Outcome of a registration task for later analysis |  |  |
| actor | string | Name of actor handling this task |  |  |
| status | string | Current status of this task ("free", "completed", or "progress") | 'free' |  |
| priority | int | Higher priority means more urgent to be completed | 0 |  |
| task\_type | string | How the task should be processed. Currently only 'manual' or 'auto' exist. | 'manual' |  |
| recording | bool | Whether the task was recorded with codegen or not (no recording is used if bitwarden is used) | False |  |
| note | string | Additional notes for a task. | '' |  |
| creation\_time | datetime | Time this entry was created | now() |  |
| update\_time | datetime | Time this entry was last updated | now() |  |

</details>

### experiment_websites (ExperimentWebsite)

Represents information about which websites were used by which experiment


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| website | [Website reference](#websites-website) | Website that was acquired by the experiment |  |  |
| experiment | string | Experiment that acquired the website |  |  |
| session | [Session reference](#sessions-session) | Session that the experiment received |  |  |
| creation\_time | datetime | Time this entry was created | now() |  |
| update\_time | datetime | Time this entry was last updated | now() |  |

</details>

### aa_task (aa_Task)

The tasks the crawler works on.


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| job | string |  |  |  |
| crawler | int |  |  |  |
| site | string |  |  |  |
| url | string |  |  |  |
| landing\_page | string |  |  |  |
| rank | int |  |  |  |
| state | string |  | 'free' |  |
| code | int |  |  |  |
| error | string |  |  |  |
| created | datetime |  | now() |  |
| updated | datetime |  | now() |  |
| note | string |  |  |  |

</details>

### aa_url (aa_URL)

The URLs the crawler visits.


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| task | [aa\_Task reference](#aa_task-aa_task) |  |  |  |
| job | string |  |  |  |
| crawler | int |  |  |  |
| site | string |  |  |  |
| url | string |  |  |  |
| urlfinal | string |  |  |  |
| fromurl | [aa\_URL reference](#aa_url-aa_url) |  |  |  |
| depth | int |  |  |  |
| code | int |  |  |  |
| repetition | int |  |  |  |
| start | datetime |  |  |  |
| end | datetime |  |  |  |
| state | string |  | 'free' |  |
| created | datetime |  | now() |  |
| updated | datetime |  | now() |  |
| note | string |  |  |  |

</details>

### aa_registrationform (aa_RegistrationForm)


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| job | string |  |  |  |
| crawler | int |  |  |  |
| site | string |  |  |  |
| depth | int |  |  |  |
| formurl | string |  |  |  |
| formurlfinal | string |  |  |  |
| created | datetime |  | now() |  |
| updated | datetime |  | now() |  |
| note | string |  |  |  |

</details>

### aa_loginform (aa_LoginForm)


<details>
<summary><b>Columns</b></summary>

| name | type | description | default value | notes |
|---|---|---|---|---|
| job | string |  |  |  |
| crawler | int |  |  |  |
| site | string |  |  |  |
| depth | int |  |  |  |
| formurl | string |  |  |  |
| formurlfinal | string |  |  |  |
| success | bool |  |  |  |
| created | datetime |  | now() |  |
| updated | datetime |  | now() |  |
| note | string |  |  |  |

</details>

