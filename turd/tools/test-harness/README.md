# T.U.R.D. headless test harness (tidy-up thread)

Screenshots every nav section at desktop (1600x900), laptop (1280x720) and phone (412x900),
reports rail/panel overlap + horizontal overflow, and lists page errors and failed requests.
Network is mocked (three.js from npm, Open-Meteo/NWS/BigDataCloud fixtures, project sites).

Setup (once, in any scratch dir):
    mkdir deps && cd deps && npm init -y && npm i three@0.160.0
    # link the globally installed playwright into deps/node_modules
Then from a folder next to deps/:
    node shot.mjs /mnt/project-files/turd/web ./out            # all sections
    MODES=phone node shot.mjs /mnt/project-files/turd/web ./out weather
    node behave.mjs /mnt/project-files/turd/web                # login/passkey/audit/quality checks
    node leak.mjs <webRoot>   # cycles every section 3x; window/document listener + node counts must stay flat
    node ovf.mjs <webRoot> <section> <w> <h>   # finds what causes sideways scroll
