import sys
import time
import traceback
from api import unlock_old_sessions, expire_old_sessions, print
import db
from typing import List


def main() -> int:
    """Expire sessions that are too old (new validation tasks are scheduled)."""
    # Main loop
    try:
        while True:
            with db.db.atomic():
                sessions: List[db.Session] = (
                    db.Session.select()
                    .join(db.SessionStatus)
                    .where(
                        db.SessionStatus.active == True,
                        db.Session.locked == False,
                        db.Session.verified == True,
                    )
                )
                expire_old_sessions(sessions)
                unlock_old_sessions()
            time.sleep(60)
    except Exception as error:
        traceback.print_exc()
        print(error)

    return 0


if __name__ == "__main__":
    sys.exit(main())
