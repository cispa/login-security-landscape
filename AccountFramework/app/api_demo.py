import traceback
import zmq
import json
import bullet

def connect(host="accf-auto", port=5555):
    """Connect to the account framework API backend."""
    context = zmq.Context()
    socket = context.socket(zmq.REQ)
    socket.connect(f"tcp://{host}:{port}")
    return socket

def get_session(socket, experiment):
    """Get a session for an experiment."""
    request = {"type": "get_session", "experiment": experiment}
    socket.send_string(json.dumps(request))
    response = json.loads(socket.recv_string())
    if response["success"]:
        return response["session"]
    raise Exception(response["error"])

def get_specific_session(socket, experiment, site):
    """Get a session for a specific site for an experiment."""
    request = {"type": "get_specific_session", "experiment": experiment, "site": site}
    socket.send_string(json.dumps(request))
    response = json.loads(socket.recv_string())
    if response["success"]:
        return response["session"]
    raise Exception(response["error"])

def unlock_session(socket, session, experiment):
    """Unlock a session again."""
    request = {"type": "unlock_session", "experiment": experiment, "session_id": session["id"]}
    socket.send_string(json.dumps(request))
    response = json.loads(socket.recv_string())
    if response["success"]:
        return "Successfully unlocked"
    raise Exception(response["error"])

if __name__ == "__main__":
    """Showcase the API functionality."""
    s = connect()
    exp = bullet.Input("Please enter an example experiment name: ").launch()

    # Try getting a session for the experiment
    # The same website can only be received once per experiment
    try:
        session = get_session(s, exp)
        print(f"Received a session for {exp}: {session}")
        _ = bullet.YesNo("Press enter to unlock the session (currently it is locked in the db).").launch()
        print(f"Unlocked session. {unlock_session(s, session, exp)}")
    except Exception:
        print("Either no unlocked session is available at all at the moment or the experiment already used them.")
        traceback.print_exc()

    # Try getting a specific session
    # The same website can be received as often as wanted.
    try:
        session = get_specific_session(s, exp, "demo.dashpress.io")
        print(f"Received session for demo.dashpress.io: {session}")
        print(f"Unlocked session. {unlock_session(s, session, exp)}")
    except Exception:
        print("No session for demo.dashpress.io is currently available.")
        traceback.print_exc()
    